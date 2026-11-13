import { createStaticAnalyzer } from '@devanalyst/analyzer';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst, type DevAnalystPlugin } from '@devanalyst/vite-plugin';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ElementSourceMapping } from '@devanalyst/core';
let root: string, server: ViteDevServer, plugin: DevAnalystPlugin, url: string;
const sourceFiles = new Map<string, string>();
const lastSourceSave = new Map<string, number>();
async function saveSource(file: string, code: string): Promise<void> {
  // Native Chokidar coalesces same-file changes for 50 ms. Model distinct editor
  // saves, including cleanup, rather than losing a second synthetic write in that window.
  const remaining = 100 - (performance.now() - (lastSourceSave.get(file) ?? -Infinity));
  if (remaining > 0) await delay(remaining);
  await writeFile(file, code);
  lastSourceSave.set(file, performance.now());
}
async function mapping(page: Page, selector: string): Promise<ElementSourceMapping> {
  await page.locator(selector).click({ modifiers: ['Alt'], position: { x: 1, y: 1 } });
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata))
    .not.toBeNull();
  const result = await page.evaluate(
    () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping,
  );
  if (!result) throw new Error('Missing mapping');
  return result;
}
function position(file: string, needle: string) {
  const code = sourceFiles.get(file);
  if (!code) throw new Error('Missing fixture');
  const offset = code.indexOf(needle);
  if (offset < 0) throw new Error('Missing JSX');
  const lines = code.slice(0, offset).split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
function verified(result: ElementSourceMapping, file: string, needle: string, component: string) {
  expect(result).toMatchObject({
    status: 'VERIFIED',
    source: { file, start: position(file, needle) },
    component: { name: component },
    strategy: 'compile-time-ref-v1',
  });
}
test.beforeAll(async () => {
  root = await mkdtemp(resolve('apps/playground-react/.devanalyst-e2e-mapping-browser-'));
  await mkdir(join(root, 'app/src'), { recursive: true });
  await mkdir(join(root, 'packages/ui'), { recursive: true });
  for (const [name, file] of [
    ['App', 'app/src/App.tsx'],
    ['Row', 'packages/ui/Row.tsx'],
    ['Lazy', 'app/src/Lazy.tsx'],
    ['Unsupported', 'app/src/Unsupported.tsx'],
  ]) {
    if (!name || !file) throw new Error('Invalid fixture');
    const code = await readFile(resolve(`tests/fixtures/react-mapping/${name}.tsx.txt`), 'utf8');
    sourceFiles.set(file, code);
    await writeFile(join(root, file), code);
  }
  await writeFile(
    join(root, 'app/src/main.tsx'),
    'import {StrictMode} from "react";import {createRoot} from "react-dom/client";import App from "./App";window.fixtureStats={attaches:0,detaches:0};createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);',
  );
  await writeFile(
    join(root, 'app/index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  plugin = devanalyst({
    config: { workspaceRoot: '..', source: { include: ['app/src/**', 'packages/ui/**'] } },
  });
  server = await createServer({
    root: join(root, 'app'),
    resolve: { alias: { '@fixture/ui': join(root, 'packages/ui/Row.tsx') } },
    configFile: false,
    plugins: [react(), plugin],
    logLevel: 'silent',
    cacheDir: join(root, 'node_modules/.vite'),
    // Exercise the native fs.watch path used by Linux CI on macOS too.
    server: { host: '127.0.0.1', port: 0, watch: { useFsEvents: false, usePolling: false } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  url = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('#count')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
});
declare global {
  interface Window {
    fixtureStats: { attaches: number; detaches: number };
  }
}

test('selection returns the exact original JSX and lexical component, without source attributes', async ({
  page,
}) => {
  const result = await mapping(page, '#count');
  verified(result, 'app/src/App.tsx', '<button id="count"', 'App');
  await expect(page.locator('devanalyst-inspector #hint')).toContainText('VERIFIED JSX origin');
  expect(await page.locator('#count').evaluate((node) => node.getAttributeNames())).not.toContain(
    'ref',
  );
  expect(await page.locator('main').innerHTML()).not.toMatch(/data-devanalyst|__devanalystBinding/);
  expect(JSON.stringify(result)).not.toContain(root);
});
test('reusable local workspace rows share a source site but have distinct stable runtime identities through keyed reorder', async ({
  page,
}) => {
  const a = await mapping(page, '#row-a');
  verified(a, 'packages/ui/Row.tsx', '<button id={', 'Row');
  await page.keyboard.press('Escape');
  const b = await mapping(page, '#row-b');
  if (a.status !== 'VERIFIED' || b.status !== 'VERIFIED') throw new Error('Missing row mapping');
  expect(a.elementId).toBe(b.elementId);
  expect(a.runtimeId).not.toBe(b.runtimeId);
  await page.keyboard.press('Escape');
  await page.locator('#row-a').click();
  await page.locator('#reorder').click();
  await expect(page.locator('#rows article').first()).toContainText('Row b');
  await expect(page.locator('#row-a')).toHaveText('Row a 1');
  expect((await mapping(page, '#row-a')).runtimeId).toBe(a.runtimeId);
});
test('fragments, lazy modules, memo, class render, render props and portals retain real origin', async ({
  page,
}) => {
  for (const [selector, file, needle, component] of [
    ['#fragment', 'app/src/App.tsx', '<button id="fragment"', 'App'],
    ['#lazy', 'app/src/Lazy.tsx', '<button id="lazy"', 'LazyButton'],
    ['#memo', 'app/src/App.tsx', '<button id="memo"', 'MemoButton'],
    ['#class', 'app/src/App.tsx', '<button id="class"', 'ClassButton'],
    ['#render-prop', 'app/src/App.tsx', '<button id="render-prop"', 'App'],
    ['#portal', 'app/src/App.tsx', '<button id="portal"', 'App'],
  ]) {
    if (!selector || !file || !needle || !component) throw new Error('Invalid case');
    verified(await mapping(page, selector), file, needle, component);
    await page.keyboard.press('Escape');
  }
});
test('opaque refs, spread props, custom elements, dynamic factories and copied nodes return UNKNOWN without ancestor guessing', async ({
  page,
}) => {
  for (const selector of ['#native-ref', '#spread', '#custom', '#imperative']) {
    expect(await mapping(page, selector)).toMatchObject({
      status: 'UNKNOWN',
      source: null,
      reason: 'NOT_INSTRUMENTED',
    });
    await page.keyboard.press('Escape');
  }
  await page.locator('#count').evaluate((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.id = 'clone';
    node.parentElement?.append(clone);
  });
  expect(await mapping(page, '#clone')).toMatchObject({ status: 'UNKNOWN', source: null });
  expect(plugin.api.getMappingDiagnostics()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        file: 'app/src/App.tsx',
        skipped: expect.arrayContaining([
          expect.objectContaining({ code: 'EXISTING_REF' }),
          expect.objectContaining({ code: 'SPREAD_PROPS' }),
        ]),
      }),
      expect.objectContaining({ file: 'app/src/Unsupported.tsx', reason: 'UNSUPPORTED' }),
    ]),
  );
});
test('route transitions unmount stale nodes and preserve existing mapping identities without document reload', async ({
  page,
}) => {
  const time = await page.evaluate(() => performance.timeOrigin);
  const before = await mapping(page, '#row-a');
  await page.keyboard.press('Escape');
  await page.locator('#navigate').click();
  await expect(page).toHaveURL(/\/next$/);
  verified(await mapping(page, '#route-next'), 'app/src/App.tsx', '<button id="route-next"', 'App');
  await page.keyboard.press('Escape');
  expect((await mapping(page, '#row-a')).runtimeId).toBe(before.runtimeId);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(time);
});
test('Fast Refresh updates line evidence and revision while keeping React state and the stable source identifier', async ({
  page,
}) => {
  await page.locator('#count').click();
  const before = await mapping(page, '#count');
  if (before.status !== 'VERIFIED') throw new Error('Missing initial source');
  const file = join(root, 'app/src/App.tsx'),
    original = sourceFiles.get('app/src/App.tsx');
  if (!original) throw new Error('Missing source');
  const time = await page.evaluate(() => performance.timeOrigin);
  try {
    await saveSource(file, '\n\n' + original.replace('Mapping fixture', 'Updated mapping'));
    await expect(page.locator('h1')).toHaveText('Updated mapping');
    await expect(page.locator('#count')).toHaveText('Count 1');
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.source?.start?.line,
        ),
      )
      .toBe((before.source.start?.line ?? 0) + 2);
    const after = await page.evaluate(
      () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping,
    );
    expect(after).toMatchObject({ status: 'VERIFIED', elementId: before.elementId });
    if (after?.status !== 'VERIFIED') throw new Error('Missing refreshed mapping');
    expect(after.revision).not.toBe(before.revision);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(time);
  } finally {
    await saveSource(file, original);
  }
});
test('native ref lifecycles, controlled React state and DOM output match an uninstrumented development baseline', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const initial = await page.evaluate(() => ({ ...window.fixtureStats }));
  await page.locator('#count').click();
  expect(await page.evaluate(() => window.fixtureStats)).toEqual(initial);
  const html = await page.locator('main').innerHTML();
  const baseline = await createServer({
    root: join(root, 'app'),
    resolve: { alias: { '@fixture/ui': join(root, 'packages/ui/Row.tsx') } },
    configFile: false,
    plugins: [react()],
    logLevel: 'silent',
    cacheDir: join(root, 'node_modules/.vite-baseline'),
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await baseline.listen();
    const address = baseline.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('No baseline');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.locator('#count').click();
    expect(await page.evaluate(() => window.fixtureStats)).toEqual(initial);
    expect(await page.locator('main').innerHTML()).toBe(html);
    expect(errors).toEqual([]);
  } finally {
    await baseline.close();
  }
});

test('source edits that fail to compile invalidate visible old DOM evidence and recover after correction', async ({
  page,
}) => {
  const original = sourceFiles.get('app/src/App.tsx');
  if (!original) throw new Error('Missing source');
  await page.locator('#count').click();
  const time = await page.evaluate(() => performance.timeOrigin);
  const before = await mapping(page, '#count');
  expect(before.status).toBe('VERIFIED');
  const file = join(root, 'app/src/App.tsx');
  try {
    await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/src/App.tsx' && response.status() === 500,
      ),
      saveSource(file, original + '\nexport const broken = <div>'),
    ]);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping.status,
        ),
      )
      .toBe('UNKNOWN');
    const stale = await page.evaluate(
      () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping,
    );
    expect(stale).toMatchObject({ status: 'UNKNOWN', source: null, reason: 'STALE_SOURCE' });
    await saveSource(file, original.replace('Mapping fixture', 'Corrected mapping'));
    await expect(page.locator('h1')).toHaveText('Corrected mapping');
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping.status,
        ),
      )
      .toBe('VERIFIED');
    await expect(page.locator('#count')).toHaveText('Count 1');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(time);
  } finally {
    await saveSource(file, original);
  }
});

test('records measured transform durations and bounded mapping diagnostics from the real fixture', async () => {
  const diagnostics = plugin.api.getMappingDiagnostics();
  expect(diagnostics.length).toBeGreaterThan(0);
  expect(
    diagnostics.every(
      (item) =>
        Number.isFinite(item.durationMs) && item.durationMs >= 0 && item.skipped.length <= 100,
    ),
  ).toBe(true);
  const path = test.info().outputPath('mapping-diagnostics.json');
  await writeFile(path, JSON.stringify(diagnostics, null, 2));
  await test.info().attach('mapping-diagnostics', { path, contentType: 'application/json' });
});

test('feeds a real selected source mapping into the Node analyzer without changing React state', async ({
  page,
}) => {
  const selected = await mapping(page, '#row-a');
  if (selected.status !== 'VERIFIED') throw new Error('Missing mapped source');
  const engine = createStaticAnalyzer({
    workspaceRoot: root,
    source: { include: ['app/src/**', 'packages/ui/**'] },
    aliases: { '@fixture/ui': 'packages/ui/Row.tsx' },
  });
  const result = await engine.analyzeDetailed({
    requestId: 'mapped-static-analysis',
    sources: [selected.source],
  });
  expect(result.selectedSubjects).toHaveLength(1);
  expect(result.sourceHashes[selected.source.file]).toBe(selected.revision);
  expect(
    result.findings.some(
      (finding) =>
        finding.detail.kind === 'handler' &&
        finding.detail.targetId !== null &&
        finding.evidence?.source.file === 'packages/ui/Row.tsx',
    ),
  ).toBe(true);
  expect(
    result.findings.some(
      (finding) =>
        finding.detail.kind === 'state' &&
        finding.detail.operation === 'update' &&
        finding.traces.length > 0,
    ),
  ).toBe(true);
  await expect(page.locator('#row-a')).toHaveText('Row a 0');
});
