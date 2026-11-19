import { DevAnalystError } from '@devanalyst/core';
import {
  loadConfiguration,
  inspectClaude,
  manageCache,
  analyzeSource,
  openSource,
  type DevAnalystPluginApi,
} from '@devanalyst/vite-plugin';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer, resolveConfig, version as viteVersion, type ViteDevServer } from 'vite';

function doctorApi(
  value: unknown,
): value is Pick<DevAnalystPluginApi, 'getConfigurationDiagnostic' | 'getDoctorDiagnostics'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getConfigurationDiagnostic' in value &&
    typeof value.getConfigurationDiagnostic === 'function' &&
    'getDoctorDiagnostics' in value &&
    typeof value.getDoctorDiagnostics === 'function'
  );
}

export interface CliOutput {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

const help = `DevAnalyst — AI-Powered Frontend Code Inspector

Usage: devanalyst [--help | --version]
  dev [root] [--port PORT] [--strict-port] [--mode MODE]
  setup [root]
  doctor [root] [--mode MODE]
  status [root] [--url http://127.0.0.1:5173/] [--mode MODE]
  cache [inspect|clear] [root] [--mode MODE]
  analyze <workspace-relative-file> [root] [--mode MODE]
  open <workspace-relative-file> [root] [--line N] [--column N] [--mode MODE]

Register devanalyst() from @devanalyst/vite-plugin in Vite plugins once.
The development bridge starts automatically. Configuration: devanalyst.config.ts.
setup creates a safe configuration without overwriting existing files or enabling AI.
Stop Vite before offline cache administration; restart it after clearing.
`;

export interface DevelopmentServerOptions {
  readonly root?: string;
  readonly mode?: string;
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
    mode: options.mode ?? 'development',
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
  if (['dev', 'doctor', 'setup', 'status', 'cache', 'analyze', 'open'].includes(args[0] ?? '')) {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        allowPositionals: true,
        options: {
          port: { type: 'string' },
          mode: { type: 'string' },
          url: { type: 'string' },
          line: { type: 'string' },
          column: { type: 'string' },
          'strict-port': { type: 'boolean' },
        },
      });
      const command = args[0];
      const allowed =
        command === 'dev'
          ? ['port', 'strict-port', 'mode']
          : command === 'status'
            ? ['url', 'mode']
            : command === 'open'
              ? ['line', 'column', 'mode']
              : command === 'setup'
                ? []
                : ['mode'];
      const hasSubject = ['cache', 'analyze', 'open'].includes(command ?? '');
      if (
        Object.keys(parsed.values).some((key) => !allowed.includes(key)) ||
        parsed.positionals.length > (hasSubject ? 2 : 1)
      )
        throw new DevAnalystError(
          'INVALID_CONFIG',
          'Use one project root and supported command options; see devanalyst --help.',
        );
      const subject = hasSubject ? parsed.positionals[0] : undefined;
      const root = resolve(parsed.positionals[hasSubject ? 1 : 0] ?? '.');
      const mode = parsed.values.mode ?? 'development';
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(mode))
        throw new DevAnalystError(
          'INVALID_CONFIG',
          'Use a Vite mode name with letters, numbers, dashes or underscores.',
        );
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
      if (command === 'setup') {
        try {
          await writeFile(
            resolve(root, 'devanalyst.config.ts'),
            "import { defineConfig } from '@devanalyst/vite-plugin';\n\nexport default defineConfig({\n  source: { include: ['src/**'] },\n  ai: { enabled: false },\n});\n",
            { flag: 'wx', mode: 0o600 },
          );
        } catch {
          throw new DevAnalystError(
            'INVALID_CONFIG',
            'Configuration already exists or is not writable. Preserve it and edit devanalyst.config.ts manually.',
          );
        }
        output.stdout(
          'Created devanalyst.config.ts with AI disabled. Register devanalyst() in your Vite plugins, then run your normal Vite dev command. No bridge ports or tokens need manual setup.\n',
        );
        return 0;
      }
      const settings = await loadConfiguration(root, mode);
      if (command === 'doctor') {
        const config = await resolveConfig({ root, mode }, 'serve');
        const configured = config.plugins.some((plugin) => plugin.name === 'devanalyst');
        const pluginApi: unknown = config.plugins.find(
          (plugin) => plugin.name === 'devanalyst',
        )?.api;
        if (doctorApi(pluginApi)) {
          const diagnostic: unknown = pluginApi.getConfigurationDiagnostic();
          if (diagnostic !== null)
            throw new DevAnalystError(
              'INVALID_CONFIG',
              'Invalid DevAnalyst options in Vite configuration. Check inline config and loopback bridge settings, then retry doctor.',
            );
        }
        const diagnostics = doctorApi(pluginApi) ? await pluginApi.getDoctorDiagnostics() : null;
        const claude = diagnostics?.claude ?? (await inspectClaude(root, mode));
        const aiEnabled = diagnostics?.aiEnabled ?? settings.ai.enabled;
        output.stdout(
          `${JSON.stringify({ viteVersion, nodeVersion: process.versions.node, pluginConfigured: configured, configurationValid: true, aiEnabled, bridgeStarted: false, aiStarted: false, claude, recovery: configured ? 'Run your Vite dev command, then devanalyst status --url <Vite URL>. Claude compatibility/authentication is separate from live inference readiness.' : 'Add devanalyst() from @devanalyst/vite-plugin to Vite plugins.' })}\n`,
        );
        return configured && (!aiEnabled || (claude.compatible && claude.authenticated === true))
          ? 0
          : 1;
      }
      if (command === 'status') {
        const url = new URL(parsed.values.url ?? 'http://127.0.0.1:5173/');
        if (
          url.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new DevAnalystError(
            'INVALID_CONFIG',
            'Use the local HTTP Vite base URL without credentials, query or fragment.',
          );
        url.pathname = url.pathname.replace(/\/?$/, '/') + '__devanalyst/diagnostics';
        try {
          const response = await fetch(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(3000),
          });
          const reader = response.body?.getReader();
          let text = '';
          if (!response.ok || !reader) throw new Error('Unavailable');
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              text += new TextDecoder().decode(chunk.value);
              if (text.length > 4096) throw new Error('Too large');
            }
          } finally {
            await reader.cancel();
          }
          const value: unknown = JSON.parse(text);
          if (
            typeof value !== 'object' ||
            value === null ||
            !('state' in value) ||
            !['ready', 'starting', 'failed', 'inactive', 'closed'].includes(String(value.state)) ||
            !('clients' in value) ||
            typeof value.clients !== 'number' ||
            !Number.isInteger(value.clients) ||
            value.clients < 0 ||
            value.clients > 128
          )
            throw new Error('Invalid diagnostics');
          output.stdout(
            `${JSON.stringify({ state: value.state, clients: value.clients, recovery: 'If disconnected, reload the browser and allow the loopback WebSocket in CSP connect-src.' })}\n`,
          );
          return value.state === 'ready' ? 0 : 1;
        } catch {
          throw new DevAnalystError(
            'BRIDGE_DISCONNECTED',
            'Cannot reach DevAnalyst diagnostics. Start Vite with devanalyst(), use --url with its exact HTTP base URL, and check configuration/CSP.',
          );
        }
      }
      if (command === 'cache') {
        if (!['inspect', 'clear'].includes(subject ?? 'inspect'))
          throw new DevAnalystError(
            'INVALID_CONFIG',
            'Use cache inspect [root] or cache clear [root]; stop Vite first.',
          );
        const result = await manageCache(root, mode, subject === 'clear');
        output.stdout(`${JSON.stringify(result)}\n`);
        return 'inspection' in result && result.inspection?.diagnostic ? 1 : 0;
      }
      if (command === 'analyze' || command === 'open') {
        if (!subject)
          throw new DevAnalystError(
            'INVALID_CONFIG',
            'Specify a workspace-relative source file. See devanalyst --help.',
          );
        if (command === 'analyze')
          output.stdout(`${JSON.stringify(await analyzeSource(root, mode, subject))}\n`);
        else {
          const line = Number(parsed.values.line ?? 1),
            column = Number(parsed.values.column ?? 1);
          await openSource(root, settings, { file: subject, start: { line, column }, end: null });
          output.stdout('Source opened in the configured editor.\n');
        }
        return 0;
      }
      const server = await startDevelopmentServer({
        root,
        mode,
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
