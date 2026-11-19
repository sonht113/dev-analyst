import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import console from 'node:console';
import { watch } from 'chokidar';
import { createWorkspaceAccess } from '@devanalyst/analyzer';
import { DevAnalystError, configSchema } from '@devanalyst/core';
import {
  createDevelopmentIntegration,
  loadConfiguration,
  analysisLimits,
  startCompilerService,
  type DevelopmentIntegrationOptions,
} from '@devanalyst/server';

/** Narrow public custom-server/loader contracts avoid exposing Next's private implementation types. */
interface NextApp {
  prepare(): Promise<void>;
  close(): Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  getUpgradeHandler(): (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
}
interface NextOptions {
  readonly dev: true;
  readonly dir: string;
  readonly hostname: string;
  readonly port: number;
  readonly httpServer: Server;
  readonly webpack?: boolean;
  readonly turbopack?: boolean;
}
type NextFactory = (options: NextOptions) => NextApp;
function isFactory(value: unknown): value is NextFactory {
  return typeof value === 'function';
}
const nextModule: unknown = createRequire(import.meta.url)('next');
if (!isFactory(nextModule))
  throw new DevAnalystError(
    'UNSUPPORTED_FEATURE',
    'The installed Next package has an incompatible public server entry.',
  );
const next: NextFactory = nextModule;
interface LoaderRule {
  readonly loaders: readonly {
    readonly loader: string;
    readonly options: { readonly socket: string; readonly workspaceRoot: string };
  }[];
}
interface WebpackConfig {
  module: { rules: unknown[] };
}
function webpackConfiguration(value: unknown): value is WebpackConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'module' in value &&
    typeof value.module === 'object' &&
    value.module !== null &&
    'rules' in value.module &&
    Array.isArray(value.module.rules)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const socketVariable = 'DEVANALYST_NEXT_COMPILER_SOCKET';
let activeWrapper = false;
const rootVariable = 'DEVANALYST_NEXT_WORKSPACE_ROOT';
/** Install in next.config.ts. Only the explicit development wrapper supplies the private compiler channel. */
export function withDevAnalyst<T extends object>(
  config: T,
): (phase: string) => T & {
  webpack?: (configuration: unknown, context: { dev: boolean; isServer: boolean }) => unknown;
  turbopack?: Record<string, unknown>;
} {
  return (phase) => {
    const socket = process.env[socketVariable],
      workspaceRoot = process.env[rootVariable];
    if (phase !== 'phase-development-server' || !socket || !workspaceRoot) return config;
    const loader = fileURLToPath(import.meta.resolve('@devanalyst/next-plugin/loader'));
    const options = { socket, workspaceRoot };
    const turbo = 'turbopack' in config && record(config.turbopack) ? config.turbopack : {};
    const rules: Record<string, LoaderRule> = {
      '*.tsx': { loaders: [{ loader, options }] },
      '*.jsx': { loaders: [{ loader, options }] },
    };
    const existingRules = record(turbo['rules']) ? turbo['rules'] : {};
    if (Object.keys(rules).some((key) => Object.hasOwn(existingRules, key))) {
      console.warn(
        '[DevAnalyst] UNSUPPORTED_FEATURE: Existing Turbopack TSX/JSX rules are preserved; mapping is disabled. Use an unmodified rule configuration.',
      );
      return config;
    }
    return {
      ...config,
      webpack(webpackConfig: unknown, context: { dev: boolean; isServer: boolean }) {
        const configured: unknown =
          'webpack' in config && typeof config.webpack === 'function'
            ? config.webpack(webpackConfig, context)
            : webpackConfig;
        if (context.dev && !context.isServer && webpackConfiguration(configured))
          configured.module.rules.push({
            test: /\.[jt]sx$/,
            enforce: 'pre',
            exclude: /node_modules/,
            use: [{ loader, options }],
          });
        return configured;
      },
      turbopack: {
        ...turbo,
        rules: { ...(record(turbo['rules']) ? turbo['rules'] : {}), ...rules },
      },
    };
  };
}
/** Public Next custom-server API, exclusively for development; standard next build/start stay untouched. */
export async function startNextDevelopment(
  options: DevelopmentIntegrationOptions & {
    root?: string;
    port?: number;
    bundler?: 'webpack' | 'turbopack';
  } = {},
) {
  if (process.env['NODE_ENV'] === 'production')
    throw new DevAnalystError(
      'DEVELOPMENT_ONLY',
      'Use Next build/start in production; DevAnalyst Next startup is development-only.',
    );
  if (activeWrapper || process.env[socketVariable])
    throw new DevAnalystError(
      'UNSUPPORTED_FEATURE',
      'Use one Next development wrapper per process.',
    );
  const port = options.port ?? 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Choose a fixed Next development port from 1 through 65535.',
    );
  const root = resolve(options.root ?? '.');
  const defaults = { source: { include: ['app/**', 'src/**', 'pages/**'] } };
  let config = configSchema.parse(defaults),
    failure: DevAnalystError | undefined;
  try {
    config = await loadConfiguration(root, 'development', { ...defaults, ...options.config });
  } catch (cause) {
    failure =
      cause instanceof DevAnalystError
        ? cause
        : new DevAnalystError('INVALID_CONFIG', 'Check devanalyst.config.ts and restart Next.');
  }
  const workspaceRoot = resolve(root, config.workspaceRoot);
  let access: Awaited<ReturnType<typeof createWorkspaceAccess>> | undefined;
  if (!failure && options.enabled !== false && config.inspector.enabled)
    try {
      access = await createWorkspaceAccess(workspaceRoot, config.source);
    } catch {
      failure = new DevAnalystError(
        'WORKSPACE_ACCESS_DENIED',
        'Check workspaceRoot and source policy; Next remains available without DevAnalyst mapping.',
      );
    }
  const middlewares: ((
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => void)[] = [];
  let app: NextApp | undefined;
  const http = createServer((request, response) => {
    const handle = () => {
      if (!app) {
        response.writeHead(503);
        response.end();
        return;
      }
      void app
        .getRequestHandler()(request, response)
        .catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
    };
    const dispatch = (index: number): void => {
      const middleware = middlewares[index];
      if (middleware) middleware(request, response, () => dispatch(index + 1));
      else handle();
    };
    dispatch(0);
  });
  const sockets = new Set<Socket>();
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const watcher = watch(access ? workspaceRoot : [], {
    ignoreInitial: true,
    ignored: (path) =>
      /(?:^|[/\\])(?:node_modules|\.git|\.next|\.cache|dist)(?:[/\\]|$)/.test(path),
  });
  let compiler: Awaited<ReturnType<typeof startCompilerService>> | undefined;
  const sourceAccess = access;
  if (sourceAccess)
    try {
      compiler = await startCompilerService(async (file, revision) => {
        const code = await sourceAccess.readSource(file);
        if (createHash('sha256').update(code).digest('hex') !== revision)
          throw new Error('Source changed');
        return (
          (await integration?.transform(code, resolve(workspaceRoot, file))) ?? { code, map: null }
        );
      });
    } catch {
      failure = new DevAnalystError(
        'UNSUPPORTED_FEATURE',
        'The private Next compiler channel is unavailable; use native macOS/Linux and restart. The host application remains available.',
      );
    }
  const integration = createDevelopmentIntegration(
    {
      root,
      base: '/',
      publicDirectory: resolve(root, 'public'),
      outputDirectory: '.next',
      httpServer: http,
      logger: {
        warn: (message) => console.warn(message),
        info: (message) => console.info(message),
      },
      use: (value) => {
        middlewares.push(value);
      },
      watchSource: (listener) => {
        watcher.on('all', listener);
        return () => {
          watcher.off('all', listener);
        };
      },
      invalidateMapping: () => undefined,
    },
    {
      ...options,
      framework: 'next-react',
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
  if (compiler) {
    process.env[socketVariable] = compiler.path;
    process.env[rootVariable] = workspaceRoot;
  }
  activeWrapper = true;
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      const stoppedHttp = http.listening
        ? new Promise<void>((done) => http.close(() => done()))
        : Promise.resolve();
      for (const socket of sockets) socket.destroy();
      const results = await Promise.allSettled([
        integration?.close(),
        compiler?.close(),
        watcher.close(),
        app?.close(),
        stoppedHttp,
      ]);
      delete process.env[socketVariable];
      delete process.env[rootVariable];
      activeWrapper = false;
      if (results.some((result) => result.status === 'rejected'))
        throw new DevAnalystError(
          'INTERNAL_ERROR',
          'Next development cleanup failed. Stop the remaining process and restart.',
        );
    })();
    return closing;
  }
  try {
    app = next({
      dev: true,
      dir: root,
      hostname: '127.0.0.1',
      port,
      httpServer: http,
      ...(options.bundler === 'webpack' ? { webpack: true } : { turbopack: true }),
    });
    await app.prepare();
    await new Promise<void>((done, reject) => {
      http.once('error', reject);
      http.listen(port, '127.0.0.1', () => {
        http.off('error', reject);
        done();
      });
    });
    await integration.ready;
    return { httpServer: http, api: integration, close };
  } catch (cause) {
    await close();
    throw new DevAnalystError(
      'BRIDGE_START_FAILED',
      'Next development startup failed. Check Next configuration, compiler version and the selected local port.',
      { cause },
    );
  }
}

export { defineConfig } from '@devanalyst/server';
export type { ConfigurationFile } from '@devanalyst/server';
