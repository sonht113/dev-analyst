import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import process from 'node:process';

test.use({ actionTimeout: 10000 });
const activeFixtures = new Set<() => Promise<void>>();
test.afterEach(async () => {
  for (const close of [...activeFixtures]) await close();
});
async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
async function fixture(
  framework: 'react' | 'vue' | 'next' | 'nuxt',
  bundler = 'turbopack',
  configuration?: string,
) {
  const base = resolve('apps/playground-' + framework),
    root = await mkdtemp(join(base, '.devanalyst-framework-'));
  const port = await freePort();
  const files =
    framework === 'vue' || framework === 'react'
      ? ['src', 'index.html', 'vite.config.ts', 'demo-api.ts', 'package.json']
      : framework === 'next'
        ? ['app', 'next.config.ts', 'dev.mjs', 'package.json']
        : ['app', 'server', 'nuxt.config.ts', 'package.json'];
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
  if (configuration) await writeFile(join(root, 'devanalyst.config.ts'), configuration);
  const command =
    framework === 'next'
      ? process.execPath
      : resolve(
          base,
          'node_modules/.bin',
          framework === 'vue' || framework === 'react' ? 'vite' : 'nuxt',
        );
  const args =
    framework === 'next'
      ? ['dev.mjs']
      : framework === 'vue' || framework === 'react'
        ? ['--host', '127.0.0.1', '--port', String(port), '--strictPort']
        : ['dev', '--host', '127.0.0.1', '--port', String(port)];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DEVANALYST_TEST_BUNDLER: bundler,
    NUXT_TELEMETRY_DISABLED: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  delete env['FORCE_COLOR'];
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (buffer: Buffer) => {
      logs = (logs + buffer.toString()).slice(-16000);
    });
  const done = new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      let forced = false;
      activeFixtures.delete(close);
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        process.kill(-child.pid, 'SIGTERM');
        const timeout = setTimeout(() => {
          forced = true;
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* Already stopped. */
          }
        }, 8000);
        await done;
        clearTimeout(timeout);
      }
      if (child.pid)
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Owned process group already stopped. */
        }
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (forced)
        throw new Error('Framework shutdown exceeded its deadline: ' + framework + ' ' + bundler);
      if (framework === 'next' && child.exitCode !== 0)
        throw new Error('Next development did not shut down cleanly.');
    })();
    return closing;
  }
  activeFixtures.add(close);
  const url = `http://127.0.0.1:${port}`;
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error('Framework exited: ' + logs);
          try {
            return (
              await fetch(url + '/__devanalyst/diagnostics', { signal: AbortSignal.timeout(3000) })
            ).status;
          } catch {
            return 0;
          }
        },
        { timeout: 90000 },
      )
      .toBe(200);
  } catch (error) {
    await close();
    throw new Error(String(error) + '\n' + logs, { cause: error });
  }
  return { root, url, close, logs: () => logs, child };
}
async function connected(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status), {
      timeout: 30000,
    })
    .toBe('connected');
}
async function select(page: Page, selector: string) {
  await page.locator(selector).click({ modifiers: ['Alt'], position: { x: 2, y: 2 } });
  await expect
    .poll(() =>
      page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping.status),
    )
    .toBe('VERIFIED');
  return page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping);
}
for (const entry of [
  { framework: 'vue' as const },
  { framework: 'nuxt' as const },
  { framework: 'next' as const, bundler: 'webpack' },
  { framework: 'next' as const, bundler: 'turbopack' },
]) {
  test(`${entry.framework} ${entry.bundler ?? 'Vite'}: real mapping, source analysis and navigation preserve host state`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150000);
    const app = await fixture(entry.framework, entry.bundler);
    try {
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(app.url);
      await connected(page);
      expect(failures).toEqual([]);
      await expect(page.locator('#counter')).toBeVisible({ timeout: 20000 });
      await page.locator('#counter').click();
      await expect(page.locator('#counter')).toContainText('1');
      const analysisStarted = performance.now();
      const mapping = await select(page, '#save');
      expect(mapping?.source?.file).toContain(
        entry.framework === 'next'
          ? 'app/page.tsx'
          : entry.framework === 'vue'
            ? 'src/App.vue'
            : 'app/pages/index.vue',
      );
      if (mapping?.status !== 'VERIFIED') throw new Error('No mapping');
      expect(mapping.strategy).toBe(
        entry.framework === 'next' ? 'compile-time-ref-v1' : 'vue-directive-v1',
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspection?.analysis.state,
            ),
          { timeout: 20000 },
        )
        .toBe('READY');
      const selectedAnalysisMs = performance.now() - analysisStarted;
      const selectedItems = await page.evaluate(
        () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspection?.analysis.items ?? [],
      );
      expect(
        selectedItems.some(
          (item) =>
            item.group === 'api' &&
            item.confidence === 'VERIFIED' &&
            item.evidence?.code.includes(
              '/api/' +
                (entry.framework === 'next'
                  ? 'next-orders'
                  : entry.framework === 'vue'
                    ? 'vue-orders'
                    : 'nuxt-orders'),
            ),
        ),
      ).toBe(true);
      const source = await readFile(join(app.root, mapping.source.file), 'utf8');
      expect(source.split('\n')[(mapping.source.start?.line ?? 0) - 1]).toContain('save');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Turn off analysis', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().analysisEnabled),
        )
        .toBe(false);
      await expect
        .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
        .toBe('disconnected');
      await expect(page.locator('devanalyst-inspector #panel')).toBeHidden();
      await expect(page.locator('#counter')).toContainText('1');
      await page.getByRole('button', { name: 'Turn on analysis', exact: true }).click();
      await connected(page);
      if (entry.framework === 'vue') {
        const first = await select(page, 'li:nth-child(1) .row');
        await page.keyboard.press('Escape');
        const second = await select(page, 'li:nth-child(2) .row');
        await page.keyboard.press('Escape');
        if (first?.status !== 'VERIFIED' || second?.status !== 'VERIFIED')
          throw new Error('Missing keyed row origins');
        expect(first.elementId).toBe(second.elementId);
        expect(first.runtimeId).not.toBe(second.runtimeId);
        await page.locator('#reorder').click();
        await expect(page.locator('li').first()).toContainText('B');
        const moved = await select(page, 'li:nth-child(1) .row');
        expect(moved?.runtimeId).toBe(second.runtimeId);
        await page.keyboard.press('Escape');
      }
      await writeFile(
        join(app.root, mapping.source.file),
        source.replace(/(>\s*)保存(\s*<\/button\b)/, '$1更新$2'),
      );
      await expect(page.locator('#save')).toHaveText('更新', { timeout: 20000 });
      await expect(page.locator('#counter')).toContainText('1');
      const updated = await select(page, '#save');
      if (updated?.status !== 'VERIFIED') throw new Error('Missing HMR source');
      expect(updated.revision).not.toBe(mapping.revision);
      await page.keyboard.press('Escape');
      if (entry.framework === 'vue') {
        await page.locator('#lazy').click();
        await expect(page.locator('#lazy')).toContainText('1');
        const lazy = await select(page, '#lazy');
        expect(lazy?.source?.file).toBe('src/LazyCard.vue');
        await page.keyboard.press('Escape');
      }
      const navigationStarted = performance.now();
      await page.getByRole('link', { name: '注文42', exact: true }).click();
      await expect(page.locator('#route-action')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().serverRoute?.pathname),
        )
        .toBe('/orders/42');
      await select(page, '#route-action');
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspection?.analysis.state,
            ),
          { timeout: 20000 },
        )
        .toBe('READY');
      const items = await page.evaluate(
        () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().inspection?.analysis.items ?? [],
      );
      expect(items.some((item) => item.confidence === 'VERIFIED')).toBe(true);
      await expect
        .poll(
          () =>
            page.evaluate(
              () => window.__DEVANALYST_BRIDGE__?.getSnapshot().pageAnalysis?.completed,
            ),
          { timeout: 20000 },
        )
        .toBeGreaterThan(0);
      const navigationAnalysisMs = performance.now() - navigationStarted;
      if (entry.framework === 'next') {
        await page.keyboard.press('Escape');
        await page.locator('#server-heading').click({ modifiers: ['Alt'] });
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata?.mapping.status,
            ),
          )
          .toBe('UNKNOWN');
      }
      expect(failures).toEqual([]);
      const timingPath = testInfo.outputPath('framework-timing.json');
      await writeFile(timingPath, JSON.stringify({ selectedAnalysisMs, navigationAnalysisMs }));
      await testInfo.attach('framework-timing', {
        path: timingPath,
        contentType: 'application/json',
      });
      await testInfo.attach('framework-diagnostics', {
        body: JSON.stringify(
          await page.evaluate(() => ({
            status: window.__DEVANALYST_BRIDGE__?.getSnapshot().status,
            completed: window.__DEVANALYST_BRIDGE__?.getSnapshot().pageAnalysis?.completed,
          })),
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      throw new Error(String(error) + '\n' + app.logs(), { cause: error });
    } finally {
      await app.close();
    }
  });
}

for (const framework of ['vue', 'nuxt', 'next'] as const) {
  test(`${framework}: invalid configuration disables inspection while the host remains usable`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    const app = await fixture(
      framework,
      'turbopack',
      "export default {analysis:{depth:'invalid'}};",
    );
    try {
      const diagnostic = await (await fetch(app.url + '/__devanalyst/diagnostics')).json();
      expect(diagnostic.state).toBe('failed');
      expect(diagnostic.error).toBe('INVALID_CONFIG');
      await page.goto(app.url);
      await page.locator('#counter').click();
      await expect(page.locator('#counter')).toContainText('1');
      expect(await page.evaluate(() => window.__DEVANALYST_BRIDGE__)).toBeUndefined();
    } finally {
      await app.close();
    }
  });
}

for (const entry of [
  { framework: 'react' as const },
  { framework: 'vue' as const },
  { framework: 'nuxt' as const },
  { framework: 'next' as const, bundler: 'webpack' },
  { framework: 'next' as const, bundler: 'turbopack' },
]) {
  test(`${entry.framework} ${entry.bundler ?? 'Vite'}: commerce filters, role guards, editing, API failures and bulk approval`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150000);
    const app = await fixture(entry.framework, entry.bundler);
    try {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(app.url);
      await connected(page);
      const endpoint = '/api/' + entry.framework + '-orders';
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
      const ready = await page.request.get(app.url + endpoint);
      expect(ready.status()).toBe(200);
      expect(
        (await page.request.post(app.url + endpoint, { data: { action: 'unknown' } })).status(),
      ).toBe(400);
      expect(
        (
          await page.request.post(app.url + endpoint, {
            data: { action: 'update', ids: [42], quantity: 0, priority: false, note: 'invalid' },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await page.request.post(app.url + endpoint, {
            data: {
              action: 'update',
              ids: [42],
              quantity: 1,
              priority: false,
              note: 'x'.repeat(9000),
            },
          })
        ).status(),
      ).toBe(413);
      await expect(
        page.getByRole('heading', { name: '注文管理センター', exact: true }),
      ).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(6);
      const approval = page.getByRole('button', { name: '選択した注文を承認', exact: true });
      await expect(approval).toBeDisabled();
      await page.getByLabel('注文を検索', { exact: true }).fill('no-matching-order');
      await expect(page.getByText('該当する注文がありません', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '絞り込みを解除', exact: true }).click();
      await expect(page.locator('tbody tr')).toHaveCount(6);
      await page.getByRole('button', { name: '次へ →', exact: true }).click();
      await expect(page.getByText('ページ 2 / 6', { exact: true })).toBeVisible();
      await page.getByLabel('ステータスで絞り込み', { exact: true }).selectOption('pending');
      await expect(page.getByTestId('order-row-42')).toBeVisible();
      await page.getByLabel('デモの権限', { exact: true }).selectOption('viewer');
      await page.getByLabel('注文を選択: 42', { exact: true }).check();
      await expect(approval).toBeDisabled();
      await page.getByRole('button', { name: '注文の詳細: 42', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: '変更を保存', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
      await page.getByLabel('デモの権限', { exact: true }).selectOption('reviewer');
      await page.getByRole('button', { name: '注文の詳細: 42', exact: true }).click();
      await page.getByLabel('数量', { exact: true }).fill('3');
      await page.getByLabel('配送メモ', { exact: true }).fill('PRIVATE_FORM_NOTE_FOR_DEMO');
      const saved = page.waitForResponse(
        (response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '変更を保存', exact: true }).click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByTestId('order-row-42')).toContainText('3 点');
      await page.getByLabel('注文を選択: 42', { exact: true }).check();
      await expect(approval).toBeEnabled();
      const approved = page.waitForResponse(
        (response) => response.url().endsWith(endpoint) && response.request().method() === 'POST',
      );
      await approval.click();
      expect((await approved).status()).toBe(200);
      await expect(page.getByTestId('order-row-42')).toHaveCount(0);
      const conflict = await page.request.post(app.url + endpoint, {
        data: { action: 'approve', ids: [42] },
      });
      expect(conflict.status()).toBe(409);
      await page.getByLabel('APIエラーを再現', { exact: true }).check();
      await page.getByRole('button', { name: '↻ データを同期', exact: true }).click();
      await expect(page.getByRole('alert', { name: 'デモAPIエラー', exact: true })).toContainText(
        'デモデータを読み込めません',
      );
      await page.getByRole('button', { name: '再試行', exact: true }).click();
      await expect(page.getByRole('alert', { name: 'デモAPIエラー', exact: true })).toHaveCount(0);
      await expect(page.getByLabel('APIエラーを再現', { exact: true })).not.toBeChecked();
      await page.getByLabel('ステータスで絞り込み', { exact: true }).selectOption('all');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '↓ CSVを出力', exact: true }).click();
      const exported = await download;
      expect(exported.suggestedFilename()).toBe('demo-orders.csv');
      const downloadPath = await exported.path();
      if (!downloadPath) throw Error('No CSV artifact');
      const csv = await readFile(downloadPath, 'utf8');
      expect(csv.split('\n')[0]).toBe('注文番号,顧客,数量,合計金額,ステータス');
      expect(csv.split('\n').length).toBeGreaterThan(2);
      expect(csv).not.toContain('PRIVATE_FORM_NOTE_FOR_DEMO');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole('heading', { name: '注文管理センター', exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(errors).toEqual([]);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: testInfo.outputPath('commerce-dashboard.png') });
    } catch (error) {
      throw new Error('Commerce journey failed.\n' + app.logs(), { cause: error });
    } finally {
      await app.close();
    }
  });
}
