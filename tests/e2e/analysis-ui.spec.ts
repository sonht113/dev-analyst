import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst, type DevAnalystPlugin } from '@devanalyst/vite-plugin';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { claudeFixture } from '../active/helpers/claude-fixture.js';

let root: string, url: string, server: ViteDevServer, plugin: DevAnalystPlugin;
let cli: Awaited<ReturnType<typeof claudeFixture>>;
declare global {
  interface Window {
    inspectionTransitions: { state: string; confident: boolean }[];
  }
}
const app = `import {useState} from 'react';import {postOrder} from './service';import Private from './Private';
export default function App(){const [n,setN]=useState(0),[busy,setBusy]=useState(false),[visible]=useState(true);
function save(){setBusy(true);postOrder();window.location.assign('/orders')}
return <main><h1>日本語の注文画面</h1><button id="counter" onClick={()=>setN(n+1)}>Count {n}</button>
{visible&&<button id="save" disabled={busy} onClick={save}>保存</button>}
<button id="rare" onClick={save}>申請内容を承認する</button>
<button id="failure" onClick={save}>失敗を試す</button>
<button id="unknown" onClick={externalHandler}>確認処理</button><Private/></main>}
const externalHandler=globalThis.unresolvedHandler;`;
const state = (page: Page) =>
  page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspection ?? null);
const panel = (page: Page) => page.locator('devanalyst-inspector #panel');
async function open(page: Page, selector = '#save') {
  await page.locator(selector).click({ modifiers: ['Alt'], position: { x: 1, y: 1 } });
  await expect.poll(() => state(page)).not.toBeNull();
}
async function start() {
  plugin = devanalyst({
    config: { ai: { enabled: true, permittedPaths: ['src/**'], timeoutMs: 8000 } },
    preanalysis: { claude: { executable: cli.executable } },
  });
  server = await createServer({
    root,
    configFile: false,
    plugins: [react(), plugin],
    cacheDir: join(root, 'node_modules/.vite'),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, watch: { useFsEvents: false } },
  });
  await server.listen();
  await plugin.api.ready;
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing Vite server');
  url = `http://127.0.0.1:${address.port}`;
}
async function inferenceCount() {
  return (await cli.calls()).filter((call) => call.input).length;
}
test.beforeAll(async () => {
  root = await mkdtemp(resolve('apps/playground-react/.devanalyst-analysis-ui-'));
  await mkdir(join(root, 'src'));
  cli = await claudeFixture();
  const executable = await readFile(cli.executable, 'utf8');
  const marker = 'if(scenario.delay)setTimeout(finish,scenario.delay);else finish();';
  if (!executable.includes(marker)) throw new Error('Missing mock delay boundary');
  await writeFile(
    cli.executable,
    executable.replace(marker, 'setTimeout(finish,context.uiText?.length ? 30 : 800);'),
  );
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
    join(root, 'src/service.ts'),
    'export function postOrder(){return request()} function request(){return fetch("/api/orders",{method:"POST"})}',
  );
  await writeFile(
    join(root, 'src/Private.tsx'),
    'export default function Private(){return <section data-private><button id="private">PRIVATE_RUNTIME_TEXT</button><input id="password" type="password" defaultValue="PRIVATE_PASSWORD"/></section>}',
  );
  await start();
});
test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
  if (cli) await rm(cli.root, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
});

test('hover renders lightweight translation without AI and preserves ordinary host interaction', async ({
  page,
}) => {
  const before = await inferenceCount();
  await page.locator('#save').hover();
  await expect(panel(page)).toHaveAttribute('role', 'tooltip');
  await expect(panel(page).locator('[data-testid="translation-text"]')).toHaveText('Lưu');
  await expect(panel(page).locator('.analysis-content')).toBeHidden();
  await page.locator('#counter').click();
  await expect(page.locator('#counter')).toHaveText('Count 1');
  expect(await inferenceCount()).toBe(before);
});

test('Alt+Click progressively displays scoped evidence, call chains and independent copy actions', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await expect
    .poll(async () => (await state(page))?.analysis.state, { timeout: 15000 })
    .toBe('READY');
  expect((await state(page))?.ai.state).not.toBe('READY');
  await expect(panel(page).locator('#hint')).toContainText('App · src/App.tsx');
  for (const group of ['handler', 'call', 'api', 'navigation', 'state', 'visibility', 'disabled'])
    await expect(panel(page).locator(`[data-group="${group}"] .finding`).first()).toBeAttached();
  await expect(panel(page).locator('[data-group="api"]')).toContainText('/api/orders');
  await expect.poll(async () => (await state(page))?.ai.state, { timeout: 15000 }).toBe('READY');
  await expect(panel(page).locator('[data-group="purpose"]')).toContainText('INFERRED');
  await expect(panel(page).locator('#details')).toHaveText('保存');
  await page.getByRole('button', { name: 'Copy original', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('保存');
  await page.getByRole('button', { name: 'Copy translation', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Lưu');
  await page.getByRole('button', { name: 'Copy analysis', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('not-evaluated');
  const sourceLink = panel(page).locator('[data-group="handler"] .source-link').first();
  const originalUrl = page.url();
  await sourceLink.click();
  await expect(sourceLink).toHaveAttribute('aria-expanded', 'true');
  await expect(panel(page).locator('[data-group="handler"] .source-code').first()).toContainText(
    'onClick',
  );
  expect(page.url()).toBe(originalUrl);
  await page.getByRole('searchbox', { name: 'Filter call chains' }).fill('does-not-match');
  await expect(panel(page).locator('[data-group="call"] .finding')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Filter call chains' }).fill('request');
  await expect(panel(page).locator('[data-group="call"] .finding').first()).toBeAttached();
  await page.getByLabel('All findings', { exact: true }).selectOption('INFERRED');
  await expect(panel(page).locator('.confidence.verified')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#counter')).toHaveText('Count 0');
  await page.locator('#counter').click();
  await expect(page.locator('#counter')).toHaveText('Count 1');
});

test('uncached source translation completes before deeper AI and repeated inspection avoids provider calls', async ({
  page,
}) => {
  await open(page, '#rare');
  await expect
    .poll(async () => (await state(page))?.translation.state, { timeout: 15000 })
    .toBe('READY');
  expect((await state(page))?.ai.state).not.toBe('READY');
  await expect(panel(page).locator('#details')).toHaveText('申請内容を承認する');
  await expect.poll(async () => (await state(page))?.ai.state, { timeout: 15000 }).toBe('READY');
  const calls = await inferenceCount();
  await page.keyboard.press('Escape');
  await open(page, '#rare');
  await expect.poll(async () => (await state(page))?.ai.cache).toBe('fresh');
  await expect.poll(async () => (await state(page))?.translation.cache).toBe('fresh');
  expect(await inferenceCount()).toBe(calls);
  await expect(panel(page).locator('[data-testid="translation-status"]')).toContainText('Cached');
  const previous = (await state(page))?.requestId;
  await page.evaluate(() => history.pushState({}, '', '/orders/42?token=PRIVATE_QUERY'));
  await expect.poll(async () => (await state(page))?.requestId).not.toBe(previous);
  await expect.poll(async () => (await state(page))?.ai.cache).toBe('fresh');
  expect(await inferenceCount()).toBe(calls);
});

test('supports locales, themes, compact mode and keyboard access within a mobile viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#save').focus();
  await page.keyboard.press('Alt+Shift+KeyI');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await state(page))?.analysis.state, { timeout: 15000 })
    .toBe('READY');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByLabel('Display language', { exact: true }).selectOption('vi');
  await expect(page.getByRole('heading', { name: 'Bản dịch tiếng Việt' })).toBeVisible();
  const bounds = await panel(page).boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Panel has no layout');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('inspector-dark-mobile.png') });
  await page.getByLabel('Ngôn ngữ giao diện', { exact: true }).selectOption('ja');
  await expect(page.getByRole('heading', { name: 'ベトナム語訳' })).toBeVisible();
  await page.getByLabel('表示言語', { exact: true }).selectOption('en');
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Compact view', exact: true }).click();
  await expect(panel(page).locator('.analysis-content')).toBeHidden();
  await page.getByRole('button', { name: 'Expand analysis', exact: true }).click();
  await expect(panel(page).locator('.analysis-content')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inspector-light-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#save')).toBeFocused();
});

test('private runtime data stays local and dynamic unsupported behavior is UNKNOWN', async ({
  page,
}) => {
  const frames: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => frames.push(String(payload))),
  );
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
  await open(page, '#unknown');
  await expect
    .poll(async () => (await state(page))?.analysis.state, { timeout: 15000 })
    .toBe('READY');
  await expect(panel(page).locator('.confidence.unknown').first()).toBeAttached();
  await page.keyboard.press('Escape');
  const before = await inferenceCount();
  await page.locator('#private').click({ modifiers: ['Alt'] });
  await expect(panel(page).locator('#details')).toHaveText('Private content omitted');
  expect(await state(page)).toBeNull();
  expect(frames.join('')).not.toMatch(/PRIVATE_RUNTIME_TEXT|PRIVATE_PASSWORD|確認処理/);
  expect(await inferenceCount()).toBe(before);
  expect(JSON.stringify(await cli.calls())).not.toMatch(/PRIVATE_RUNTIME_TEXT|PRIVATE_PASSWORD/);
});

test('source changes downgrade old results, preserve React state and revalidate before reuse', async ({
  page,
}) => {
  await page.locator('#counter').click();
  await open(page);
  await expect
    .poll(async () => (await state(page))?.analysis.state, { timeout: 15000 })
    .toBe('READY');
  const revision = (await state(page))?.revision;
  await page.evaluate(() => {
    window.inspectionTransitions = [];
    window.addEventListener('devanalyst:inspection', () => {
      const snapshot = window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspection;
      if (snapshot)
        window.inspectionTransitions.push({
          state: snapshot.analysis.state,
          confident: snapshot.analysis.items.some((item) => item.confidence !== 'UNKNOWN'),
        });
    });
  });
  try {
    await writeFile(join(root, 'src/App.tsx'), app.replace('保存</button>', '更新</button>'));
    await expect(page.locator('#save')).toHaveText('更新');
    await expect.poll(async () => (await state(page))?.revision).not.toBe(revision);
    await expect
      .poll(async () => (await state(page))?.translation.state, { timeout: 15000 })
      .toBe('READY');
    await expect(panel(page).locator('[data-testid="translation-text"]')).toHaveText('Cập nhật');
    expect(
      await page.evaluate(() =>
        window.inspectionTransitions.some((item) => item.state === 'STALE' && !item.confident),
      ),
    ).toBe(true);
    await expect(page.locator('#counter')).toHaveText('Count 1');
  } finally {
    await writeFile(join(root, 'src/App.tsx'), app);
    await expect(page.locator('#save')).toHaveText('保存');
  }
});

test('provider failure keeps deterministic findings and browser rendering available', async ({
  page,
}, testInfo) => {
  const executable = await readFile(cli.executable, 'utf8');
  const marker = 'const scenario = {};';
  if (!executable.includes(marker)) throw new Error('Missing owned mock scenario');
  await writeFile(
    cli.executable,
    executable.replace(marker, 'const scenario = {mode:"malformed"};'),
  );
  try {
    await open(page, '#failure');
    const frames = await page.evaluate(async () => {
      const samples: number[] = [];
      let previous = performance.now();
      for (let index = 0; index < 30; index++)
        await new Promise<void>((resolve) =>
          requestAnimationFrame((now) => {
            samples.push(now - previous);
            previous = now;
            resolve();
          }),
        );
      return samples;
    });
    await writeFile(
      testInfo.outputPath('analysis-ui-frame-observations.json'),
      JSON.stringify(
        {
          frames: frames.length,
          maxFrameMs: Math.max(...frames),
          meanFrameMs: frames.reduce((a, b) => a + b, 0) / frames.length,
        },
        null,
        2,
      ),
    );
    await expect
      .poll(async () => (await state(page))?.analysis.state, { timeout: 15000 })
      .toBe('READY');
    await expect.poll(async () => (await state(page))?.ai.state, { timeout: 15000 }).toBe('FAILED');
    await expect
      .poll(async () => (await state(page))?.translation.state, { timeout: 15000 })
      .toBe('FAILED');
    await expect(panel(page).locator('[data-testid="analysis-status"]')).toContainText(
      'Unavailable',
    );
    await expect(panel(page).locator('[data-group="api"]')).toContainText('/api/orders');
    await expect(panel(page).locator('#details')).toHaveText('失敗を試す');
    expect(frames).toHaveLength(30);
    await page.keyboard.press('Escape');
    await page.locator('#counter').click();
    await expect(page.locator('#counter')).toHaveText('Count 1');
  } finally {
    await writeFile(cli.executable, executable);
  }
});

test('translation and selected analysis survive a dev server restart without more inference', async ({
  page,
}) => {
  await open(page, '#rare');
  await expect.poll(async () => (await state(page))?.ai.state, { timeout: 15000 }).toBe('READY');
  const before = await inferenceCount();
  await server.close();
  await start();
  await page.goto(url);
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
  await open(page, '#rare');
  await expect.poll(async () => (await state(page))?.ai.state, { timeout: 15000 }).toBe('READY');
  expect((await state(page))?.translation.cache).toBe('fresh');
  expect((await state(page))?.ai.cache).toBe('fresh');
  expect(await inferenceCount()).toBe(before);
});
