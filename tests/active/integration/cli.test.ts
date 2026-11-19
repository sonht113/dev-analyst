import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { openPersistentCache, cacheFingerprint, type CacheIdentityInput } from '@devanalyst/cache';
import { defineConfig } from '@devanalyst/core';
import { claudeFixture } from '../helpers/claude-fixture.js';
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

  it('setup preserves existing files and generates executable typed configuration', async () => {
    const { root } = await fixture();
    const run = () =>
      launch(process.execPath, [resolve('packages/cli/dist/bin.js'), 'setup', root], root);
    const created = run();
    expect(await created.done).toBe(0);
    const original = await readFile(join(root, 'devanalyst.config.ts'), 'utf8');
    expect(original).toContain('enabled: false');
    const again = run();
    expect(await again.done).toBe(2);
    expect(await readFile(join(root, 'devanalyst.config.ts'), 'utf8')).toBe(original);
    const doctor = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'doctor', root],
      root,
    );
    expect(await doctor.done).toBe(0);
    expect(JSON.parse(doctor.stdout())).toMatchObject({
      configurationValid: true,
      claude: { compatible: expect.any(Boolean) },
    });
  });

  it('reports invalid configuration safely without starting bridge services', async () => {
    const { root } = await fixture();
    await writeFile(
      join(root, 'devanalyst.config.ts'),
      "export default { ai:{enabled:'PRIVATE_CONFIG_VALUE'} }",
    );
    const doctor = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'doctor', root],
      root,
    );
    expect(await doctor.done).toBe(2);
    expect(JSON.parse(doctor.stderr())).toMatchObject({
      code: 'INVALID_CONFIG',
      message: expect.stringContaining('ai.enabled'),
    });
    expect(doctor.stderr()).not.toContain('PRIVATE_CONFIG_VALUE');
    const dev = launch(process.execPath, [resolve('packages/cli/dist/bin.js'), 'dev', root], root);
    expect(await dev.done).toBe(2);
    await writeFile(
      join(root, 'devanalyst.config.ts'),
      "export default {workspaceRoot:'missing-private-workspace'}",
    );
    const workspace = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'doctor', root],
      root,
    );
    expect(await workspace.done).toBe(1);
    expect(JSON.parse(workspace.stderr())).toMatchObject({
      code: 'WORKSPACE_ACCESS_DENIED',
      message: expect.stringContaining('workspaceRoot'),
    });
    expect(workspace.stderr()).not.toContain('missing-private-workspace');
  });

  it('doctor uses effective inline AI consent and configured Claude executable', async () => {
    const { root } = await fixture();
    const cli = await claudeFixture();
    cleanup.push(() => rm(cli.root, { recursive: true, force: true }));
    await writeFile(
      join(root, 'vite.config.mjs'),
      `import {devanalyst} from '@devanalyst/vite-plugin'; export default {plugins:[devanalyst({config:{ai:{enabled:true,permittedPaths:['src/**']}},preanalysis:{claude:{executable:${JSON.stringify(cli.executable)}}}})]};`,
    );
    const doctor = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'doctor', root],
      root,
    );
    expect(await doctor.done).toBe(0);
    expect(JSON.parse(doctor.stdout())).toMatchObject({
      aiEnabled: true,
      claude: { compatible: true, authenticated: true },
      bridgeStarted: false,
      aiStarted: false,
    });
    expect((await cli.calls()).some((call) => call.input)).toBe(false);
  });

  it('status inspects a running bridge and reports stopped or unsafe destinations', async () => {
    const { root, port } = await fixture();
    const dev = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'dev', root, '--port', String(port), '--strict-port'],
      root,
    );
    await ready(port);
    const run = (url: string) =>
      launch(
        process.execPath,
        [resolve('packages/cli/dist/bin.js'), 'status', root, '--url', url],
        root,
      );
    const status = run(`http://127.0.0.1:${port}/`);
    expect(await status.done).toBe(0);
    expect(JSON.parse(status.stdout())).toMatchObject({ state: 'ready', clients: 0 });
    expect(status.stdout()).not.toMatch(/token|endpoint/);
    const denied = run('https://example.com/PRIVATE_URL');
    expect(await denied.done).toBe(2);
    expect(denied.stderr()).not.toContain('PRIVATE_URL');
    if (!dev.process.pid) throw new Error('No pid');
    process.kill(-dev.process.pid, 'SIGTERM');
    await dev.done;
    const stopped = run(`http://127.0.0.1:${port}/`);
    expect(await stopped.done).toBe(1);
    expect(JSON.parse(stopped.stderr())).toMatchObject({ code: 'BRIDGE_DISCONNECTED' });
  });

  it('analyzes allowed React sources without execution and operates on the actual SQLite cache', async () => {
    const { root } = await fixture();
    await mkdir(join(root, 'src'));
    await writeFile(
      join(root, 'src/App.tsx'),
      'export default function App(){return <button onClick={()=>fetch("/api/orders")}>Save</button>}',
    );
    const analyze = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'analyze', 'src/App.tsx', root],
      root,
    );
    expect(await analyze.done).toBe(0);
    expect(analyze.stdout()).toContain('/api/orders');
    const denied = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'analyze', '../PRIVATE_PATH', root],
      root,
    );
    expect(await denied.done).toBe(1);
    expect(denied.stderr()).not.toContain('PRIVATE_PATH');
    const config = defineConfig({});
    const store = await openPersistentCache({
      workspaceRoot: root,
      source: config.source,
      directory: config.cache.directory,
    });
    const revision = createHash('sha256')
      .update(await readFile(join(root, 'src/App.tsx')))
      .digest('hex');
    const identity: CacheIdentityInput = {
      scope: 'component',
      kind: 'translation',
      subject: cacheFingerprint('src/App.tsx'),
      revision,
      policy: cacheFingerprint('cli-test'),
      provider: 'claude-code',
      model: 'sonnet',
      schemaVersion: 'translation-1',
      language: 'vi',
    };
    const lookup = await store.get(identity);
    expect(
      (
        await store.put({
          identity,
          generation: lookup.generation,
          hashes: { 'src/App.tsx': revision },
          payload: {
            type: 'translation',
            findings: [
              {
                id: randomUUID(),
                type: 'translation',
                explanation: 'Lưu',
                confidence: 'UNKNOWN',
                evidence: null,
                analyzedAt: new Date().toISOString(),
                cacheStatus: 'miss',
              },
            ],
          },
        })
      ).stored,
    ).toBe(true);
    expect((await store.inspect()).entries).toBe(1);
    await store.close();
    const clear = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'cache', 'clear', root],
      root,
    );
    expect(await clear.done).toBe(0);
    expect(JSON.parse(clear.stdout())).toMatchObject({
      enabled: true,
      cleared: 1,
      inspection: { persistent: true, entries: 0 },
    });
    const inspect = launch(
      process.execPath,
      [resolve('packages/cli/dist/bin.js'), 'cache', 'inspect', root],
      root,
    );
    expect(await inspect.done).toBe(0);
    expect(JSON.parse(inspect.stdout()).inspection.entries).toBe(0);
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
