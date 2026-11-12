import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import {
  bridgeOptionsSchema,
  configSchema,
  DevAnalystError,
  type BridgeOptionsInput,
  type DevAnalystConfigInput,
  type SerializedError,
} from '@devanalyst/core';
import {
  startLocalBridge,
  isLoopbackPeer,
  type BridgeClient,
  type BridgeLifecycleEvent,
  type LocalBridge,
} from './bridge.js';
import { createWorkspaceAccess } from './workspace.js';

export type { BridgeClient, BridgeLifecycleEvent } from './bridge.js';

export interface ViteIntegrationOptions {
  readonly enabled?: boolean;
  readonly config?: DevAnalystConfigInput;
  readonly bridge?: BridgeOptionsInput;
  /** Observes validated metadata. Keep callbacks lightweight; exceptions are isolated. */
  readonly onEvent?: (event: BridgeLifecycleEvent) => void | Promise<void>;
}

export interface DevAnalystPluginSnapshot {
  readonly state: 'inactive' | 'starting' | 'ready' | 'failed' | 'closed';
  readonly port: number | null;
  readonly clients: readonly BridgeClient[];
  readonly error: SerializedError | null;
}

export interface DevAnalystPluginApi {
  /** Resolves without credentials; failures resolve null and remain available in getSnapshot(). */
  readonly ready: Promise<{ readonly host: '127.0.0.1'; readonly port: number } | null>;
  getSnapshot(): DevAnalystPluginSnapshot;
}

export interface DevAnalystPlugin extends Plugin {
  api: DevAnalystPluginApi;
}

function localOrigins(server: ViteDevServer): string[] {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') return [];
  return ['127.0.0.1', 'localhost', '[::1]'].map(
    (host) => new URL(`http://${host}:${address.port}`).origin,
  );
}

function trustedRequest(request: IncomingMessage, server: ViteDevServer): boolean {
  if (!isLoopbackPeer(request.socket.remoteAddress)) return false;
  const origins = localOrigins(server);
  if (!origins.includes(`http://${request.headers.host ?? ''}`)) return false;
  if (request.headers.origin !== undefined && !origins.includes(request.headers.origin))
    return false;
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

interface Integration {
  readonly namespace: string;
  readonly ready: DevAnalystPluginApi['ready'];
  getSnapshot(): DevAnalystPluginSnapshot;
  close(): Promise<void>;
}

function configureIntegration(
  server: ViteDevServer,
  options: ViteIntegrationOptions,
  previousClose: Promise<void>,
): Integration {
  let state: DevAnalystPluginSnapshot['state'] = 'inactive';
  let error: SerializedError | null = null;
  let bridge: LocalBridge | undefined;
  let startup: Promise<void> = Promise.resolve();
  let disposed = false;
  let dispose: () => Promise<void> = async () => undefined;
  let namespace = '/__devanalyst/';
  let resolveReady: (value: { host: '127.0.0.1'; port: number } | null) => void = () => undefined;
  const ready: DevAnalystPluginApi['ready'] = new Promise((resolvePromise) => {
    resolveReady = resolvePromise;
  });
  const context: Integration = {
    get namespace() {
      return namespace;
    },
    ready,
    getSnapshot: () => ({
      state,
      port: bridge?.port ?? null,
      clients: bridge?.clients() ?? [],
      error,
    }),
    close: () => dispose?.() ?? Promise.resolve(),
  };
  const configuration = configSchema.safeParse(options.config ?? {});
  const settings = bridgeOptionsSchema.safeParse(options.bridge ?? {});
  function report(failure: DevAnalystError): void {
    error = failure.toJSON();
    bridge?.reportError(error);
    server.config.logger.warn(`[DevAnalyst] ${failure.code}: ${failure.message}`);
  }
  if (!configuration.success || !settings.success) {
    state = 'failed';
    report(
      new DevAnalystError(
        'INVALID_CONFIG',
        'Invalid DevAnalyst configuration. Check source paths, AI consent, and loopback bridge settings.',
      ),
    );
    resolveReady(null);
    return context;
  }
  if (!configuration.data.inspector.enabled) {
    state = 'inactive';
    resolveReady(null);
    return context;
  }
  if (server.httpServer === null || server.config.server.https) {
    state = 'failed';
    report(
      new DevAnalystError(
        'UNSUPPORTED_FEATURE',
        'The local bridge currently requires a standalone HTTP Vite server on loopback. HTTPS and middleware mode are unsupported.',
      ),
    );
    resolveReady(null);
    return context;
  }
  namespace = `${server.config.base.replace(/\/$/, '')}/__devanalyst/`;
  state = 'starting';
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = 0;
  let overflowReported = false;
  const changes = new Map<string, 'add' | 'change' | 'unlink'>();
  const emit = (event: BridgeLifecycleEvent): void => {
    const observerFailed = (): void =>
      report(
        new DevAnalystError(
          'INTERNAL_ERROR',
          'A DevAnalyst event observer failed. Check the configured onEvent callback.',
        ),
      );
    try {
      const observed = options.onEvent?.(event);
      if (observed !== undefined) void Promise.resolve(observed).catch(observerFailed);
    } catch {
      observerFailed();
    }
  };
  const access = createWorkspaceAccess(
    resolve(server.config.root, configuration.data.workspaceRoot),
    configuration.data.source,
  );
  // Vite can configure the replacement server before closing the old one.
  // Bind only once this particular HTTP server starts listening.
  let releaseListening: () => void = () => undefined;
  const listening = new Promise<void>((resolveListening) => {
    releaseListening = resolveListening;
  });
  const hostListening = (): void => releaseListening();
  if (server.httpServer.listening) releaseListening();
  else server.httpServer.once('listening', hostListening);
  // This promise is deliberately not returned from configureServer: no analysis blocks Vite.
  startup = (async () => {
    await Promise.all([access, previousClose, listening]);
    if (disposed) return;
    const local = await startLocalBridge({
      settings: settings.data,
      origins: () => localOrigins(server),
      onEvent: emit,
      onError: report,
    });
    if (disposed) {
      await local.close();
      return;
    }
    bridge = local;
    state = 'ready';
    resolveReady({ host: '127.0.0.1', port: local.port });
  })().catch((cause: unknown) => {
    if (!disposed) {
      state = 'failed';
      report(
        cause instanceof DevAnalystError
          ? cause
          : new DevAnalystError(
              'BRIDGE_START_FAILED',
              'Unable to initialize the configured local workspace bridge. Check workspace access and restart Vite.',
              { cause },
            ),
      );
    }
    resolveReady(null);
  });

  const watcher = (kind: string, file: string): void => {
    if (disposed || !['add', 'change', 'unlink'].includes(kind)) return;
    if (pending >= 256) {
      if (!overflowReported)
        report(
          new DevAnalystError(
            'SOURCE_CHANGED',
            'Source notifications overflowed. Refresh the inspection after this edit burst.',
          ),
        );
      overflowReported = true;
      return;
    }
    const eventKind = kind === 'add' ? 'add' : kind === 'unlink' ? 'unlink' : 'change';
    pending += 1;
    void access
      .then((workspace) => workspace.sourcePath(file, kind === 'unlink'))
      .then((source) => {
        if (disposed || source === null) return;
        if (changes.size >= 256 && !changes.has(source)) {
          report(
            new DevAnalystError(
              'SOURCE_CHANGED',
              'Too many source changes were queued. Refresh the inspection after the edit burst.',
            ),
          );
          return;
        }
        changes.set(source, eventKind);
        flushTimer ??= setTimeout(() => {
          flushTimer = undefined;
          if (!disposed) for (const [path, type] of changes) bridge?.sourceChanged(path, type);
          changes.clear();
          overflowReported = false;
        }, 30);
      })
      .catch(() =>
        report(
          new DevAnalystError(
            'WORKSPACE_ACCESS_DENIED',
            'Source-change notifications are unavailable for the configured workspace.',
          ),
        ),
      )
      .finally(() => {
        pending -= 1;
      });
  };
  server.watcher.on('all', watcher);
  let runtime: Promise<string> | undefined;
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(namespace)) {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (request.method !== 'GET' || url.search || !trustedRequest(request, server)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (url.pathname === `${namespace}bootstrap`) {
      response.setHeader('Content-Type', 'application/json');
      if (disposed || state !== 'ready' || bridge === undefined) {
        response.writeHead(503);
        response.end('{"error":"BRIDGE_UNAVAILABLE"}');
        return;
      }
      response.end(JSON.stringify(bridge.bootstrap()));
    } else if (url.pathname === `${namespace}client.js`) {
      runtime ??= readFile(new URL(import.meta.resolve('@devanalyst/inspector/runtime')), 'utf8');
      void runtime
        .then((code) => {
          if (response.destroyed) return;
          response.setHeader('Content-Type', 'text/javascript');
          const bootstrapUrl = JSON.stringify(`${namespace}bootstrap`).replaceAll('<', '\\u003c');
          response.end(
            `${code.replace(/\/\/# sourceMappingURL=.*$/m, '')}\nstartBridgeRuntime({bootstrapUrl:${bootstrapUrl}});`,
          );
        })
        .catch(() => {
          report(
            new DevAnalystError(
              'BRIDGE_START_FAILED',
              'The browser bridge module is unavailable. Rebuild the DevAnalyst packages and restart Vite.',
            ),
          );
          if (!response.destroyed) {
            response.writeHead(503);
            response.end();
          }
        });
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  let closing: Promise<void> | undefined;
  dispose = () => {
    closing ??= (async () => {
      disposed = true;
      state = 'closed';
      resolveReady(null);
      server.httpServer?.off('listening', hostListening);
      releaseListening();
      server.watcher.off('all', watcher);
      clearTimeout(flushTimer);
      changes.clear();
      await startup;
      await bridge?.close();
    })();
    return closing;
  };
  server.httpServer.once('close', () => {
    void dispose?.();
  });

  return context;
}

/** Automatic development-only route bridge for local HTTP React + Vite applications. */
export function devanalyst(options: ViteIntegrationOptions = {}): DevAnalystPlugin {
  let active = options.enabled !== false;
  let current: Integration | undefined;
  const generations: Integration[] = [];
  let resolveFirst: (value: { host: '127.0.0.1'; port: number } | null) => void = () => undefined;
  const firstReady: DevAnalystPluginApi['ready'] = new Promise((resolvePromise) => {
    resolveFirst = resolvePromise;
  });
  const plugin: DevAnalystPlugin = {
    name: 'devanalyst',
    apply(_config, environment) {
      const enabled =
        active &&
        environment.command === 'serve' &&
        environment.mode !== 'production' &&
        process.env['NODE_ENV'] !== 'production';
      if (!enabled) resolveFirst(null);
      return enabled;
    },
    api: {
      get ready() {
        return current?.ready ?? firstReady;
      },
      getSnapshot: () =>
        current?.getSnapshot() ?? { state: 'inactive', port: null, clients: [], error: null },
    },
    configResolved(config) {
      active = config.plugins.find((entry) => entry.name === 'devanalyst') === plugin;
      if (!active) resolveFirst(null);
    },
    configureServer(server) {
      if (!active || server.config.isProduction || process.env['NODE_ENV'] === 'production') {
        resolveFirst(null);
        return;
      }
      // Failed replacements may never receive their own restart hook. Retain only
      // the oldest hook owner plus the newest generation, disposing intermediates.
      const obsolete = generations.length > 1 ? generations.splice(1) : [];
      const previousClose = Promise.all([
        current?.close() ?? Promise.resolve(),
        ...obsolete.map((generation) => generation.close()),
      ]).then(() => undefined);
      current = configureIntegration(server, options, previousClose);
      generations.push(current);
      void current.ready.then(resolveFirst);
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        if (
          !active ||
          context.server === undefined ||
          current === undefined ||
          !['starting', 'ready'].includes(current.getSnapshot().state)
        )
          return [];
        return [
          {
            tag: 'script',
            attrs: { type: 'module', async: true, src: `${current.namespace}client.js` },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
    async closeServer({ reason }) {
      // A restart hook belongs to the oldest server, not the newly configured replacement.
      if (reason === 'restart') await generations.shift()?.close();
      else await Promise.all(generations.splice(0).map((generation) => generation.close()));
    },
  };
  return plugin;
}

export default devanalyst;
