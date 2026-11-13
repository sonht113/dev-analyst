import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { devanalyst, type ViteIntegrationOptions } from '@devanalyst/vite-plugin';
import { createSourceMapping } from '../../../packages/vite-plugin/src/mapping.js';
import { createWorkspaceAccess } from '../../../packages/vite-plugin/src/workspace.js';
import { defineConfig } from '@devanalyst/core';
const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});
async function directory() {
  const path = await mkdtemp(resolve('apps/playground-react/.devanalyst-e2e-mapping-'));
  disposals.push(() => rm(path, { recursive: true, force: true }));
  await mkdir(join(path, 'src'));
  return path;
}
async function start(options: ViteIntegrationOptions = {}, base = '/') {
  const root = await directory();
  await writeFile(
    join(root, 'src/App.tsx'),
    'export function App(){ return <button onClick={()=>explode()}>保存</button>; }',
  );
  await writeFile(join(root, 'index.html'), '<div id="root"></div>');
  const plugin = devanalyst(options);
  const server = await createServer({
    root,
    configFile: false,
    plugins: [react(), plugin],
    optimizeDeps: { noDiscovery: true, include: [] },
    base,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
    cacheDir: join(root, 'node_modules/.vite'),
  });
  disposals.push(() => server.close());
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('No server');
  return { root, server, plugin, url: `http://127.0.0.1:${address.port}` };
}
async function transformed(server: ViteDevServer, path = '/src/App.tsx') {
  const result = await server.transformRequest(path);
  if (!result) throw new Error('No transformed module');
  return result;
}
describe('real Vite JSX provenance transforms', () => {
  it('instruments original React TSX before Vite and composes source maps through the actual React transform', async () => {
    const { server, root, plugin } = await start();
    const result = await transformed(server);
    expect(result.code).toContain('registerSourceModule');
    expect(result.code).toContain('mapping-runtime.js');
    const marker = result.code.indexOf('explode()');
    const lines = result.code.slice(0, marker).split('\n');
    if (!result.map) throw new Error('Missing composed map');
    const mapped = originalPositionFor(new TraceMap(JSON.stringify(result.map)), {
      line: lines.length,
      column: lines.at(-1)?.length ?? 0,
    });
    expect(mapped.source).toContain('src/App.tsx');
    expect(mapped.line).toBe(1);
    expect(mapped.column).toBe(51);
    expect(plugin.api.getMappingDiagnostics()).toEqual([
      expect.objectContaining({ file: 'src/App.tsx', status: 'instrumented', sites: 1 }),
    ]);
    expect(result.code).not.toContain(root + '\\');
  });
  it('serves the exact mapping runtime on base paths with origin, query and path protections', async () => {
    const { server, url } = await start({}, '/app/');
    const result = await transformed(server, '/src/App.tsx');
    expect(result.code).toContain('/app/__devanalyst/mapping-runtime.js');
    const response = await fetch(url + '/app/__devanalyst/mapping-runtime.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(
      (
        await fetch(url + '/app/__devanalyst/mapping-runtime.js', {
          headers: { Origin: 'http://foreign.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(url + '/app/__devanalyst/mapping-runtime.js?file=src/App.tsx')).status,
    ).toBe(403);
    expect((await fetch(url + '/app/__devanalyst/source.tsx')).status).toBe(404);
  });
  it.each([{ enabled: false }, { config: { inspector: { enabled: false } } }])(
    'leaves disabled configurations untouched: %j',
    async (options) => {
      const { server, plugin } = await start(options);
      expect((await transformed(server)).code).not.toContain('registerSourceModule');
      expect(plugin.api.getMappingDiagnostics()).toEqual([]);
    },
  );
  it('does not instrument SSR modules', async () => {
    const { server, plugin } = await start();
    const result = await server.environments['ssr']?.transformRequest('/src/App.tsx');
    expect(result?.code).not.toContain('registerSourceModule');
    expect(plugin.api.getMappingDiagnostics()).toEqual([]);
  });
  it('diagnoses upstream rewrites and respects real source access exclusions/symlink containment', async () => {
    const root = await directory();
    const outside = await mkdtemp(join(tmpdir(), 'devanalyst-outside-'));
    disposals.push(() => rm(outside, { recursive: true, force: true }));
    const source = 'export const App=()=> <button/>';
    await writeFile(join(root, 'src/App.tsx'), source);
    await writeFile(join(outside, 'Outside.tsx'), source);
    await symlink(join(outside, 'Outside.tsx'), join(root, 'src/escape.tsx'));
    await writeFile(join(root, 'src/.env.tsx'), source);
    const config = defineConfig({});
    const mapping = createSourceMapping(
      createWorkspaceAccess(root, config.source),
      '/__devanalyst/mapping-runtime.js',
    );
    expect(await mapping.transform(source + ' ', join(root, 'src/App.tsx'))).toBeNull();
    expect(mapping.diagnostics()[0]?.reason).toBe('TRANSFORMED_INPUT');
    expect(await mapping.transform(source, join(root, 'src/escape.tsx'))).toBeNull();
    expect(await mapping.transform(source, join(root, 'src/.env.tsx'))).toBeNull();
    expect(await mapping.transform(source, join(root, 'src/App.tsx') + '?raw')).toBeNull();
    expect(await mapping.transform(source, join(root, 'src/App.tsx'))).not.toBeNull();
    const snapshot = mapping.diagnostics();
    Reflect.set(snapshot[0] ?? {}, 'file', 'wrong');
    expect(mapping.diagnostics()[0]?.file).toBe('src/App.tsx');
    mapping.stop();
    expect(await mapping.transform(source, join(root, 'src/App.tsx'))).toBeNull();
  });
});
