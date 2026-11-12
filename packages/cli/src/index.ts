import { DevAnalystError } from '@devanalyst/core';
import process from 'node:process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer, resolveConfig, version as viteVersion, type ViteDevServer } from 'vite';

export interface CliOutput {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

const help = `DevAnalyst — AI-Powered Frontend Code Inspector

Usage: devanalyst [--help | --version | dev [root] [--port PORT] [--strict-port] | doctor [root]]

Add devanalyst() from @devanalyst/vite-plugin to your Vite plugins first.
dev starts the configured local development server; doctor checks Vite/plugin configuration without starting a bridge.
AI and element inspection are not implemented in this phase.
`;

export interface DevelopmentServerOptions {
  readonly root?: string;
  readonly port?: number;
  readonly strictPort?: boolean;
}

/** Starts the project's own Vite configuration; never edits it or enables AI. */
export async function startDevelopmentServer(
  options: DevelopmentServerOptions = {},
): Promise<ViteDevServer> {
  if (process.env['NODE_ENV'] === 'production')
    throw new DevAnalystError(
      'DEVELOPMENT_ONLY',
      'DevAnalyst dev cannot run with NODE_ENV=production.',
    );
  const server = await createServer({
    root: resolve(options.root ?? '.'),
    mode: 'development',
    server: {
      host: '127.0.0.1',
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.strictPort === undefined ? {} : { strictPort: options.strictPort }),
    },
  });
  try {
    if (server.config.isProduction)
      throw new DevAnalystError(
        'DEVELOPMENT_ONLY',
        'The resolved Vite configuration is production-only. Use development mode for DevAnalyst.',
      );
    if (!server.config.plugins.some((plugin) => plugin.name === 'devanalyst')) {
      throw new DevAnalystError(
        'INVALID_CONFIG',
        'Add devanalyst() from @devanalyst/vite-plugin to Vite plugins before running devanalyst dev.',
      );
    }
    await server.listen();
    return server;
  } catch (cause: unknown) {
    await server.close();
    throw cause;
  }
}

/** Executes explicit commands. Only dev installs signal handlers and starts services. */
export async function runCli(args: readonly string[], output: CliOutput): Promise<number> {
  if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0] ?? ''))) {
    output.stdout(help);
    return 0;
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0] ?? '')) {
    output.stdout('0.1.0\n');
    return 0;
  }
  if (args[0] === 'dev' || args[0] === 'doctor') {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        allowPositionals: true,
        options: {
          port: { type: 'string' },
          'strict-port': { type: 'boolean' },
        },
      });
      if (
        parsed.positionals.length > 1 ||
        (args[0] === 'doctor' && Object.keys(parsed.values).length > 0)
      ) {
        throw new DevAnalystError(
          'INVALID_CONFIG',
          'Use one project root and supported command options.',
        );
      }
      const root = parsed.positionals[0] ?? '.';
      const portText = parsed.values.port;
      const port = portText === undefined ? undefined : Number(portText);
      if (
        port !== undefined &&
        (!/^\d+$/.test(portText ?? '') || !Number.isInteger(port) || port < 0 || port > 65535)
      ) {
        throw new DevAnalystError(
          'INVALID_CONFIG',
          'The Vite port must be an integer from 0 through 65535.',
        );
      }
      if (args[0] === 'doctor') {
        const config = await resolveConfig({ root: resolve(root), mode: 'development' }, 'serve');
        const configured = config.plugins.some((plugin) => plugin.name === 'devanalyst');
        output.stdout(
          `${JSON.stringify({ viteVersion, pluginConfigured: configured, bridgeStarted: false, aiStarted: false })}\n`,
        );
        return configured ? 0 : 1;
      }
      const server = await startDevelopmentServer({
        root,
        ...(port === undefined ? {} : { port }),
        ...(parsed.values['strict-port'] === undefined
          ? {}
          : { strictPort: parsed.values['strict-port'] }),
      });
      let stopping = false;
      const cleanup = (): void => {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      };
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        void server
          .close()
          .catch(() => {
            output.stderr(
              `${JSON.stringify(new DevAnalystError('INTERNAL_ERROR', 'Vite shutdown failed. Check remaining development processes.'))}\n`,
            );
            process.exitCode = 1;
          })
          .finally(cleanup);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      server.httpServer?.once('close', cleanup);
      server.printUrls();
      if (process.stdin.isTTY) server.bindCLIShortcuts({ print: true });
      return 0;
    } catch (cause: unknown) {
      const error =
        cause instanceof DevAnalystError
          ? cause
          : new DevAnalystError(
              'INVALID_CONFIG',
              'Unable to start or inspect Vite. Check command options and the project Vite configuration.',
              { cause },
            );
      output.stderr(`${JSON.stringify(error)}\n`);
      return error.code === 'INVALID_CONFIG' ? 2 : 1;
    }
  }
  const error = new DevAnalystError(
    'UNSUPPORTED_FEATURE',
    'This command is unavailable. Run devanalyst --help for supported commands.',
  );
  output.stderr(`${JSON.stringify(error)}\n`);
  return 2;
}
