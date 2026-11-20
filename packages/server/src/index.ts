import { routeExcluded } from './configuration.js';
import { openSource } from './editor.js';
export { loadConfiguration, defineConfig, analysisLimits } from './configuration.js';
export type { ConfigurationFile } from './configuration.js';
export { openSource } from './editor.js';
import { createInspectionService } from './inspection.js';
import { createHash } from 'node:crypto';
import {
  createPageOrchestrator,
  createWorkerAnalyzer,
  type PageOrchestratorOptions,
  type PageAnalysisSnapshot,
  type StaticAnalyzerOptions,
} from '@sonht113/analyzer';
import {
  createClaudeCodeProvider,
  type ClaudeCodeOptions,
  type ClaudeReadiness,
} from '@sonht113/ai';
import type { CacheInspection, CacheIdentity } from '@sonht113/cache';
import { createViteAnalysisCache } from './cache.js';
import { readFile } from 'node:fs/promises';
import { resolve, sep, relative, isAbsolute } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import type { FrameworkId } from '@sonht113/core';
import {
  bridgeOptionsSchema,
  configSchema,
  DevAnalystError,
  type BridgeOptionsInput,
  type DevAnalystConfigInput,
  type SerializedError,
  createLogger,
} from '@sonht113/core';
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

export interface DevelopmentIntegrationOptions {
  readonly framework?: FrameworkId;
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

export interface DevelopmentSnapshot {
  readonly state: 'inactive' | 'starting' | 'ready' | 'failed' | 'closed';
  readonly port: number | null;
  readonly clients: readonly BridgeClient[];
  readonly error: SerializedError | null;
}

export interface DevelopmentApi {
  /** Resolves without credentials; failures resolve null and remain available in getSnapshot(). */
  readonly ready: Promise<{ readonly host: '127.0.0.1'; readonly port: number } | null>;
  getSnapshot(): DevelopmentSnapshot;
  getConfigurationDiagnostic(): SerializedError | null;
  getDoctorDiagnostics(): Promise<{
    readonly aiEnabled: boolean;
    readonly claude: ClaudeReadiness;
  } | null>;
  getMappingDiagnostics(): readonly SourceMappingDiagnostic[];
  getPageAnalysis(clientId: string): PageAnalysisSnapshot | null;
  inspectCache(): Promise<CacheInspection | null>;
  clearCache(filter?: {
    scope?: CacheIdentity['scope'];
    kind?: CacheIdentity['kind'];
  }): Promise<number>;
}

export interface DevelopmentHost {
  readonly root: string;
  readonly base: string;
  readonly publicDirectory: string | false;
  readonly outputDirectory: string;
  readonly httpServer: {
    readonly listening: boolean;
    address(): ReturnType<Server['address']>;
    once(event: 'listening' | 'close', listener: () => void): unknown;
    off(event: 'listening' | 'close', listener: () => void): unknown;
  } | null;
  readonly https?: boolean;
  readonly logger: { warn(message: string): void; info(message: string): void };
  use(
    middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
  ): void;
  watchSource(listener: (kind: string, file: string) => void): () => void;
  invalidateMapping(change: { readonly moduleId: string; readonly revision: string }): void;
}
function localOrigins(server: DevelopmentHost): string[] {
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') return [];
  return ['127.0.0.1', 'localhost', '[::1]'].map(
    (host) => new URL(`http://${host}:${address.port}`).origin,
  );
}

function trustedRequest(request: IncomingMessage, server: DevelopmentHost): boolean {
  if (!isLoopbackPeer(request.socket.remoteAddress)) return false;
  const origins = localOrigins(server);
  if (!origins.includes(`http://${request.headers.host ?? ''}`)) return false;
  if (request.headers.origin !== undefined && !origins.includes(request.headers.origin))
    return false;
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

export interface DevelopmentIntegration {
  readonly namespace: string;
  readonly ready: DevelopmentApi['ready'];
  getSnapshot(): DevelopmentSnapshot;
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

export function createDevelopmentIntegration(
  server: DevelopmentHost,
  options: DevelopmentIntegrationOptions,
  previousClose: Promise<void>,
  configFailure?: DevAnalystError,
): DevelopmentIntegration {
  let state: DevelopmentSnapshot['state'] = 'inactive';
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
  const ready: DevelopmentApi['ready'] = new Promise((resolvePromise) => {
    resolveReady = resolvePromise;
  });
  const context: DevelopmentIntegration = {
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
    try {
      server.logger.warn(`[DevAnalyst] ${failure.code}: ${failure.message}`);
    } catch {
      error = new DevAnalystError(
        'LOG_WRITE_FAILED',
        'DevAnalyst logging failed. Check the configured Vite logger.',
      ).toJSON();
      bridge?.reportError(error);
    }
  }
  // Operational state stays diagnosable even when configuration disables the feature.
  server.use((request, response, next) => {
    if (request.url !== `${server.base.replace(/\/$/, '')}/__devanalyst/diagnostics`) {
      next();
      return;
    }
    if (request.method !== 'GET' || !trustedRequest(request, server)) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.end(
      JSON.stringify({
        state,
        clients: bridge?.clients().length ?? 0,
        error: error?.code ?? null,
        recovery:
          'Run framework development with DevAnalyst enabled; check configuration and reload the browser.',
      }),
    );
  });
  if (configFailure || !configuration.success || !settings.success) {
    state = 'failed';
    report(
      configFailure ??
        new DevAnalystError(
          'INVALID_CONFIG',
          'Invalid DevAnalyst configuration. Check source paths, AI consent, and loopback bridge settings.',
        ),
    );
    resolveReady(null);
    return context;
  }
  if (options.enabled === false || !configuration.data.inspector.enabled) {
    state = 'inactive';
    resolveReady(null);
    return context;
  }
  if (server.httpServer === null || server.https) {
    state = 'failed';
    report(
      new DevAnalystError(
        'UNSUPPORTED_FEATURE',
        'The local bridge requires a bound HTTP development server on loopback. HTTPS and unbound middleware hosts are unsupported.',
      ),
    );
    resolveReady(null);
    return context;
  }
  namespace = `${server.base.replace(/\/$/, '')}/__devanalyst/`;
  state = 'starting';
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pending = 0;
  let overflowReported = false;
  const changes = new Map<string, 'add' | 'change' | 'unlink'>();
  const debug = createLogger({
    scope: 'server',
    level: configuration.data.logLevel,
    sink: (record) => server.logger.info(JSON.stringify(record)),
  });
  const emit = (event: BridgeLifecycleEvent): void => {
    const logged = debug.log('debug', `bridge.${event.type}`);
    if (logged.status === 'failed') report(logged.error);
    if (
      event.type === 'inspector' &&
      event.event.type === 'inspector.request' &&
      routeExcluded(configuration.data, event.event.payload.route)
    ) {
      for (const lane of ['translation', 'analysis', 'ai'] as const)
        bridge?.inspection(event.clientId, {
          requestId: event.event.payload.requestId,
          elementId: event.event.payload.element.elementId,
          revision: event.event.payload.element.revision,
          lane,
          state: 'FAILED',
          cache: 'miss',
          completion: 'partial',
          error: 'ROUTE_EXCLUDED',
          reset: true,
          limited: false,
          items: [],
          observedAt: new Date().toISOString(),
        });
      return;
    }
    if (
      event.type === 'page' &&
      event.event.type === 'page.index' &&
      routeExcluded(configuration.data, event.event.payload.route)
    )
      return;
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
    resolve(server.root, configuration.data.workspaceRoot),
    configuration.data.source,
  );
  const cacheDirectory = resolve(
    server.root,
    configuration.data.workspaceRoot,
    configuration.data.cache.directory,
  );
  const contains = (directory: string, path: string) => {
    const value = relative(directory, path);
    return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith('..' + sep));
  };
  const publicDirectory = server.publicDirectory;
  const outputDirectory = resolve(server.root, server.outputDirectory);
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
    workspaceRoot: resolve(server.root, configuration.data.workspaceRoot),
    config: unsafeCacheDirectory
      ? { ...configuration.data, cache: { ...configuration.data.cache, enabled: false } }
      : configuration.data,
    analyzer: { ...options.preanalysis?.analyzer, framework: options.framework ?? 'react-vite' },
    model: options.preanalysis?.claude?.model ?? 'sonnet',
    enabledAI: options.preanalysis?.backgroundAI === true && configuration.data.ai.enabled,
    report,
  });
  if (options.preanalysis?.enabled !== false) {
    try {
      const worker = createWorkerAnalyzer({
        ...options.preanalysis?.analyzer,
        framework: options.framework ?? 'react-vite',
        workspaceRoot: resolve(server.root, configuration.data.workspaceRoot),
        source: configuration.data.source,
      });
      const provider =
        options.preanalysis?.backgroundAI === true && configuration.data.ai.enabled
          ? createClaudeCodeProvider({
              ...options.preanalysis?.claude,
              workspaceRoot: resolve(server.root, configuration.data.workspaceRoot),
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
                  resolve(server.root, configuration.data.workspaceRoot, file),
                )
              )
                return false;
            for (const [alias, target] of Object.entries(aliases))
              if (
                (await workspace.canonicalSourcePath(
                  resolve(server.root, configuration.data.workspaceRoot, alias),
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
  mapping.service = createSourceMapping(
    access,
    `${namespace}mapping-runtime.js`,
    (data) => {
      if (!disposed) {
        server.invalidateMapping(data);
        bridge?.mappingInvalidated(data);
      }
    },
    options.framework ?? 'react-vite',
  );
  try {
    inspection = createInspectionService({
      workspaceRoot: resolve(server.root, configuration.data.workspaceRoot),
      config: configuration.data,
      access,
      mapping: mapping.service,
      persistence,
      ...(orchestrator ? { orchestrator } : {}),
      analyzer: { ...options.preanalysis?.analyzer, framework: options.framework ?? 'react-vite' },
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
      openSource: (source, revision) =>
        openSource(server.root, configuration.data, source, revision),
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
  const stopWatching = server.watchSource(watcher);
  const runtimeAssets = new Map<string, Promise<string>>();
  const assets: Readonly<Record<string, string>> = {
    'client.js': '@sonht113/inspector/runtime',
    'browser.js': '@sonht113/inspector/browser',
    'metadata.js': '@sonht113/inspector/metadata',
    'inspection-client.js': '@sonht113/inspector/inspection-client',
    'inspection-panel.js': '@sonht113/inspector/inspection-panel',
    'inspection-strings.js': '@sonht113/inspector/inspection-strings',
    'glossary.js': '@sonht113/inspector/glossary',
    'preanalysis-runtime.js': '@sonht113/inspector/preanalysis-runtime',
    'mapping-runtime.js': '@sonht113/inspector/mapping-runtime',
    'vue-runtime.js': '@sonht113/inspector/vue-runtime',
  };
  server.use((request, response, next) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const relativePath = decoded.startsWith(server.base)
      ? decoded.slice(server.base.length)
      : decoded.replace(/^\//, '');
    const candidates = [
      resolve(server.root, relativePath),
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
    if (url.pathname === `${namespace}diagnostics`) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          state,
          clients: bridge?.clients().length ?? 0,
          error: error?.code ?? null,
          recovery:
            state === 'ready'
              ? 'Reload the browser if disconnected; check CSP connect-src for the loopback WebSocket.'
              : 'Run devanalyst doctor; check configuration and restart Vite.',
        }),
      );
    } else if (url.pathname === `${namespace}bootstrap`) {
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
            `${code.replace(/\/\/# sourceMappingURL=.*$/m, '')}${name === 'client.js' ? `\nstartBridgeRuntime({bootstrapUrl:${bootstrapUrl},theme:${JSON.stringify(configuration.data.inspector.theme)},language:${JSON.stringify(configuration.data.inspector.language)},shortcuts:${JSON.stringify(configuration.data.inspector.shortcuts)},preanalysis:${options.preanalysis?.enabled !== false},maxMessageBytes:${settings.data.maxMessageBytes}});` : ''}`,
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
      stopWatching();
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

export { inspectClaude, manageCache, analyzeSource } from './operations.js';
export { startCompilerService, requestCompiler } from './compiler.js';
