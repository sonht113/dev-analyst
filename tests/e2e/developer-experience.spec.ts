import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst, type DevAnalystPlugin } from '@devanalyst/vite-plugin';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

let root: string, url: string, server: ViteDevServer, plugin: DevAnalystPlugin;
const previousPath = process.env['PATH'];
const app = `export default function App(){return <main><h1>Developer experience</h1><button id="target">Inspect me</button></main>}`;
test.beforeAll(async () => {
  root = await mkdtemp(resolve('apps/playground-react/.devanalyst-dx-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(root, 'index.html'),
    '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  await writeFile(
    join(root, 'src/main.tsx'),
    'import {createRoot} from "react-dom/client";import App from "./App";createRoot(document.getElementById("root")!).render(<App/>);',
  );
  await writeFile(join(root, 'src/App.tsx'), app);
  await writeFile(
    join(root, 'bin/cursor'),
    `#!${process.execPath}\nimport('node:fs').then(fs=>fs.writeFileSync(${JSON.stringify(join(root, 'opened.json'))},JSON.stringify(process.argv.slice(2))));`,
    { mode: 0o700 },
  );
  process.env['PATH'] = `${join(root, 'bin')}:${previousPath ?? ''}`;
  await writeFile(
    join(root, 'devanalyst.config.ts'),
    `import { defineConfig } from '@devanalyst/vite-plugin'; export default defineConfig({ editor:{command:'cursor'}, routes:{exclude:['/private/**']}, environments:{testing:{inspector:{theme:'dark',shortcuts:{toggle:'Control+Shift+KeyD',pin:'Control+KeyP',copy:'Control+KeyY'}},analysis:{depth:'shallow'}}} });`,
  );
  plugin = devanalyst();
  server = await createServer({
    root,
    mode: 'testing',
    configFile: false,
    plugins: [react(), plugin],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  await plugin.api.ready;
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  url = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
  process.env['PATH'] = previousPath;
  if (root) await rm(root, { recursive: true, force: true });
});
test('loads mode configuration and opens mapped source through the authenticated bridge', async ({
  page,
}) => {
  await page.goto(url);
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
  await expect(page.locator('devanalyst-inspector #surface')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#target').focus();
  await page.keyboard.press('Alt+Shift+KeyI');
  expect(await page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspecting)).toBe(
    false,
  );
  await page.keyboard.press('Control+Shift+KeyD');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping.status),
    )
    .toBe('VERIFIED');
  const mapped = await page.evaluate(
    () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping,
  );
  expect(mapped?.status).toBe('VERIFIED');
  if (!mapped?.source?.start) throw new Error('Missing exact source');
  const before = page.url();
  await page.getByRole('button', { name: 'Open source in editor', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Editor navigation' })).toContainText(
    'Source opened in editor.',
  );
  const args: unknown = JSON.parse(await readFile(join(root, 'opened.json'), 'utf8'));
  expect(args).toEqual([
    '--reuse-window',
    '--goto',
    `${await realpath(root)}/src/App.tsx:${mapped.source.start.line}:${mapped.source.start.column}`,
  ]);
  expect(page.url()).toBe(before);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+KeyD');
  await page.keyboard.press('Control+Shift+KeyD');
  expect(await page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspecting)).toBe(
    false,
  );
});
test('excluded routes never queue analysis and diagnostics stay credential-free', async ({
  page,
}) => {
  await page.goto(url + '/private/settings');
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
  await page.locator('#target').click({ modifiers: ['Alt'] });
  await expect.poll(() => plugin.api.getSnapshot().clients.length).toBeGreaterThan(0);
  const client = plugin.api.getSnapshot().clients[0];
  if (!client) throw new Error('Missing client');
  expect(plugin.api.getPageAnalysis(client.id)).toBeNull();
  const data = await (await fetch(url + '/__devanalyst/diagnostics')).text();
  expect(JSON.parse(data)).toMatchObject({ state: 'ready' });
  expect(data).not.toMatch(/token|endpoint|App\.tsx|private\/settings/);
});
