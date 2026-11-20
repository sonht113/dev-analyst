import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
async function outputs(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await outputs(path)));
    else if (/\.(?:js|mjs|html)$/.test(entry.name)) result.push(path);
  }
  return result;
}
for (const target of [
  { framework: 'vue', bundler: 'vite' },
  { framework: 'nuxt', bundler: 'vite' },
  { framework: 'next', bundler: 'webpack' },
  { framework: 'next', bundler: 'turbopack' },
]) {
  it(`${target.framework}/${target.bundler}: native production build and server exclude DevAnalyst`, async () => {
    const base = resolve('apps/playground-' + target.framework),
      root = await mkdtemp(join(base, '.devanalyst-production-'));
    const files =
      target.framework === 'vue'
        ? ['src', 'index.html', 'vite.config.ts', 'demo-api.ts', 'package.json']
        : target.framework === 'next'
          ? ['app', 'next.config.ts', 'package.json']
          : ['app', 'server', 'nuxt.config.ts', 'package.json'];
    let stop: (() => Promise<void>) | undefined;
    try {
      for (const file of files) await cp(join(base, file), join(root, file), { recursive: true });
      await writeFile(
        join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            jsx: 'preserve',
            strict: true,
            skipLibCheck: true,
            lib: ['ES2024', 'DOM'],
            types: ['node'],
          },
          include: ['**/*.ts', '**/*.tsx', '**/*.vue'],
          exclude: ['node_modules'],
        }),
      );
      if (target.framework === 'next')
        await cp(join(root, 'tsconfig.json'), join(root, 'tsconfig.build.json'));
      const env = {
        ...process.env,
        NODE_ENV: 'production',
        NUXT_TELEMETRY_DISABLED: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      };
      const command = resolve(
        base,
        'node_modules/.bin',
        target.framework === 'vue' ? 'vite' : target.framework === 'nuxt' ? 'nuxt' : 'next',
      );
      const build = await execute(
        command,
        ['build', ...(target.framework === 'next' ? ['--' + target.bundler] : [])],
        { cwd: root, env, timeout: 150000, maxBuffer: 2 * 1024 * 1024 },
      );
      expect(build.stderr).not.toContain('DevAnalyst');
      const directories =
        target.framework === 'next'
          ? ['.next/static', '.next/server/app']
          : target.framework === 'nuxt'
            ? ['.output']
            : ['dist'];
      let checked = 0;
      for (const directory of directories)
        for (const file of await outputs(join(root, directory))) {
          const text = await readFile(file, 'utf8');
          for (const marker of [
            '/__devanalyst/',
            '__DEVANALYST_BRIDGE__',
            '__DEVANALYST_INSPECTOR__',
            'analysis-toggle',
            'devanalyst.auth.',
            'vueSourceDirective',
            'vDevanalystOrigin',
            'devanalyst.mapping.registry',
            '__devanalystBinding',
            'vue-directive-v1',
            'compile-time-ref-v1',
            'DEVANALYST_NEXT_COMPILER_SOCKET',
            'devanalyst-compiler-',
            'analysis.sqlite',
            'createClaudeCodeProvider',
          ])
            expect(text, file).not.toContain(marker);
          if (directory === 'dist' || directory === '.next/static' || file.includes('/public/'))
            expect(text).not.toContain(root);
          checked++;
        }
      expect(checked).toBeGreaterThan(0);
      const port = await freePort();
      const args =
        target.framework === 'next'
          ? ['start', '--hostname', '127.0.0.1', '--port', String(port)]
          : target.framework === 'vue'
            ? ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
            : ['.output/server/index.mjs'];
      const child = spawn(target.framework === 'nuxt' ? process.execPath : command, args, {
        cwd: root,
        env: { ...env, HOST: '127.0.0.1', PORT: String(port) },
        shell: false,
        stdio: 'ignore',
      });
      const exited = new Promise<void>((done, reject) => {
        child.once('exit', () => done());
        child.once('error', reject);
      });
      stop = async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
      };
      const url = `http://127.0.0.1:${port}`;
      await expect
        .poll(
          async () => {
            try {
              return (await fetch(url, { signal: AbortSignal.timeout(1000) })).status;
            } catch {
              return 0;
            }
          },
          { timeout: 20000 },
        )
        .toBe(200);
      for (const path of [
        '/__devanalyst/diagnostics',
        '/__devanalyst/client.js',
        '/__devanalyst/bootstrap',
      ]) {
        const response = await fetch(url + path, { signal: AbortSignal.timeout(3000) });
        if (target.framework === 'vue')
          expect(response.headers.get('content-type')).toContain('text/html');
        else expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('__DEVANALYST_BRIDGE__');
      }
    } finally {
      await stop?.();
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 180000);
}
