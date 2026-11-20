import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { bridgeOptionsSchema, configSchema, DevAnalystError } from '@sonht113/core';
import { createClaudeCodeProvider } from '@sonht113/ai';
import {
  createDevelopmentIntegration,
  loadConfiguration,
  analysisLimits,
  type DevelopmentIntegrationOptions,
  type DevelopmentApi,
  type DevelopmentSnapshot,
  type DevelopmentHost,
} from '@sonht113/server';
export {
  loadConfiguration,
  defineConfig,
  analysisLimits,
  openSource,
  inspectClaude,
  manageCache,
  analyzeSource,
} from '@sonht113/server';
export type {
  ConfigurationFile,
  SourceMappingDiagnostic,
  BridgeClient,
  BridgeLifecycleEvent,
} from '@sonht113/server';
export type ViteIntegrationOptions = DevelopmentIntegrationOptions;
export type DevAnalystPluginApi = DevelopmentApi;
export type DevAnalystPluginSnapshot = DevelopmentSnapshot;
export interface DevAnalystPlugin extends Plugin {
  api: DevAnalystPluginApi;
}
type Integration = ReturnType<typeof createDevelopmentIntegration>;
/** Automatic development-only route bridge for local HTTP React + Vite applications. */
export function devanalyst(options: ViteIntegrationOptions = {}): DevAnalystPlugin {
  let active = options.enabled !== false;
  let resolvedOptions = options;
  let configuredRoot: string | undefined;
  let configFailure: DevAnalystError | undefined;
  let current: Integration | undefined;
  const generations: Integration[] = [];
  let resolveFirst: (value: { host: '127.0.0.1'; port: number } | null) => void = () => undefined;
  const firstReady: DevAnalystPluginApi['ready'] = new Promise((resolvePromise) => {
    resolveFirst = resolvePromise;
  });
  function mappingRuntime(id: string): string | undefined {
    if (!active || !current || !['starting', 'ready'].includes(current.getSnapshot().state))
      return undefined;
    if (id === `${current.namespace}mapping-runtime.js`)
      return '@sonht113/inspector/mapping-runtime';
    if (id === `${current.namespace}vue-runtime.js`) return '@sonht113/inspector/vue-runtime';
    return undefined;
  }
  const plugin: DevAnalystPlugin = {
    name: 'devanalyst',
    enforce: 'pre',
    resolveId(source, importer, resolveOptions) {
      if (resolveOptions.ssr || this.environment?.config.consumer === 'server') return null;
      const id =
        source === './mapping-runtime.js' &&
        current &&
        importer === `${current.namespace}vue-runtime.js`
          ? `${current.namespace}mapping-runtime.js`
          : source;
      if (mappingRuntime(id)) return id;
      return null;
    },
    async load(id, loadOptions) {
      if (loadOptions?.ssr || this.environment?.config.consumer === 'server') return null;
      const entry = mappingRuntime(id);
      if (!entry) return null;
      // Vite pre-transforms local imports without going through HTTP middleware.
      // Load the same public browser export at its existing URL; HTTP requests
      // still pass through the bridge's Origin/Host/query checks.
      return (await readFile(new URL(import.meta.resolve(entry)), 'utf8')).replace(
        /\/\/# sourceMappingURL=.*$/m,
        '',
      );
    },
    handleHotUpdate: {
      order: 'pre',
      async handler(context) {
        if (resolvedOptions.framework !== 'vue-vite' || !context.file.endsWith('.vue') || !current)
          return;
        const read = context.read;
        const original = await read();
        const transformed = await current.transform(original, context.file);
        if (transformed) context.read = async () => transformed.code;
      },
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
      getConfigurationDiagnostic: () => configFailure?.toJSON() ?? null,
      getDoctorDiagnostics: async () => {
        if (configuredRoot === undefined || configFailure) return null;
        const config = configSchema.parse(resolvedOptions.config ?? {});
        try {
          if (!(await stat(resolve(configuredRoot, config.workspaceRoot))).isDirectory())
            throw new Error('Not a directory');
        } catch {
          throw new DevAnalystError(
            'WORKSPACE_ACCESS_DENIED',
            'Configured workspaceRoot is unavailable. Choose an existing source workspace directory and retry doctor.',
          );
        }
        const claude = await createClaudeCodeProvider({
          ...resolvedOptions.preanalysis?.claude,
          workspaceRoot: resolve(configuredRoot, config.workspaceRoot),
          source: config.source,
          ai: config.ai,
        }).checkReadiness();
        return { aiEnabled: config.ai.enabled, claude };
      },
      getMappingDiagnostics: () => current?.getMappingDiagnostics() ?? [],
      getPageAnalysis: (clientId) => current?.getPageAnalysis(clientId) ?? null,
      inspectCache: () => current?.inspectCache() ?? Promise.resolve(null),
      clearCache: (filter) => current?.clearCache(filter) ?? Promise.resolve(0),
      getSnapshot: () =>
        current?.getSnapshot() ?? { state: 'inactive', port: null, clients: [], error: null },
    },
    async configResolved(config) {
      configuredRoot = config.root;
      active = config.plugins.find((entry) => entry.name === 'devanalyst') === plugin;
      if (!active) resolveFirst(null);
      if (active && !config.isProduction && config.command === 'serve') {
        try {
          const loaded = await loadConfiguration(config.root, config.mode, options.config);
          if (!bridgeOptionsSchema.safeParse({ ...loaded.bridge, ...options.bridge }).success)
            throw new DevAnalystError(
              'INVALID_CONFIG',
              'Invalid bridge options. Use host 127.0.0.1 and a port from 0 to 65535.',
            );
          const analyzer = {
            ...options.preanalysis?.analyzer,
            limits: { ...analysisLimits(loaded), ...options.preanalysis?.analyzer?.limits },
          };
          resolvedOptions = {
            ...options,
            config: loaded,
            bridge: { ...loaded.bridge, ...options.bridge },
            preanalysis: { ...options.preanalysis, analyzer },
          };
          configFailure = undefined;
        } catch (cause: unknown) {
          configFailure =
            cause instanceof DevAnalystError
              ? cause
              : new DevAnalystError(
                  'INVALID_CONFIG',
                  'Check devanalyst.config.ts and restart Vite.',
                );
          resolvedOptions = options;
        }
      }
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
      const host: DevelopmentHost = {
        root: server.config.root,
        base: server.config.base,
        publicDirectory: server.config.publicDir,
        outputDirectory: server.config.build.outDir,
        httpServer: server.httpServer,
        https: Boolean(server.config.server.https),
        logger: server.config.logger,
        use: (middleware) => server.middlewares.use(middleware),
        watchSource: (listener) => {
          server.watcher.on('all', listener);
          return () => {
            server.watcher.off('all', listener);
          };
        },
        invalidateMapping: (data) =>
          server.ws.send({ type: 'custom', event: 'devanalyst:source-invalidated', data }),
      };
      current = createDevelopmentIntegration(host, resolvedOptions, previousClose, configFailure);
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
