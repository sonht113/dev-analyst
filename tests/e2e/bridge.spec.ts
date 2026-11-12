import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst, type DevAnalystPlugin } from '@devanalyst/vite-plugin';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { BrowserBridgeSnapshot } from '../../packages/inspector/src/bridge-runtime.js';

let root: string;
let server: ViteDevServer;
let plugin: DevAnalystPlugin;
let url: string;

async function snapshot(page: Page): Promise<BrowserBridgeSnapshot | null> {
  return page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot() ?? null);
}

test.beforeAll(async () => {
  root = await mkdtemp(resolve('apps/playground-react/.devanalyst-e2e-'));
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  await writeFile(
    join(root, 'src/main.tsx'),
    'import {createRoot} from "react-dom/client"; import App from "./App"; const root=document.getElementById("root"); if(root===null) throw new Error("Missing root"); createRoot(root).render(<App/>);',
  );
  await writeFile(
    join(root, 'src/App.tsx'),
    'import {useState} from "react"; export default function App(){const [count,setCount]=useState(0);return <main><h1>Before HMR</h1><button onClick={()=>setCount(count+1)}>Count: {count}</button></main>;}',
  );
  plugin = devanalyst();
  server = await createServer({
    root,
    cacheDir: join(root, 'node_modules/.vite'),
    configFile: false,
    plugins: [react(), plugin],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  await plugin.api.ready;
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind');
  url = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await expect.poll(async () => (await snapshot(page))?.status).toBe('connected');
  await expect.poll(async () => (await snapshot(page))?.serverRoute?.pathname).toBe('/');
});

test('automatically connects, tracks every navigation API without reload, and excludes sensitive route values', async ({
  page,
}) => {
  const initial = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() =>
    history.pushState(
      { keep: 'host-state' },
      '',
      '/orders?token=private-value#/detail?key=private-value',
    ),
  );
  await expect
    .poll(async () => (await snapshot(page))?.serverRoute)
    .toEqual({ pathname: '/orders', hashPath: '/detail', reason: 'pushState' });
  expect(
    plugin.api.getSnapshot().clients.some((client) => client.route?.pathname === '/orders'),
  ).toBe(true);
  expect(await page.evaluate(() => history.state)).toEqual({ keep: 'host-state' });
  expect(JSON.stringify(plugin.api.getSnapshot())).not.toContain('private-value');
  await page.evaluate(() =>
    history.replaceState({ keep: 'replaced' }, '', '/settings#opaque-private-value'),
  );
  await expect
    .poll(async () => (await snapshot(page))?.serverRoute)
    .toEqual({ pathname: '/settings', hashPath: null, reason: 'replaceState' });
  await page.evaluate(() => history.back());
  await expect.poll(async () => (await snapshot(page))?.serverRoute?.pathname).toBe('/');
  await page.evaluate(() => {
    location.hash = '/hash-route?token=private-value';
  });
  await expect
    .poll(async () => (await snapshot(page))?.serverRoute)
    .toEqual({ pathname: '/', hashPath: '/hash-route', reason: 'hashchange' });
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(initial);
  expect(JSON.stringify(await snapshot(page))).not.toContain('private-value');
});

test('keeps React Fast Refresh functional and reports source changes without losing state', async ({
  page,
}) => {
  const before = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  const file = join(root, 'src/App.tsx');
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original.replace('Before HMR', 'After HMR'));
    await expect(page.getByRole('heading', { name: 'After HMR' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Count: 1', exact: true })).toBeVisible();
    await expect.poll(async () => (await snapshot(page))?.lastSource?.file).toBe('src/App.tsx');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(before);
  } finally {
    await writeFile(file, original);
  }
});

test('reconnects with a new authenticated session and stops without changing host navigation', async ({
  page,
}) => {
  const first = (await snapshot(page))?.clientId;
  const before = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() => window.__DEVANALYST_BRIDGE__?.reconnect());
  await expect.poll(async () => (await snapshot(page))?.status).toBe('connected');
  await expect.poll(async () => (await snapshot(page))?.clientId).not.toBe(first);
  await expect.poll(() => plugin.api.getSnapshot().clients.length).toBe(1);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(before);
  await page.evaluate(() => window.__DEVANALYST_BRIDGE__?.stop());
  await expect.poll(() => plugin.api.getSnapshot().clients.length).toBe(0);
  expect(await page.evaluate(() => history.pushState.toString().includes('[native code]'))).toBe(
    true,
  );
  await page.evaluate(() => history.pushState({ preserved: true }, '', '/after-stop'));
  expect(await page.evaluate(() => history.state)).toEqual({ preserved: true });
  expect(await snapshot(page)).toBeNull();
});

test('pauses for page lifecycle suspension, resumes, and preserves native navigation errors', async ({
  page,
}) => {
  const original = (await snapshot(page))?.clientId;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await expect.poll(() => plugin.api.getSnapshot().clients.length).toBe(0);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect.poll(async () => (await snapshot(page))?.status).toBe('connected');
  expect((await snapshot(page))?.clientId).not.toBe(original);
  const error = await page.evaluate(() => {
    try {
      history.pushState({}, '', 'https://untrusted.example/');
      return null;
    } catch (cause: unknown) {
      return cause instanceof DOMException ? cause.name : 'unexpected';
    }
  });
  expect(error).toBe('SecurityError');
  expect((await snapshot(page))?.route.pathname).toBe('/');
});

test('recovers from unavailable bootstrap responses through bounded automatic retries', async ({
  page,
}) => {
  let failures = 0;
  await page.route('**/__devanalyst/bootstrap', async (route) => {
    if (failures < 2) {
      failures += 1;
      await route.fulfill({ status: 503, body: '{}' });
    } else await route.continue();
  });
  await page.reload();
  await expect
    .poll(async () => (await snapshot(page))?.status, { timeout: 10_000 })
    .toBe('connected');
  expect(failures).toBe(2);
  await expect(page.getByRole('button', { name: 'Count: 0', exact: true })).toBeVisible();
});

test('restores a fresh bridge after a real Vite restart', async ({ page }) => {
  const first = (await snapshot(page))?.clientId;
  await server.restart();
  await plugin.api.ready;
  await expect
    .poll(async () => (await snapshot(page))?.status, { timeout: 15_000 })
    .toBe('connected');
  await expect
    .poll(async () => (await snapshot(page))?.clientId, { timeout: 15_000 })
    .not.toBe(first);
  await page.evaluate(() => history.pushState({}, '', '/after-restart'));
  await expect
    .poll(async () => (await snapshot(page))?.serverRoute?.pathname)
    .toBe('/after-restart');
});
