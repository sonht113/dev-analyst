import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst, type DevAnalystPlugin } from '@devanalyst/vite-plugin';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
let root: string, url: string, server: ViteDevServer, plugin: DevAnalystPlugin;
const snapshot = (page: Page) =>
  page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().pageAnalysis ?? null);
test.beforeAll(async () => {
  root = await mkdtemp(resolve('apps/playground-react/.devanalyst-preanalysis-'));
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'index.html'),
    '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  await writeFile(
    join(root, 'src/main.tsx'),
    'import {createRoot} from "react-dom/client";import App from "./App";createRoot(document.getElementById("root")!).render(<App/>);',
  );
  await writeFile(
    join(root, 'src/App.tsx'),
    `import {lazy,Suspense,useState} from 'react';import {Shared} from './Shared';const Lazy=lazy(()=>import('./Lazy'));export default function App(){const [n,setN]=useState(0),[show,setShow]=useState(false);return <main><h1>Page</h1><button onClick={()=>setN(n+1)}>Count {n}</button><a href='/orders'>Orders</a><form onSubmit={e=>e.preventDefault()}><input type='password' defaultValue='PRIVATE-PASSWORD'/><button>Submit</button></form><div role='menu'><button role='menuitem'>Menu</button></div><button role='tab'>Tab</button><section data-devanalyst-private><button>PRIVATE-TEXT</button></section><Shared/><Shared/><svg width="100" height="25"><foreignObject width="100" height="25"><button>SVG button</button></foreignObject></svg><button onClick={()=>setShow(true)}>Load lazy</button>{show&&<Suspense fallback={<p>Loading</p>}><Lazy/></Suspense>}</main>}`,
  );
  await writeFile(
    join(root, 'src/Shared.tsx'),
    'export function Shared(){return <button onClick={()=>fetch("/shared")}>Shared</button>}',
  );
  await writeFile(
    join(root, 'src/Lazy.tsx'),
    'export default function Lazy(){return <button onClick={()=>fetch("/lazy")}>Lazy action</button>}',
  );
  plugin = devanalyst();
  server = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, 'node_modules/.vite'),
    plugins: [react(), plugin],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, watch: { useFsEvents: false } },
  });
  await server.listen();
  await plugin.api.ready;
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing Vite server');
  url = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
test('automatically indexes visible interactive elements, deduplicates shared JSX, discovers lazy modules and reuses navigation cache', async ({
  page,
}) => {
  await page.goto(url);
  await expect
    .poll(
      async () => (await snapshot(page))?.items.filter((item) => item.state === 'READY').length,
      { timeout: 15000 },
    )
    .toBeGreaterThan(5);
  const initial = await snapshot(page);
  expect(initial?.items.map((item) => item.kind)).toEqual(
    expect.arrayContaining(['button', 'link', 'form', 'menu', 'tab']),
  );
  expect(initial?.items.filter((item) => item.file === 'src/Shared.tsx')).toHaveLength(1);
  expect(initial?.items.some((item) => item.tag === 'foreignobject')).toBe(true);
  expect(JSON.stringify(initial)).not.toMatch(/PRIVATE|PASSWORD|input|PRIVATE-TEXT/);
  expect(initial?.items.every((item) => item.aiState === 'NOT_ANALYZED')).toBe(true);
  const client = await page.evaluate(() => window.__DEVANALYST_BRIDGE__?.getSnapshot().clientId);
  expect(
    plugin.api
      .getPageAnalysis(client ?? '')
      ?.components.some((component) => component.name === 'App'),
  ).toBe(true);
  await page.getByRole('button', { name: 'Load lazy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lazy action', exact: true })).toBeVisible();
  await expect
    .poll(
      async () => (await snapshot(page))?.items.find((item) => item.file === 'src/Lazy.tsx')?.state,
    )
    .toBe('READY');
  const origin = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(() =>
    history.pushState({}, '', '/orders/123?secret=PRIVATE#/details/456?token=PRIVATE'),
  );
  await expect
    .poll(async () => (await snapshot(page))?.route)
    .toMatchObject({ pathname: '/orders/123', hashPath: '/details/456' });
  await expect
    .poll(async () => (await snapshot(page))?.items.some((item) => item.cache === 'fresh'))
    .toBe(true);
  await page.evaluate(() => history.back());
  await expect.poll(async () => (await snapshot(page))?.route.pathname).toBe('/');
  await expect
    .poll(async () => (await snapshot(page))?.items.some((item) => item.cache === 'fresh'))
    .toBe(true);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
  await page.getByRole('button', { name: 'Count 0', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
  expect(JSON.stringify(await snapshot(page))).not.toContain('PRIVATE');
});
test('keeps rendering responsive during collection and refreshes HMR revisions without losing React state', async ({
  page,
}, testInfo) => {
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Count 0', exact: true })).toBeVisible();
  const frames = await page.evaluate(async () => {
    const durations: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 20; i++)
      await new Promise<void>((resolveFrame) =>
        requestAnimationFrame((now) => {
          durations.push(now - last);
          last = now;
          resolveFrame();
        }),
      );
    return durations;
  });
  const measurement = testInfo.outputPath('preanalysis-frame-observation.json');
  await writeFile(measurement, JSON.stringify({ frames, maxMs: Math.max(...frames) }, null, 2));
  await testInfo.attach('preanalysis-frame-observation', {
    path: measurement,
    contentType: 'application/json',
  });
  expect(frames).toHaveLength(20);
  await expect
    .poll(async () =>
      (await snapshot(page))?.items.some(
        (item) => item.file === 'src/Shared.tsx' && item.state === 'READY',
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Count 0', exact: true }).click();
  const file = join(root, 'src/Shared.tsx');
  const original = await readFile(file, 'utf8');
  const before = (await snapshot(page))?.items.find(
    (item) => item.file === 'src/Shared.tsx',
  )?.revision;
  try {
    await writeFile(
      file,
      original.replace('/shared', '/updated').replace('>Shared<', '>Updated shared<'),
    );
    await expect(
      page.getByRole('button', { name: 'Updated shared', exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Count 1', exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.revision,
      )
      .not.toBe(before);
    await expect
      .poll(
        async () =>
          (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.state,
      )
      .toBe('READY');
  } finally {
    await writeFile(file, original);
  }
});

test('selecting an uncached shared component raises its priority even when the background queue is full', async ({
  page,
}) => {
  const limited = devanalyst({ preanalysis: { limits: { maxEntries: 1 } } });
  const constrainedServer = await createServer({
    root,
    configFile: false,
    cacheDir: join(root, 'node_modules/.vite-limited'),
    plugins: [react(), limited],
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await constrainedServer.listen();
    await limited.api.ready;
    const address = constrainedServer.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await expect
      .poll(
        async () =>
          (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.state,
      )
      .toBe('NOT_ANALYZED');
    await page
      .getByRole('button', { name: 'Shared', exact: true })
      .first()
      .click({ modifiers: ['Alt'] });
    await expect
      .poll(
        async () =>
          (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.state,
      )
      .toBe('READY');
    const metadata = await page.evaluate(
      () => window.__DEVANALYST_INSPECTOR__?.getSnapshot().metadata,
    );
    expect(metadata?.source?.file).toBe('src/Shared.tsx');
    await expect(page.locator('devanalyst-inspector').getByRole('region')).toContainText(
      'AST READY',
    );
  } finally {
    await constrainedServer.close();
  }
});

test('reuses persisted analysis after a real Vite restart and page entry, with private runtime data excluded', async ({
  page,
}) => {
  await page.goto(url);
  await expect
    .poll(
      async () =>
        (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.state,
    )
    .toBe('READY');
  await expect
    .poll(async () => (await plugin.api.inspectCache())?.scopes['element'], { timeout: 10000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await plugin.api.inspectCache())?.scopes['page'], { timeout: 10000 })
    .toBeGreaterThan(0);
  const before = await plugin.api.inspectCache();
  expect(before?.persistent).toBe(true);
  const database = await readFile(join(root, '.cache/devanalyst/analysis.sqlite'));
  expect(database.toString()).not.toMatch(/PRIVATE-PASSWORD|PRIVATE-TEXT|private-route-id/);
  await server.restart();
  await plugin.api.ready;
  await page.reload();
  await expect
    .poll(
      async () =>
        (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.cache,
      { timeout: 10000 },
    )
    .toBe('fresh');
  await expect(page.getByRole('button', { name: 'Count 0', exact: true })).toBeVisible();
  const file = join(root, 'src/Shared.tsx'),
    original = await readFile(file, 'utf8');
  const previous = (await snapshot(page))?.items.find(
    (item) => item.file === 'src/Shared.tsx',
  )?.revision;
  try {
    await writeFile(
      file,
      original.replace('/shared', '/cache-updated').replace('>Shared<', '>Cache updated<'),
    );
    await expect(
      page.getByRole('button', { name: 'Cache updated', exact: true }).first(),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.revision,
      )
      .not.toBe(previous);
    await expect
      .poll(
        async () =>
          (await snapshot(page))?.items.find((item) => item.file === 'src/Shared.tsx')?.state,
      )
      .toBe('READY');
  } finally {
    await writeFile(file, original);
  }
});
