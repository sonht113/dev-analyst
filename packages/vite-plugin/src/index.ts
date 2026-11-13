import { createInspectionService } from './inspection.js';
import { createHash } from 'node:crypto';
import {
  createPageOrchestrator,
  createWorkerAnalyzer,
  type PageOrchestratorOptions,
  type PageAnalysisSnapshot,
  type StaticAnalyzerOptions,
} from '@devanalyst/analyzer';
import { createClaudeCodeProvider, type ClaudeCodeOptions } from '@devanalyst/ai';
import type { CacheInspection, CacheIdentity } from '@devanalyst/cache';
import { createViteAnalysisCache } from './cache.js';
import { readFile } from 'node:fs/promises';
import { resolve, sep, relative, isAbsolute } from 'node:path';
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
import { createSourceMapping, type SourceMappingDiagnostic } from './mapping.js';
export type { SourceMappingDiagnostic } from './mapping.js';

export type { BridgeClient, BridgeLifecycleEvent } from './bridge.js';

export interface ViteIntegrationOptions {
  readonly enabled?: boolean;
  readonly preanalysis?: {
    readonly enabled?: boolean;
    readonly limits?: PageOrchestratorOptions['limits'];
    readonly analyzer?: Pick<
      StaticAnalyzerOptions,
      'aliases' | 'tsconfig' | 'compilerOptions' | 'limits'
    >;
    /** Additional explicit consent for automatic source transmission; config.ai must also be enabled. */
    readonly backgroundAI?: boolean;
    readonly claude?: Pick<ClaudeCodeOptions, 'executable' | 'model'>;
  };
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
  getMappingDiagnostics(): readonly SourceMappingDiagnostic[];
  getPageAnalysis(clientId: string): PageAnalysisSnapshot | null;
  inspectCache(): Promise<CacheInspection | null>;
  clearCache(filter?: {
    scope?: CacheIdentity['scope'];
    kind?: CacheIdentity['kind'];
  }): Promise<number>;
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
  getPageAnalysis(clientId: string): PageAnalysisSnapshot | null;
  inspectCache(): Promise<CacheInspection | null>;
  clearCache(filter?: {
    scope?: CacheIdentity['scope'];
    kind?: CacheIdentity['kind'];
  }): Promise<number>;
  close(): Promise<void>;
  transform: ReturnType<typeof createSourceMapping>['transform'];
  getMappingDiagnostics(): readonly SourceMappingDiagnostic[];
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
  let inspection: ReturnType<typeof createInspectionService> | undefined = undefined;
  let persistence: ReturnType<typeof createViteAnalysisCache> | undefined = undefined;
  let orchestrator: ReturnType<typeof createPageOrchestrator> | undefined;
  const mapping: { service?: ReturnType<typeof createSourceMapping> } = {};
  let resolveReady: (value: { host: '127.0.0.1'; port: number } | null) => void = () => undefined;
  const ready: DevAnalystPluginApi['ready'] = new Promise((resolvePromise) => {
    resolveReady = resolvePromise;
  });
  const context: Integration = {
    get namespace() {
      return namespace;
    },
    ready,
    transform: async (code, id) => mapping.service?.transform(code, id) ?? null,
    getMappingDiagnostics: () => mapping.service?.diagnostics() ?? [],
    getPageAnalysis: (clientId) => orchestrator?.getSnapshot(clientId) ?? null,
    inspectCache: () => persistence?.inspect() ?? Promise.resolve(null),
    clearCache: async (filter) => {
      const count = (await persistence?.clear(filter)) ?? 0;
      orchestrator?.invalidate('*', true);
      inspection?.invalidate('*');
      return count;
    },
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
    if (event.type === 'inspector') {
      if (event.event.type === 'inspector.request') {
        if (inspection) inspection.request(event.clientId, event.event.payload);
        else
          for (const lane of ['translation', 'analysis', 'ai'] as const)
            bridge?.inspection(event.clientId, {
              requestId: event.event.payload.requestId,
              elementId: event.event.payload.element.elementId,
              revision: event.event.payload.element.revision,
              lane,
              state: 'FAILED',
              cache: 'miss',
              completion: 'partial',
              error: 'INVALID_CONFIG',
              reset: true,
              limited: false,
              items: [],
              observedAt: new Date().toISOString(),
            });
      } else inspection?.cancel(event.clientId, event.event.payload.requestId);
    }
    if (event.type === 'disconnected') {
      orchestrator?.remove(event.clientId);
      inspection?.cancel(event.clientId);
    } else if (event.type === 'route') {
      inspection?.route(event.clientId, event.route);
      const previous = orchestrator?.getSnapshot(event.clientId);
      if (
        previous &&
        (previous.route.pathname !== event.route.pathname ||
          (previous.route.hashPath ?? null) !== (event.route.hashPath ?? null))
      )
        orchestrator?.remove(event.clientId);
    } else if (event.type === 'page') {
      const payload = event.event.payload;
      if (event.event.type === 'page.index') {
        const data = event.event.payload;
        const elements = data.elements.filter((element) => mapping.service?.resolve(element));
        orchestrator?.index(
          event.clientId,
          data.requestId,
          data.route,
          elements,
          data.limited || elements.length !== data.elements.length,
        );
      } else {
        const data = event.event.payload;
        const previous = orchestrator?.getSnapshot(event.clientId);
        if (previous?.requestId === payload.requestId && mapping.service?.resolve(data.element)) {
          orchestrator?.index(
            event.clientId,
            data.requestId,
            previous.route,
            [data.element],
            false,
            data.priority,
          );
          orchestrator?.prioritize(
            event.clientId,
            data.requestId,
            data.element.elementId,
            data.priority,
          );
        }
      }
    }
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
  const cacheDirectory = resolve(
    server.config.root,
    configuration.data.workspaceRoot,
    configuration.data.cache.directory,
  );
  const contains = (directory: string, path: string) => {
    const value = relative(directory, path);
    return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep));
  };
  const publicDirectory = server.config.publicDir;
  const outputDirectory = resolve(server.config.root, server.config.build.outDir);
  const unsafeCacheDirectory =
    Boolean(publicDirectory && contains(publicDirectory, cacheDirectory)) ||
    contains(outputDirectory, cacheDirectory);
  if (unsafeCacheDirectory && configuration.data.cache.enabled)
    report(
      new DevAnalystError(
        'INVALID_CONFIG',
        'Choose a cache directory outside Vite public and build output directories. Persistence is disabled.',
      ),
    );
  persistence = createViteAnalysisCache({
    workspaceRoot: resolve(server.config.root, configuration.data.workspaceRoot),
    config: unsafeCacheDirectory
      ? { ...configuration.data, cache: { ...configuration.data.cache, enabled: false } }
      : configuration.data,
    analyzer: options.preanalysis?.analyzer ?? {},
    model: options.preanalysis?.claude?.model ?? 'sonnet',
    enabledAI: options.preanalysis?.backgroundAI === true && configuration.data.ai.enabled,
    report,
  });
  if (options.preanalysis?.enabled !== false) {
    try {
      const worker = createWorkerAnalyzer({
        ...options.preanalysis?.analyzer,
        workspaceRoot: resolve(server.config.root, configuration.data.workspaceRoot),
        source: configuration.data.source,
      });
      const provider =
        options.preanalysis?.backgroundAI === true && configuration.data.ai.enabled
          ? createClaudeCodeProvider({
              ...options.preanalysis?.claude,
              workspaceRoot: resolve(server.config.root, configuration.data.workspaceRoot),
              source: configuration.data.source,
              ai: configuration.data.ai,
            })
          : null;
      orchestrator = createPageOrchestrator({
        ...(options.preanalysis?.limits ? { limits: options.preanalysis.limits } : {}),
        analyze: worker.analyzeDetailed,
        persistence: persistence.hooks,
        validate: async (hashes, missing = [], aliases = {}) => {
          const workspace = await access;
          try {
            for (const [file, hash] of Object.entries(hashes))
              if (
                createHash('sha256')
                  .update(await workspace.readSource(file))
                  .digest('hex') !== hash
              )
                return false;
            for (const file of missing)
              if (
                await workspace.canonicalSourcePath(
                  resolve(server.config.root, configuration.data.workspaceRoot, file),
                )
              )
                return false;
            for (const [alias, target] of Object.entries(aliases))
              if (
                (await workspace.canonicalSourcePath(
                  resolve(server.config.root, configuration.data.workspaceRoot, alias),
                )) !== target
              )
                return false;
            return Object.keys(hashes).length > 0;
          } catch {
            return false;
          }
        },
        ...(provider
          ? ({
              enrich: (result, signal) =>
                provider.explain({
                  requestId: result.requestId,
                  evidence: result.findings
                    .filter((finding) => finding.evidence !== null)
                    .slice(0, 24),
                  sourceHashes: result.sourceHashes,
                  depth: configuration.data.ai.depth,
                  signal,
                }),
            } satisfies Pick<PageOrchestratorOptions, 'enrich'>)
          : {}),
        onProgress: (clientId, page) => {
          persistence?.index(clientId, page);
          const statuses = page.items.map(
            ({ elementId, revision, state, aiState, cache, error }) => ({
              elementId,
              revision,
              state,
              aiState,
              cache,
              error,
            }),
          );
          for (let offset = 0; offset < Math.max(1, statuses.length); offset += 16)
            bridge?.progress(clientId, {
              requestId: page.requestId,
              items: statuses.slice(offset, offset + 16),
              total: page.total,
              completed: page.completed,
              limited: page.limited,
            });
        },
      });
    } catch {
      report(
        new DevAnalystError(
          'INVALID_CONFIG',
          'Page pre-analysis is unavailable. Check its resource limits and analyzer settings.',
        ),
      );
    }
  }
  mapping.service = createSourceMapping(access, `${namespace}mapping-runtime.js`, (data) => {
    if (!disposed) server.ws.send({ type: 'custom', event: 'devanalyst:source-invalidated', data });
  });
  try {
    inspection = createInspectionService({
      workspaceRoot: resolve(server.config.root, configuration.data.workspaceRoot),
      config: configuration.data,
      access,
      mapping: mapping.service,
      persistence,
      ...(orchestrator ? { orchestrator } : {}),
      ...(options.preanalysis?.analyzer ? { analyzer: options.preanalysis.analyzer } : {}),
      ...(options.preanalysis?.claude ? { claude: options.preanalysis.claude } : {}),
      maxMessageBytes: settings.data.maxMessageBytes,
      send: (client, payload) => bridge?.inspection(client, payload),
    });
  } catch {
    report(
      new DevAnalystError(
        'INVALID_CONFIG',
        'Inspector analysis is unavailable. Check analyzer and Claude CLI settings; local DOM inspection remains available.',
      ),
    );
  }
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
      .then(async (source) => {
        if (disposed || source === null) return;
        let observedRevision: string | undefined;
        if (kind !== 'unlink') {
          try {
            observedRevision = createHash('sha256')
              .update(await (await access).readSource(source))
              .digest('hex');
          } catch {
            /* Invalid/unreadable source must still invalidate old evidence. */
          }
        }
        if (disposed) return;
        mapping.service?.invalidate(source, observedRevision);
        inspection?.invalidate(source);
        void persistence?.invalidate(
          source,
          observedRevision ?? null,
          kind !== 'change' || source.endsWith('.json'),
        );
        orchestrator?.invalidate(
          source,
          kind !== 'change' || source.endsWith('.json'),
          observedRevision,
        );
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
  const runtimeAssets = new Map<string, Promise<string>>();
  const assets: Readonly<Record<string, string>> = {
    'client.js': '@devanalyst/inspector/runtime',
    'browser.js': '@devanalyst/inspector/browser',
    'metadata.js': '@devanalyst/inspector/metadata',
    'inspection-client.js': '@devanalyst/inspector/inspection-client',
    'inspection-panel.js': '@devanalyst/inspector/inspection-panel',
    'inspection-strings.js': '@devanalyst/inspector/inspection-strings',
    'glossary.js': '@devanalyst/inspector/glossary',
    'preanalysis-runtime.js': '@devanalyst/inspector/preanalysis-runtime',
    'mapping-runtime.js': '@devanalyst/inspector/mapping-runtime',
  };
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const relativePath = decoded.startsWith(server.config.base)
      ? decoded.slice(server.config.base.length)
      : decoded.replace(/^\//, '');
    const candidates = [
      resolve(server.config.root, relativePath),
      ...(publicDirectory ? [resolve(publicDirectory, relativePath)] : []),
      ...(decoded.includes('/@fs/') ? [resolve(decoded.slice(decoded.indexOf('/@fs/') + 4))] : []),
    ];
    if (
      candidates.some((candidate) => contains(cacheDirectory, candidate)) ||
      decoded.includes('/' + configuration.data.cache.directory.replaceAll('\\', '/') + '/')
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
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
    } else if (Object.hasOwn(assets, url.pathname.slice(namespace.length))) {
      const name = url.pathname.slice(namespace.length);
      const asset = assets[name];
      if (!asset) return;
      let runtime = runtimeAssets.get(name);
      if (!runtime) {
        runtime = readFile(new URL(import.meta.resolve(asset)), 'utf8');
        runtimeAssets.set(name, runtime);
      }
      void runtime
        .then((code) => {
          if (response.destroyed) return;
          response.setHeader('Content-Type', 'text/javascript');
          const bootstrapUrl = JSON.stringify(`${namespace}bootstrap`).replaceAll('<', '\\u003c');
          response.end(
            `${code.replace(/\/\/# sourceMappingURL=.*$/m, '')}${name === 'client.js' ? `\nstartBridgeRuntime({bootstrapUrl:${bootstrapUrl},theme:${JSON.stringify(configuration.data.inspector.theme)},language:${JSON.stringify(configuration.data.inspector.language)},preanalysis:${options.preanalysis?.enabled !== false},maxMessageBytes:${settings.data.maxMessageBytes}});` : ''}`,
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
      mapping.service?.stop();
      const stoppedInspection = inspection?.stop();
      const stoppedAnalysis = orchestrator?.stop();
      await startup;
      await Promise.all([stoppedInspection, stoppedAnalysis, bridge?.close()]);
      await persistence?.close();
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
    enforce: 'pre',
    resolveId(source) {
      if (active && current && source === `${current.namespace}mapping-runtime.js`)
        return { id: source, external: true };
      return null;
    },
    transform: {
      order: 'pre',
      async handler(code, id, transformOptions) {
        if (!active || transformOptions?.ssr || this.environment?.config.consumer === 'server')
          return null;
        try {
          return (await current?.transform(code, id)) ?? null;
        } catch {
          return null;
        }
      },
    },
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
      getMappingDiagnostics: () => current?.getMappingDiagnostics() ?? [],
      getPageAnalysis: (clientId) => current?.getPageAnalysis(clientId) ?? null,
      inspectCache: () => current?.inspectCache() ?? Promise.resolve(null),
      clearCache: (filter) => current?.clearCache(filter) ?? Promise.resolve(0),
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
