import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { bridgeBootstrapSchema } from '@devanalyst/core';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function fixture(configured = true): Promise<{ root: string; port: number }> {
  const root = await mkdtemp(resolve('apps/playground-react/.devanalyst-e2e-cli-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const port = await freePort();
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body>CLI host application</body></html>',
  );
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: { dev: `vite --host 127.0.0.1 --port ${port} --strictPort` },
    }),
  );
  await writeFile(
    join(root, 'vite.config.mjs'),
    configured
      ? 'import {devanalyst} from "@devanalyst/vite-plugin"; export default {plugins:[devanalyst()]};'
      : 'export default {};',
  );
  return { root, port };
}

function launch(
  command: string,
  args: string[],
  root: string,
  production = false,
): {
  process: ChildProcess;
  done: Promise<number | null>;
  stderr: () => string;
  stdout: () => string;
} {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: production ? 'production' : 'development',
    NO_COLOR: '1',
  };
  delete environment['FORCE_COLOR'];
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: environment,
  });
  let stderr = '';
  let stdout = '';
  child.stderr?.on('data', (value: Buffer) => {
    stderr = (stderr + value.toString()).slice(-8192);
  });
  child.stdout?.on('data', (value: Buffer) => {
    stdout = (stdout + value.toString()).slice(-8192);
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  cleanup.push(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, 'SIGTERM');
      const deadline = setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Process group already exited. */
        }
      }, 5000);
      await done;
      clearTimeout(deadline);
    }
  });
  return { process: child, done, stderr: () => stderr, stdout: () => stdout };
}

async function ready(port: number): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/__devanalyst/bootstrap`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 10000 },
    )
    .toBe(200);
}

describe('actual CLI and consumer npm dev startup', () => {
  it('npm run dev starts the configured plugin and local bridge automatically', async () => {
    const { root, port } = await fixture();
    launch('npm', ['run', 'dev'], root);
    await ready(port);
    const data = bridgeBootstrapSchema.parse(
      await (await fetch(`http://127.0.0.1:${port}/__devanalyst/bootstrap`)).json(),
    );
    expect(data.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toContain(
      '/__devanalyst/client.js',
    );
  });

  it('dev starts Vite and releases its app and bridge ports on SIGTERM', async () => {
    const { root, port } = await fixture();
    const child = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'dev', root, '--port', String(port), '--strict-port'],
      root,
    );
    await ready(port);
    const data = bridgeBootstrapSchema.parse(
      await (await fetch(`http://127.0.0.1:${port}/__devanalyst/bootstrap`)).json(),
    );
    const bridgePort = Number(new URL(data.endpoint).port);
    if (!child.process.pid) throw new Error('No CLI pid');
    process.kill(-child.process.pid, 'SIGTERM');
    expect(await child.done).toBe(0);
    for (const released of [port, bridgePort]) {
      const check = createServer();
      await new Promise<void>((resolve, reject) => {
        check.once('error', reject);
        check.listen(released, '127.0.0.1', resolve);
      });
      await new Promise<void>((resolve) => check.close(() => resolve()));
    }
  });

  it('doctor reports real configured Vite state without starting services', async () => {
    const { root } = await fixture();
    const child = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'doctor', root],
      root,
    );
    expect(await child.done).toBe(0);
    expect(JSON.parse(child.stdout())).toMatchObject({
      pluginConfigured: true,
      bridgeStarted: false,
      aiStarted: false,
    });
  });

  it('reports missing plugin configuration and refuses production dev execution', async () => {
    const { root } = await fixture(false);
    const missing = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'dev', root],
      root,
    );
    expect(await missing.done).toBe(2);
    expect(JSON.parse(missing.stderr()).code).toBe('INVALID_CONFIG');
    const production = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'dev', root],
      root,
      true,
    );
    expect(await production.done).toBe(1);
    expect(JSON.parse(production.stderr()).code).toBe('DEVELOPMENT_ONLY');
  });
});
