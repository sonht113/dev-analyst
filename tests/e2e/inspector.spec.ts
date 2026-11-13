import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst } from '@devanalyst/vite-plugin';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { ElementInspectorHandle } from '../../packages/inspector/src/browser.js';

let root: string;
let server: ViteDevServer;
let url: string;
const app = `import {useState} from 'react';
export default function App(){
 const [count,setCount]=useState(0);const [shown,setShown]=useState(false);const [submitted,setSubmitted]=useState(false);
 return <main style={{padding:40}}>
 <h1>Inspector fixture</h1><button id="counter" onClick={()=>setCount(count+1)}>Count: {count}</button>
 <p><button id="nested" aria-label="Save order"><span id="inner">注文を保存</span></button></p>
 <a id="link" href="#/orders">Orders link</a>
 <form onSubmit={e=>{e.preventDefault();setSubmitted(true)}}><label>Password<input id="password" type="password" defaultValue="secret-password" aria-label="secret-label"/></label>
 <label>Account<input id="account" defaultValue="secret-account"/></label><textarea defaultValue="secret-notes"/><div contentEditable suppressContentEditableWarning>secret-editable</div>
 <button type="submit">Submit</button><output>{submitted?'Submitted':'Ready'}</output></form>
 <div id="text">表示テキスト <span hidden>hidden-secret</span><span style={{display:'none'}}>hidden-style</span><span data-devanalyst-private>secret-private</span><script type="application/json">secret-script</script></div>
 <svg id="vector" width="100" height="60" role="img" aria-label="Chart"><title>Chart title</title><rect id="shape" x="5" y="5" width="80" height="40" fill="blue"/></svg>
 <button id="toggle" onClick={()=>setShown(!shown)}>Toggle dynamic</button>{shown&&<button id="dynamic">動的な要素</button>}
 <div style={{height:1000}}/><button id="bottom">Bottom element</button>
 </main>;
}`;
async function snapshot(
  page: Page,
): Promise<ReturnType<ElementInspectorHandle['getSnapshot']> | null> {
  return page.evaluate(() => window.__DEVANALYST_INSPECTOR__?.getSnapshot() ?? null);
}
async function select(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click({ modifiers: ['Alt'], position: { x: 1, y: 1 } });
  await expect.poll(async () => (await snapshot(page))?.pinned).toBe(true);
  await expect.poll(async () => (await snapshot(page))?.metadata).not.toBeNull();
}
const panel = (page: Page) => page.locator('devanalyst-inspector #panel');

test.beforeAll(async () => {
  root = await mkdtemp(resolve('apps/playground-react/.devanalyst-inspector-'));
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  await writeFile(
    join(root, 'src/main.tsx'),
    'import {createRoot} from "react-dom/client";import App from "./App";createRoot(document.getElementById("root")!).render(<App/>);',
  );
  await writeFile(join(root, 'src/App.tsx'), app);
  server = await createServer({
    root,
    cacheDir: join(root, 'node_modules/.vite'),
    configFile: false,
    plugins: [react(), devanalyst()],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
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
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
});

test('passive hover and Alt hover detect the deepest element without blocking normal controls, links, forms or text', async ({
  page,
}) => {
  const original = await page.locator('main').textContent();
  await page.locator('#inner').hover();
  await expect.poll(async () => (await snapshot(page))?.metadata?.tag).toBe('span');
  await expect(panel(page)).toHaveAttribute('role', 'tooltip');
  await expect(page.locator('devanalyst-inspector #details')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.down('Alt');
  await page.locator('#nested').hover();
  await page.keyboard.up('Alt');
  await page.locator('#counter').click();
  await expect(page.locator('#counter')).toHaveText('Count: 1');
  await page.locator('#link').click();
  await expect(page).toHaveURL(/#\/orders$/);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.locator('output')).toHaveText('Submitted');
  expect(
    (await page.locator('main').textContent())
      ?.replace('Count: 1', 'Count: 0')
      .replace('Submitted', 'Ready'),
  ).toBe(original);
  const prevented = await page
    .locator('#link')
    .evaluate(
      (node) =>
        !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    );
  expect(prevented).toBe(false);
  await expect(page.locator('devanalyst-inspector #menu')).toBeHidden();
});

test('Alt click pins, preserves host handlers and extracts bounded DOM evidence without source claims', async ({
  page,
}) => {
  await select(page, '#counter');
  await expect(page.locator('#counter')).toHaveText('Count: 0');
  expect((await snapshot(page))?.metadata).toMatchObject({
    tag: 'button',
    text: 'Count: 0',
    sourceStatus: 'VERIFIED',
    source: { file: 'src/App.tsx' },
    cache: 'none',
  });
  await page.locator('#text').hover();
  expect((await snapshot(page))?.metadata?.tag).toBe('button');
  await page.getByRole('button', { name: 'Unpin', exact: true }).click();
  await page.locator('#inner').hover();
  await expect.poll(async () => (await snapshot(page))?.metadata?.text).toBe('注文を保存');
  expect((await snapshot(page))?.metadata?.japaneseText).toContain('注文を保存');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await select(page, '#nested');
  expect((await snapshot(page))?.metadata?.accessibleLabel).toBe('Save order');
  await page.keyboard.press('Alt+KeyP');
  expect((await snapshot(page))?.pinned).toBe(false);
  await page.keyboard.press('Alt+KeyP');
  expect((await snapshot(page))?.pinned).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await page.locator('#counter').click();
  await expect(page.locator('#counter')).toHaveText('Count: 1');
});

test('privacy excludes all control values, editable/private/hidden content, URLs and arbitrary attributes from snapshots and copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sent: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => sent.push(String(payload))),
  );
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().status))
    .toBe('connected');
  await page.locator('#text').evaluate((node) => {
    node.setAttribute('data-token', 'secret-token');
    node.setAttribute('onclick', 'void 0');
  });
  await select(page, '#text');
  const metadata = (await snapshot(page))?.metadata;
  expect(metadata?.text).toBe('表示テキスト');
  expect(JSON.stringify(metadata)).not.toMatch(/secret|hidden/);
  await page.keyboard.press('Alt+KeyC');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('表示テキスト');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toMatch(/secret|hidden/);
  await page.keyboard.press('Escape');
  await select(page, '#password');
  expect((await snapshot(page))?.metadata).toMatchObject({
    redacted: true,
    text: '',
    accessibleLabel: 'Password',
    attributes: { type: 'password' },
  });
  expect(JSON.stringify(await snapshot(page))).not.toContain('secret');
  await page.keyboard.press('Escape');
  await select(page, 'form');
  expect(JSON.stringify(await snapshot(page))).not.toContain('secret');
  await page.keyboard.press('Escape');
  await select(page, '#link');
  expect((await snapshot(page))?.metadata?.attributes).not.toHaveProperty('href');
  expect(sent.length).toBeGreaterThan(0);
  for (const frame of sent) expect(JSON.parse(frame).type).toBe('route.changed');
  expect(sent.join('')).not.toMatch(/secret|表示テキスト|password/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.documentElement.tabIndex = 0;
    document.documentElement.focus();
  });
  await page.keyboard.press('Alt+Shift+KeyI');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page))?.metadata?.tag).toBe('html');
  expect((await snapshot(page))?.metadata?.text).toContain('Inspector fixture');
  expect((await snapshot(page))?.metadata?.text).not.toMatch(/DevAnalyst|UNKNOWN|secret/);
});

test('keyboard inspection, context menu navigation, focus restoration and editable shortcut preservation', async ({
  page,
}) => {
  await page.locator('#counter').focus();
  await page.keyboard.press('Alt+Shift+KeyI');
  await expect(page.getByRole('button', { name: /DevAnalyst · Inspecting/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page))?.pinned).toBe(true);
  await expect(page.locator('#counter')).toHaveText('Count: 0');
  await page.keyboard.press('Escape');
  await expect(page.locator('#counter')).toBeFocused();
  await page.locator('#nested').click({ button: 'right', modifiers: ['Alt'] });
  const menu = page.getByRole('menu', { name: 'DevAnalyst inspection' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Inspect element', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Copy DOM metadata' })).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await select(page, '#counter');
  await page.locator('#account').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#account')).toBeFocused();
  await page.locator('#account').fill('normal typing');
  await page.keyboard.press('Alt+Shift+KeyI');
  expect((await snapshot(page))?.inspecting).toBe(false);
  await expect(page.locator('#account')).toHaveValue('normal typing');
});

test('highlight follows scrolling, resizing and layout shifts; SVG and removed selections recover', async ({
  page,
}) => {
  await select(page, '#shape');
  expect((await snapshot(page))?.metadata?.namespace).toBe('http://www.w3.org/2000/svg');
  async function matchesBox(): Promise<void> {
    await expect
      .poll(async () => {
        const element = await page.locator('#shape').boundingBox();
        const box = await page.locator('devanalyst-inspector .box').first().boundingBox();
        return element && box
          ? Math.abs(element.x - box.x) +
              Math.abs(element.y - box.y) +
              Math.abs(element.width - box.width) +
              Math.abs(element.height - box.height)
          : 999;
      })
      .toBeLessThan(2);
  }
  await matchesBox();
  await page.evaluate(() => window.scrollBy(0, 80));
  await matchesBox();
  await page.setViewportSize({ width: 640, height: 500 });
  await matchesBox();
  await page.locator('#vector').evaluate((node) => {
    node.style.marginLeft = '100px';
  });
  await matchesBox();
  const tooltip = await panel(page).boundingBox();
  expect(tooltip && tooltip.x >= 0 && tooltip.x + tooltip.width <= 640).toBe(true);
  await page.locator('#shape').evaluate((node) => node.remove());
  await expect(panel(page)).toBeHidden();
  await select(page, '#counter');
  await expect(panel(page)).toBeVisible();
});

test('handles same-origin nested frames, accessible shadow content and opaque boundaries without mutating host DOM', async ({
  page,
}) => {
  await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.id = 'shadow-host';
    const root = wrapper.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="shadow-button">影のボタン</button>';
    document.querySelector('main')?.prepend(wrapper);
    const frame = document.createElement('iframe');
    frame.id = 'same-frame';
    frame.style.cssText =
      'width:400px;height:120px;border:5px solid;transform:scale(.8);transform-origin:top left';
    frame.srcdoc =
      '<button id="frame-button">Frame button</button><iframe srcdoc="&lt;button id=deep&gt;Deep button&lt;/button&gt;"></iframe>';
    document.querySelector('main')?.prepend(frame);
    const closed = document.createElement('div');
    closed.id = 'closed-host';
    closed.attachShadow({ mode: 'closed' }).innerHTML = '<button>Closed boundary</button>';
    document.querySelector('main')?.prepend(closed);
    const opaque = document.createElement('iframe');
    opaque.id = 'opaque';
    opaque.setAttribute('sandbox', '');
    opaque.srcdoc = '<button>Opaque</button>';
    document.querySelector('main')?.prepend(opaque);
  });
  await select(page, '#shadow-button');
  expect((await snapshot(page))?.metadata?.context).toBe('shadow-root');
  await page.keyboard.press('Escape');
  const frameButton = page.frameLocator('#same-frame').locator('#frame-button');
  await frameButton.click({ modifiers: ['Alt'] });
  await expect.poll(async () => (await snapshot(page))?.metadata?.text).toBe('Frame button');
  expect((await snapshot(page))?.metadata?.context).toBe('iframe');
  const target = await frameButton.boundingBox();
  const highlight = await page.locator('devanalyst-inspector .box').first().boundingBox();
  expect(
    target && highlight && Math.abs(target.x - highlight.x) + Math.abs(target.y - highlight.y) < 2,
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page
    .frameLocator('#same-frame')
    .frameLocator('iframe')
    .locator('#deep')
    .click({ modifiers: ['Alt'] });
  await expect.poll(async () => (await snapshot(page))?.metadata?.text).toBe('Deep button');
  await page.keyboard.press('Escape');
  await select(page, '#closed-host');
  expect((await snapshot(page))?.metadata?.tag).toBe('div');
});

test('survives SPA navigation, dynamic React rendering, HMR, disconnects, copy failures and teardown', async ({
  page,
}) => {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.locator('#toggle').click();
  await select(page, '#dynamic');
  expect((await snapshot(page))?.metadata?.text).toBe('動的な要素');
  await page.evaluate(() => history.pushState({}, '', '/next'));
  await expect(panel(page)).toBeVisible();
  const file = join(root, 'src/App.tsx');
  const original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original.replace('動的な要素', '更新した要素'));
    await expect(page.locator('#dynamic')).toHaveText('更新した要素');
    await expect.poll(async () => (await snapshot(page))?.metadata?.text).toBe('更新した要素');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  } finally {
    await writeFile(file, original);
  }
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await select(page, '#counter');
  await expect(page.locator('devanalyst-inspector #status')).toContainText('Disconnected');
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.locator('devanalyst-inspector #status')).toContainText('Connected');
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: () => Promise.reject(new Error('denied')),
    });
  });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('devanalyst-inspector #status')).toContainText('Copy unavailable');
  await page.evaluate(() => window.__DEVANALYST_BRIDGE__?.stop());
  await expect(page.locator('devanalyst-inspector')).toHaveCount(0);
  expect(await snapshot(page)).toBeNull();
  await page.locator('#counter').click();
  await expect(page.locator('#counter')).toHaveText('Count: 1');
});

test('disabled controls remain selectable, Shadow DOM isolates host styles and inspector actions do not bubble into host handlers', async ({
  page,
}) => {
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'disabled';
    button.disabled = true;
    button.textContent = 'Disabled action';
    document.querySelector('main')?.prepend(button);
    const css = document.createElement('style');
    css.textContent = 'section,pre,h2{display:none!important}';
    document.head.append(css);
    document.addEventListener('click', () => {
      document.body.dataset['documentClicks'] = String(
        Number(document.body.dataset['documentClicks'] ?? '0') + 1,
      );
    });
  });
  const bounds = await page.locator('#disabled').boundingBox();
  if (!bounds) throw new Error('Missing control');
  await page.keyboard.down('Alt');
  await page.mouse.click(bounds.x + 2, bounds.y + 2);
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await snapshot(page))?.metadata?.text).toBe('Disabled action');
  expect((await snapshot(page))?.metadata?.attributes).toHaveProperty('disabled');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(panel(page)).toHaveCSS('background-color', 'rgb(25, 35, 53)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(panel(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(panel(page)).toBeVisible();
  const before = await page.locator('body').getAttribute('data-document-clicks');
  await page.getByRole('button', { name: 'Unpin', exact: true }).click();
  expect(await page.locator('body').getAttribute('data-document-clicks')).toBe(before);
  await page.screenshot({ path: test.info().outputPath('inspector-preview.png') });
});

test('bounds metadata and coalesces hover bursts; selected text remains copyable across geometry updates', async ({
  page,
}) => {
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'large';
    for (let i = 0; i < 2000; i++) {
      const span = document.createElement('span');
      span.textContent = '日本語 ' + i + ' ';
      container.append(span);
    }
    document.querySelector('main')?.prepend(container);
  });
  // Keyboard selection deliberately targets the parent of the repeated text nodes.
  await page.locator('#large').evaluate((node) => {
    node.tabIndex = 0;
    node.focus();
  });
  await page.keyboard.press('Alt+Shift+KeyI');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page))?.metadata?.truncated).toBe(true);
  const metadata = (await snapshot(page))?.metadata;
  expect(metadata?.text.length).toBeLessThanOrEqual(2000);
  expect(metadata?.japaneseText.length).toBeLessThanOrEqual(32);
  await page.locator('devanalyst-inspector #details').evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0))
    .toBeGreaterThan(0);
  const selectedText = await page.evaluate(() => window.getSelection()?.toString());
  await page.setViewportSize({ width: 900, height: 700 });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(selectedText);
  await page.keyboard.press('Escape');
  await page.locator('#counter').scrollIntoViewIfNeeded();
  const measurement = await page.evaluate(async () => {
    const element = document.getElementById('counter');
    if (!element) throw new Error('Missing target');
    let reads = 0;
    const original = element.getClientRects.bind(element);
    element.getClientRects = () => {
      reads++;
      return original();
    };
    const rect = element.getBoundingClientRect();
    const started = performance.now();
    for (let i = 0; i < 1000; i++)
      element.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          clientX: rect.x + 1,
          clientY: rect.y + 1,
        }),
      );
    const dispatchMs = performance.now() - started;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    element.getClientRects = original;
    return { events: 1000, geometryReads: reads, dispatchMs };
  });
  expect(measurement.geometryReads).toBeGreaterThan(0);
  expect(measurement.geometryReads).toBeLessThan(12);
  const artifact = test.info().outputPath('hover-measurement.json');
  await writeFile(artifact, JSON.stringify(measurement, null, 2));
  await test
    .info()
    .attach('hover-measurement.json', { path: artifact, contentType: 'application/json' });
});

test('reports real DOM-read failures safely and recovers; label candidates and long single text nodes stay bounded', async ({
  page,
}) => {
  await select(page, '#text');
  await page.locator('#text').evaluate((node) => {
    Object.defineProperty(node, 'getAttribute', {
      configurable: true,
      get() {
        throw new Error('untrusted read failure');
      },
    });
    node.setAttribute('aria-label', 'Updated label');
  });
  await expect(page.locator('devanalyst-inspector #status')).toContainText(
    'DOM metadata unavailable',
  );
  expect((await snapshot(page))?.metadata).toBeNull();
  expect((await snapshot(page))?.error).not.toContain('untrusted');
  await page.locator('#text').evaluate((node) => {
    Reflect.deleteProperty(node, 'getAttribute');
    node.setAttribute('aria-label', 'Recovered label');
  });
  await expect
    .poll(async () => (await snapshot(page))?.metadata?.accessibleLabel)
    .toBe('Recovered label');
  await page.keyboard.press('Escape');
  await page.locator('#text').evaluate((node) => {
    node.textContent = '日本語'.repeat(100000);
    node.removeAttribute('aria-label');
  });
  await select(page, '#text');
  expect((await snapshot(page))?.metadata?.truncated).toBe(true);
  expect((await snapshot(page))?.metadata?.text.length).toBeLessThanOrEqual(2000);
  await page.keyboard.press('Escape');
  await page.locator('#nested').evaluate((node) => {
    node.setAttribute('aria-labelledby', 'text');
  });
  // Button padding targets the button rather than its text child.
  await select(page, '#nested');
  expect((await snapshot(page))?.metadata?.labelSource).toBe('aria-labelledby (visible text)');
  expect((await snapshot(page))?.metadata?.accessibleLabel.length).toBeLessThanOrEqual(512);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#counter').click();
  await expect(page.locator('#counter')).toHaveText('Count: 1');
});
