import { createHash, randomUUID } from 'node:crypto';
import { instrumentReactSource } from '@devanalyst/analyzer';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { build, createServer, createLogger, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bridgeBootstrapSchema,
  serverEventSchema,
  type BridgeBootstrap,
  type ServerEvent,
} from '@devanalyst/core';
import {
  devanalyst,
  type DevAnalystPlugin,
  type ViteIntegrationOptions,
  type BridgeLifecycleEvent,
} from '../../../packages/vite-plugin/src/index.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-vite-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><div id="app">Host app</div><script type="module" src="/src/main.js"></script></body></html>',
  );
  await writeFile(
    join(root, 'src/main.js'),
    'document.querySelector("#app").textContent = "Ready";',
  );
  return root;
}

function origin(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('No Vite address');
  return `http://127.0.0.1:${address.port}`;
}

async function start(
  options: ViteIntegrationOptions = {},
  extra: { base?: string; mode?: string; resolve?: { alias: Record<string, string> } } = {},
): Promise<{
  root: string;
  server: ViteDevServer;
  plugin: DevAnalystPlugin;
  events: BridgeLifecycleEvent[];
}> {
  const root = await fixture();
  const events: BridgeLifecycleEvent[] = [];
  const plugin = devanalyst({
    ...options,
    onEvent: (event) => {
      events.push(event);
      return options.onEvent?.(event);
    },
  });
  const server = await createServer({
    root,
    configFile: false,
    plugins: [plugin],
    ...extra,
    customLogger: createLogger('silent'),
    server: { host: '127.0.0.1', port: 0 },
  });
  cleanup.push(() => server.close());
  await server.listen();
  await plugin.api.ready;
  return { root, server, plugin, events };
}

async function bootstrap(server: ViteDevServer, base = '/'): Promise<BridgeBootstrap> {
  const response = await fetch(`${origin(server)}${base}__devanalyst/bootstrap`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return bridgeBootstrapSchema.parse(await response.json());
}

function connect(
  data: BridgeBootstrap,
  from: string,
  token = data.token,
): { socket: WebSocket; messages: ServerEvent[]; ready: Promise<void> } {
  const socket = new WebSocket(data.endpoint, ['devanalyst.v1', `devanalyst.auth.${token}`], {
    origin: from,
  });
  const messages: ServerEvent[] = [];
  socket.on('message', (buffer) =>
    messages.push(serverEventSchema.parse(JSON.parse(buffer.toString()))),
  );
  const ready = new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  cleanup.push(async () => {
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      socket.terminate();
      await closed;
    }
  });
  return { socket, messages, ready };
}

async function denied(data: BridgeBootstrap, from: string, token = data.token): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(data.endpoint, ['devanalyst.v1', `devanalyst.auth.${token}`], {
      origin: from,
    });
    socket.on('error', () => undefined);
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('Unauthorized connection accepted'));
    });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode ?? 0);
    });
  });
}

async function reserve(): Promise<{ http: Server; port: number }> {
  const http = createHttpServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No reservation address');
  return { http, port: address.port };
}

describe('real Vite and authenticated bridge', () => {
  it('admits only server-registered JSX sites for the active route, streams progress and removes disconnected pages', async () => {
    const { server, root, plugin } = await start(
      {},
      {
        resolve: {
          alias: {
            'react/jsx-dev-runtime': join(
              process.cwd(),
              'apps/playground-react/node_modules/react/jsx-dev-runtime.js',
            ),
          },
        },
      },
    );
    const source = 'export function Visible(){return <button>Safe</button>}';
    await writeFile(join(root, 'src/Visible.tsx'), source);
    await server.transformRequest('/src/Visible.tsx');
    const { manifest } = instrumentReactSource(
      source,
      'src/Visible.tsx',
      '/__devanalyst/mapping-runtime.js',
    );
    const site = manifest.sites[0];
    if (!site) throw new Error('Missing source site');
    const data = await bootstrap(server);
    const connection = connect(data, origin(server));
    await connection.ready;
    await expect
      .poll(() => connection.messages.find((message) => message.type === 'bridge.ready'))
      .toBeDefined();
    const ready = connection.messages.find((message) => message.type === 'bridge.ready');
    if (ready?.type !== 'bridge.ready') throw new Error('Missing bridge client');
    const client = ready.payload.clientId;
    const send = (type: string, payload: unknown) =>
      connection.socket.send(
        JSON.stringify({
          version: 1,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type,
          payload,
        }),
      );
    send('route.changed', { pathname: '/orders/123' });
    const requestId = randomUUID();
    const element = {
      elementId: site.id,
      file: site.source.file,
      revision: manifest.revision,
      tag: site.tag,
      kind: 'button',
    };
    send('page.index', {
      requestId,
      route: { pathname: '/orders/123' },
      elements: [element, { ...element, elementId: 'f'.repeat(64), file: 'src/main.js' }],
      limited: false,
    });
    await expect.poll(() => plugin.api.getPageAnalysis(client)).toMatchObject({ completed: 1 });
    expect(plugin.api.getPageAnalysis(client)).toMatchObject({ total: 1, limited: true });
    expect(connection.messages.some((message) => message.type === 'page.progress')).toBe(true);
    send('page.index', {
      requestId: randomUUID(),
      route: { pathname: '/obsolete' },
      elements: [element],
      limited: false,
    });
    send('route.changed', { pathname: '/other' });
    await expect.poll(() => plugin.api.getPageAnalysis(client)).toBeNull();
    send('page.index', {
      requestId: randomUUID(),
      route: { pathname: '/other' },
      elements: [element],
      limited: false,
    });
    await expect.poll(() => plugin.api.getPageAnalysis(client)?.items[0]?.cache).toBe('fresh');
    connection.socket.close();
    await expect.poll(() => plugin.api.getPageAnalysis(client)).toBeNull();
  });
  it('does not serve SQLite files through root, encoded, or @fs URLs', async () => {
    const { server, plugin, root } = await start();
    await expect
      .poll(async () => Boolean((await plugin.api.inspectCache())?.persistent))
      .toBe(true);
    for (const path of [
      '/.cache/devanalyst/analysis.sqlite',
      '/.cache/devanalyst/%61nalysis.sqlite',
      `/@fs${join(root, '.cache/devanalyst/analysis.sqlite')}`,
    ])
      expect((await fetch(origin(server) + path)).status).toBe(403);
  });
  it('disables persistence configured inside Vite public output', async () => {
    const { server, plugin } = await start({ config: { cache: { directory: 'public/cache' } } });
    expect(await plugin.api.inspectCache()).toBeNull();
    expect(plugin.api.getSnapshot().error?.code).toBe('INVALID_CONFIG');
    expect((await fetch(origin(server) + '/public/cache/analysis.sqlite')).status).toBe(403);
  });
  it('can disable automatic pre-analysis without disabling the inspector bridge', async () => {
    const { server, plugin } = await start({ preanalysis: { enabled: false } });
    expect(await (await fetch(`${origin(server)}/__devanalyst/client.js`)).text()).toContain(
      'preanalysis:false',
    );
    expect(plugin.api.getPageAnalysis('unknown')).toBeNull();
    expect(plugin.api.getSnapshot().state).toBe('ready');
  });
  it('keeps the host and bridge available when selected AI settings are invalid', async () => {
    const { server, plugin } = await start({
      config: { ai: { enabled: true, permittedPaths: ['src/**'] } },
      preanalysis: { enabled: false, claude: { model: '' } },
    });
    expect(plugin.api.getSnapshot()).toMatchObject({
      state: 'ready',
      error: { code: 'INVALID_CONFIG' },
    });
    expect((await fetch(origin(server))).status).toBe(200);
    const connection = connect(await bootstrap(server), origin(server));
    await connection.ready;
    const send = (type: string, payload: unknown) =>
      connection.socket.send(
        JSON.stringify({
          version: 1,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type,
          payload,
        }),
      );
    send('route.changed', { pathname: '/' });
    const requestId = randomUUID();
    send('inspector.request', {
      requestId,
      pageId: randomUUID(),
      route: { pathname: '/' },
      element: {
        elementId: 'a'.repeat(64),
        revision: 'b'.repeat(64),
        file: 'src/App.tsx',
        tag: 'button',
        kind: 'button',
      },
      textDigest: null,
      mode: 'expanded',
    });
    await expect
      .poll(
        () =>
          connection.messages.filter(
            (message) =>
              message.type === 'inspector.update' &&
              message.payload.requestId === requestId &&
              message.payload.state === 'FAILED' &&
              message.payload.error === 'INVALID_CONFIG',
          ).length,
      )
      .toBe(3);
    connection.socket.close();
  });
  it('serves scoped inspector results with automatic pre-analysis disabled and rejects forged origins and runtime text', async () => {
    const { server, root } = await start(
      { preanalysis: { enabled: false } },
      {
        resolve: {
          alias: {
            'react/jsx-dev-runtime': join(
              process.cwd(),
              'apps/playground-react/node_modules/react/jsx-dev-runtime.js',
            ),
          },
        },
      },
    );
    const code =
      'export function Save(){return <button onClick={()=>fetch("/save")}>保存</button>}';
    const connection = connect(await bootstrap(server), origin(server));
    await connection.ready;
    await writeFile(join(root, 'src/Save.tsx'), code);
    await expect
      .poll(
        () =>
          connection.messages.some(
            (message) =>
              message.type === 'source.changed' && message.payload.file === 'src/Save.tsx',
          ),
        { timeout: 3000 },
      )
      .toBe(true);
    await server.transformRequest('/src/Save.tsx');
    const { manifest } = instrumentReactSource(
      code,
      'src/Save.tsx',
      '/__devanalyst/mapping-runtime.js',
    );
    const site = manifest.sites[0];
    if (!site) throw new Error('Missing source origin');

    const send = (type: string, payload: unknown) =>
      connection.socket.send(
        JSON.stringify({
          version: 1,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type,
          payload,
        }),
      );
    send('route.changed', { pathname: '/save' });
    const request = {
      requestId: randomUUID(),
      pageId: randomUUID(),
      route: { pathname: '/save' },
      element: {
        elementId: site.id,
        file: site.source.file,
        revision: manifest.revision,
        tag: site.tag,
        kind: 'button',
      },
      textDigest: createHash('sha256').update('保存').digest('hex'),
      mode: 'expanded',
    };
    send('inspector.request', request);
    await expect
      .poll(
        () =>
          connection.messages.some(
            (message) =>
              message.type === 'inspector.update' &&
              message.payload.requestId === request.requestId &&
              message.payload.lane === 'analysis' &&
              message.payload.state === 'READY',
          ),
        { timeout: 8000 },
      )
      .toBe(true);
    expect(
      connection.messages.some(
        (message) =>
          message.type === 'inspector.update' &&
          message.payload.lane === 'translation' &&
          message.payload.items.some((item) => item.description === 'Lưu'),
      ),
    ).toBe(true);
    expect(
      connection.messages.some(
        (message) =>
          message.type === 'inspector.update' &&
          message.payload.lane === 'ai' &&
          message.payload.error === 'AI_DISABLED',
      ),
    ).toBe(true);
    const forged = {
      ...request,
      requestId: randomUUID(),
      element: { ...request.element, elementId: 'f'.repeat(64) },
    };
    send('inspector.request', forged);
    await expect
      .poll(() =>
        connection.messages.some(
          (message) =>
            message.type === 'inspector.update' &&
            message.payload.requestId === forged.requestId &&
            message.payload.error === 'SOURCE_MAPPING_UNAVAILABLE',
        ),
      )
      .toBe(true);
    const closed = new Promise<number>((resolve) => connection.socket.once('close', resolve));
    send('inspector.request', { ...request, text: 'PRIVATE_RUNTIME_TEXT' });
    expect(await closed).toBe(1008);
  });
  it('injects the runtime without exposing credentials in HTML or runtime code', async () => {
    const { server, plugin } = await start();
    const data = await bootstrap(server);
    const html = await (await fetch(origin(server))).text();
    expect(html).toContain('/__devanalyst/client.js');
    expect(html).not.toContain(data.token);
    const code = await (await fetch(`${origin(server)}/__devanalyst/client.js`)).text();
    expect(code).toContain('startBridgeRuntime');
    expect(code).not.toContain(data.token);
    expect(code).not.toContain('node:');
    expect(code).toContain("from './browser.js'");
    for (const asset of ['browser.js', 'metadata.js', 'preanalysis-runtime.js']) {
      const response = await fetch(`${origin(server)}/__devanalyst/${asset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('text/javascript');
      const module = await response.text();
      expect(module).not.toContain(data.token);
      expect(module).not.toContain('node:');
      expect(
        (
          await fetch(`${origin(server)}/__devanalyst/${asset}`, {
            headers: { Origin: 'http://untrusted.example' },
          })
        ).status,
      ).toBe(403);
      expect((await fetch(`${origin(server)}/__devanalyst/${asset}?file=secret`)).status).toBe(403);
    }
    expect((await fetch(`${origin(server)}/__devanalyst/private.js`)).status).toBe(404);
    expect(plugin.api.getSnapshot().state).toBe('ready');
    expect(JSON.stringify(plugin.api.getSnapshot())).not.toContain(data.token);
  });

  it('detects connections, validates route frames, acknowledges actual routes, and detects disconnects', async () => {
    const { server, plugin, events } = await start();
    const data = await bootstrap(server);
    const client = connect(data, origin(server));
    await client.ready;
    await expect
      .poll(() => client.messages.some((event) => event.type === 'bridge.ready'))
      .toBe(true);
    const payload = { pathname: '/orders', hashPath: '/detail', reason: 'pushState' };
    client.socket.send(
      JSON.stringify({
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'route.changed',
        payload,
      }),
    );
    await expect.poll(() => plugin.api.getSnapshot().clients[0]?.route?.pathname).toBe('/orders');
    expect(
      events.some((event) => event.type === 'route' && event.route.hashPath === '/detail'),
    ).toBe(true);
    expect(client.messages.some((event) => event.type === 'route.acknowledged')).toBe(true);
    client.socket.close();
    await expect.poll(() => plugin.api.getSnapshot().clients.length).toBe(0);
    expect(events.some((event) => event.type === 'disconnected')).toBe(true);
  });

  it('rejects wrong origins, credentials, cross-site bootstrap access, and filesystem RPCs', async () => {
    const { server, plugin } = await start();
    const data = await bootstrap(server);
    expect(await denied(data, 'https://untrusted.example')).toBe(403);
    expect(await denied(data, '')).toBe(403);
    expect(await denied(data, origin(server), '')).toBe(403);
    expect(await denied(data, origin(server), '0'.repeat(64))).toBe(403);
    expect(
      (
        await fetch(`${origin(server)}/__devanalyst/bootstrap`, {
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin(server)}/__devanalyst/bootstrap`, {
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${origin(server)}/__devanalyst/read?file=../../secret`)).status).toBe(403);
    const client = connect(data, origin(server));
    await client.ready;
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', (code) => resolve(code)),
    );
    client.socket.send(
      JSON.stringify({
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'source.read',
        payload: { file: '../secret' },
      }),
    );
    expect(await closed).toBe(1008);
    await expect.poll(() => plugin.api.getSnapshot().clients).toEqual([]);
  });

  it.each([
    'not-json',
    JSON.stringify({ version: 2, type: 'route.changed' }),
    JSON.stringify({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'route.changed',
      payload: { pathname: '/?token=secret' },
    }),
  ])('closes invalid messages while Vite remains usable: %s', async (message) => {
    const { server } = await start();
    const client = connect(await bootstrap(server), origin(server));
    await client.ready;
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', (code) => resolve(code)),
    );
    client.socket.send(message);
    expect(await closed).toBe(1008);
    expect((await fetch(origin(server))).status).toBe(200);
  });

  it('limits frame sizes and connection counts', async () => {
    const { server } = await start({ bridge: { maxConnections: 1, maxMessageBytes: 1024 } });
    const data = await bootstrap(server);
    const client = connect(data, origin(server));
    await client.ready;
    expect(await denied(data, origin(server))).toBe(429);
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', (code) => resolve(code)),
    );
    client.socket.send('a'.repeat(2048));
    expect(await closed).toBe(1009);
  });

  it.each(['binary', 'rate'])(
    'rejects unsupported or excessive protocol traffic: %s',
    async (kind) => {
      const { server } = await start();
      const client = connect(await bootstrap(server), origin(server));
      await client.ready;
      const closed = new Promise<number>((resolve) =>
        client.socket.once('close', (code) => resolve(code)),
      );
      if (kind === 'binary') client.socket.send(Buffer.from('binary'));
      else
        for (let i = 0; i < 61; i += 1)
          client.socket.send(
            JSON.stringify({
              version: 1,
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              type: 'route.changed',
              payload: { pathname: '/rate' },
            }),
          );
      expect(await closed).toBe(1008);
      expect((await fetch(origin(server))).status).toBe(200);
    },
  );

  it('does not let observers mutate stored or acknowledged routes', async () => {
    const { server, plugin } = await start({
      onEvent: (event) => {
        if (event.type === 'route') Object.assign(event.route, { pathname: '/observer-only' });
      },
    });
    const client = connect(await bootstrap(server), origin(server));
    await client.ready;
    client.socket.send(
      JSON.stringify({
        version: 1,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'route.changed',
        payload: { pathname: '/actual' },
      }),
    );
    await expect.poll(() => plugin.api.getSnapshot().clients[0]?.route?.pathname).toBe('/actual');
    await expect
      .poll(() =>
        client.messages.some(
          (event) =>
            event.type === 'route.acknowledged' && event.payload.route.pathname === '/actual',
        ),
      )
      .toBe(true);
  });

  it('rejects invalid configuration without breaking the host server', async () => {
    const { server, plugin } = await start({ bridge: { port: 70000 } });
    expect(plugin.api.getSnapshot()).toMatchObject({
      state: 'failed',
      error: { code: 'INVALID_CONFIG' },
    });
    expect((await fetch(origin(server))).status).toBe(200);
  });

  it('reports real allowed file changes without replacing native Vite HMR', async () => {
    const { root, server } = await start();
    // HTTP/bridge listening does not imply that the initial source crawl has
    // installed the file watch yet. Wait for the real watched entry before editing.
    await expect
      .poll(() => server.watcher.getWatched()[join(server.config.root, 'src')], { timeout: 5000 })
      .toContain('main.js');
    const client = connect(await bootstrap(server), origin(server));
    await client.ready;
    await writeFile(
      join(root, 'src/main.js'),
      'document.querySelector("#app").textContent = "Changed";',
    );
    await expect
      .poll(
        () =>
          client.messages.some(
            (event) => event.type === 'source.changed' && event.payload.file === 'src/main.js',
          ),
        { timeout: 5000 },
      )
      .toBe(true);
    expect((await fetch(`${origin(server)}/src/main.js`)).status).toBe(200);
  });

  it('handles strict port conflicts without failing Vite and retries ports when requested', async () => {
    const reservation = await reserve();
    const strict = await start({ bridge: { port: reservation.port } });
    expect(strict.plugin.api.getSnapshot()).toMatchObject({
      state: 'failed',
      error: { code: 'BRIDGE_PORT_IN_USE' },
    });
    expect((await fetch(origin(strict.server))).status).toBe(200);
    const fallback = await start({ bridge: { port: reservation.port, strictPort: false } });
    expect(fallback.plugin.api.getSnapshot().port).toBeGreaterThan(reservation.port);
  });

  it('rotates credentials and cleans old sessions when the same plugin instance restarts', async () => {
    const { server, plugin } = await start();
    const old = await bootstrap(server);
    const client = connect(old, origin(server));
    await client.ready;
    const closed = new Promise<number>((resolve) =>
      client.socket.once('close', (code) => resolve(code)),
    );
    await server.restart();
    await plugin.api.ready;
    expect(await closed).toBe(1001);
    expect(plugin.api.getSnapshot()).toMatchObject({ state: 'ready' });
    const next = await bootstrap(server);
    expect(next.token).not.toBe(old.token);
    expect(await denied(next, origin(server), old.token)).toBe(403);
    const fresh = connect(next, origin(server));
    await fresh.ready;
    expect(plugin.api.getSnapshot().clients).toHaveLength(1);
    await server.close();
    expect(plugin.api.getSnapshot().state).toBe('closed');
  });

  it('uses Vite base paths and isolates failing observers', async () => {
    const { server, plugin } = await start(
      {
        onEvent: () => {
          throw new Error('private observer detail');
        },
      },
      { base: '/demo/' },
    );
    const client = connect(await bootstrap(server, '/demo/'), origin(server));
    await client.ready;
    expect(plugin.api.getSnapshot().error?.code).toBe('INTERNAL_ERROR');
    expect((await fetch(`${origin(server)}/demo/`)).status).toBe(200);
  });

  it('isolates rejected async observers without unhandled rejections or leaking error details', async () => {
    const { server, plugin } = await start({
      onEvent: async () => {
        throw new Error('private observer detail');
      },
    });
    const client = connect(await bootstrap(server), origin(server));
    await client.ready;
    await expect.poll(() => plugin.api.getSnapshot().error?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(plugin.api.getSnapshot())).not.toContain('private observer detail');
    expect((await fetch(origin(server))).status).toBe(200);
  });

  it.each([{ enabled: false }, { config: { inspector: { enabled: false } } }])(
    'excludes disabled integration: %j',
    async (options) => {
      const { server, plugin } = await start(options);
      expect(plugin.api.getSnapshot().state).toBe('inactive');
      expect(await (await fetch(origin(server))).text()).not.toContain('/__devanalyst/client.js');
    },
  );

  it.each(['production', 'development'])(
    'excludes production mode serve and runtime markers from build mode %s',
    async (mode) => {
      const disabled = await start({}, { mode: 'production' });
      expect(await (await fetch(origin(disabled.server))).text()).not.toContain('/__devanalyst/');
      const root = await fixture();
      const plugin = devanalyst();
      await build({
        root,
        mode,
        configFile: false,
        plugins: [plugin],
        logLevel: 'silent',
        build: { outDir: 'dist' },
      });
      expect(await plugin.api.ready).toBeNull();
      const files = [
        join(root, 'dist/index.html'),
        ...(await readdir(join(root, 'dist/assets'))).map((file) =>
          join(root, 'dist/assets', file),
        ),
      ];
      for (const file of files) {
        const output = await readFile(file, 'utf8');
        for (const marker of [
          '/__devanalyst/',
          '__DEVANALYST_BRIDGE__',
          'devanalyst.auth.',
          'startBridgeRuntime',
          root,
        ])
          expect(output).not.toContain(marker);
      }
    },
  );
});
