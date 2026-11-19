import { configSchema, DevAnalystError } from '@devanalyst/core';
import console from 'node:console';
import {
  defineNuxtModule,
  useNuxt,
  addVitePlugin,
  addPluginTemplate,
  addDevServerHandler,
} from '@nuxt/kit';
import { fromNodeMiddleware } from 'h3';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import {
  createDevelopmentIntegration,
  loadConfiguration,
  analysisLimits,
  type DevelopmentIntegrationOptions,
} from '@devanalyst/server';

export interface NuxtIntegrationOptions {
  readonly enabled?: boolean;
  readonly config?: DevelopmentIntegrationOptions['config'];
  readonly bridge?: DevelopmentIntegrationOptions['bridge'];
  readonly preanalysis?: DevelopmentIntegrationOptions['preanalysis'];
}
const implementation = defineNuxtModule<NuxtIntegrationOptions>({
  meta: {
    name: '@devanalyst/nuxt-module',
    configKey: 'devanalyst',
    compatibility: { nuxt: '~4.6.4' },
  },
  defaults: {},
  async setup(options, nuxt) {
    if (!nuxt.options.dev || process.env['NODE_ENV'] === 'production' || options.enabled === false)
      return;
    if (nuxt.options.devServer.https) {
      console.warn(
        '[DevAnalyst] UNSUPPORTED_FEATURE: Nuxt inspector currently requires local HTTP; HTTPS injection disabled.',
      );
      return;
    }
    if (nuxt.options.builder !== '@nuxt/vite-builder') {
      console.warn(
        '[DevAnalyst] UNSUPPORTED_FEATURE: Nuxt currently requires the Vite builder; inspector disabled.',
      );
      return;
    }
    const defaults = {
      source: { include: ['app/**', 'components/**', 'pages/**', 'composables/**'] },
    };
    let config = configSchema.parse(defaults),
      failure: DevAnalystError | undefined;
    try {
      config = await loadConfiguration(nuxt.options.rootDir, 'development', {
        ...defaults,
        ...options.config,
      });
    } catch (cause) {
      failure =
        cause instanceof DevAnalystError
          ? cause
          : new DevAnalystError('INVALID_CONFIG', 'Check devanalyst.config.ts and restart Nuxt.');
    }
    if (!config.inspector.enabled) return;
    if (!failure)
      addPluginTemplate({
        filename: 'devanalyst-navigation.client.mjs',
        mode: 'client',
        getContents: () =>
          `import {defineNuxtPlugin} from '#app';export default defineNuxtPlugin(app=>{app.hook('page:finish',()=>window.dispatchEvent(new Event('devanalyst:route-committed')))});`,
      });
    let vite: ViteDevServer | undefined,
      integration: ReturnType<typeof createDevelopmentIntegration> | undefined;
    let middlewares: ((
      request: IncomingMessage,
      response: ServerResponse,
      next: () => void,
    ) => void)[] = [];
    const base = nuxt.options.app.baseURL.replace(/\/?$/, '/');
    nuxt.options.app.head.script ??= [];
    if (!failure)
      nuxt.options.app.head.script.push({ type: 'module', src: base + '__devanalyst/client.js' });
    addDevServerHandler({
      middleware: true,
      handler: {
        nitro2: fromNodeMiddleware((request, response, next) => {
          const dispatch = (index: number): void => {
            const middleware = middlewares[index];
            if (middleware) middleware(request, response, () => dispatch(index + 1));
            else next?.();
          };
          dispatch(0);
        }),
      },
    });
    addVitePlugin(() => ({
      name: 'devanalyst-nuxt',
      enforce: 'pre',
      resolveId(source) {
        if (
          source === base + '__devanalyst/mapping-runtime.js' ||
          source === base + '__devanalyst/vue-runtime.js'
        )
          return { id: source, external: true };
        return null;
      },
      handleHotUpdate: {
        order: 'pre',
        async handler(context) {
          if (!integration || !context.file.endsWith('.vue')) return;
          const original = await context.read();
          const transformed = await integration.transform(original, context.file);
          if (transformed) context.read = async () => transformed.code;
        },
      },
      transform: {
        order: 'pre',
        async handler(code, id, context) {
          if (context?.ssr || this.environment?.config.consumer === 'server') return null;
          return (await integration?.transform(code, id)) ?? null;
        },
      },
    }));
    nuxt.hook('vite:serverCreated', (server, { isClient }) => {
      if (isClient) vite = server;
    });
    nuxt.hook('listen', async (http) => {
      await integration?.close();
      middlewares = [];
      integration = createDevelopmentIntegration(
        {
          root: nuxt.options.rootDir,
          base,
          publicDirectory: resolve(nuxt.options.rootDir, 'public'),
          outputDirectory: nuxt.options.buildDir,
          httpServer: http,
          logger: {
            warn: (message) => console.warn(message),
            info: (message) => console.info(message),
          },
          use: (value) => {
            middlewares.push(value);
          },
          watchSource: (listener) => {
            vite?.watcher.on('all', listener);
            return () => {
              vite?.watcher.off('all', listener);
            };
          },
          invalidateMapping: (data) =>
            vite?.ws.send({ type: 'custom', event: 'devanalyst:source-invalidated', data }),
        },
        {
          ...(options.bridge ? { bridge: options.bridge } : {}),
          framework: 'nuxt',
          config,
          preanalysis: {
            ...options.preanalysis,
            analyzer: {
              ...options.preanalysis?.analyzer,
              limits: { ...analysisLimits(config), ...options.preanalysis?.analyzer?.limits },
            },
          },
        },
        Promise.resolve(),
        failure,
      );
      await integration.ready;
    });
    nuxt.hook('close', async () => {
      await integration?.close();
    });
  },
});

/** Nuxt invokes modules inside its public context; optional Nuxt Kit vendor types stay at this boundary. */
export default async function devanalystNuxt(options: NuxtIntegrationOptions): Promise<void> {
  await implementation(options, useNuxt());
}

export { defineConfig } from '@devanalyst/server';
export type { ConfigurationFile } from '@devanalyst/server';
