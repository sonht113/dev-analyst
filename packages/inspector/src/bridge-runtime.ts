import { startElementInspector, type ElementInspectorHandle } from './browser.js';
import type { RoutePayload } from '@devanalyst/core';

export interface BrowserBridgeSnapshot {
  readonly status:
    'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'stopped';
  readonly clientId: string | null;
  readonly route: RoutePayload;
  readonly serverRoute: RoutePayload | null;
  readonly lastSource: { readonly file: string; readonly kind: string } | null;
  readonly lastError: string | null;
}

export interface BrowserBridgeHandle {
  getSnapshot(): BrowserBridgeSnapshot;
  reconnect(): void;
  stop(): void;
}

declare global {
  interface Window {
    __DEVANALYST_BRIDGE__?: BrowserBridgeHandle;
  }
}

/**
 * Self-contained development module, served without importing Node.js or application code.
 * Query strings, history state, input values, and opaque fragments are never collected.
 */
export function startBridgeRuntime(options: {
  readonly bootstrapUrl: string;
  readonly theme?: 'system' | 'light' | 'dark';
}): BrowserBridgeHandle {
  window.__DEVANALYST_BRIDGE__?.stop();
  let inspector: ElementInspectorHandle | undefined;
  let disposed = false;
  let paused = false;
  let connecting = false;
  let generation = 0;
  let attempts = 0;
  let maxAttempts = 12;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;

  function currentRoute(reason: NonNullable<RoutePayload['reason']>): RoutePayload {
    const hash = location.hash.startsWith('#!/') ? location.hash.slice(2) : location.hash.slice(1);
    return {
      pathname: location.pathname,
      hashPath: hash.startsWith('/') ? (hash.split(/[?#]/, 1)[0] ?? null) : null,
      reason,
    };
  }

  let snapshot: BrowserBridgeSnapshot = {
    status: 'connecting',
    clientId: null,
    route: currentRoute('initial'),
    serverRoute: null,
    lastSource: null,
    lastError: null,
  };

  function publish(change: Partial<BrowserBridgeSnapshot>): void {
    snapshot = { ...snapshot, ...change };
    try {
      window.dispatchEvent(new CustomEvent('devanalyst:bridge', { detail: handle.getSnapshot() }));
    } catch {
      snapshot = { ...snapshot, lastError: 'INTERNAL_ERROR' };
    }
  }

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function path(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      value.startsWith('/') &&
      value.length <= 2048 &&
      !value.includes('?') &&
      !value.includes('#') &&
      [...value].every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
    );
  }

  function route(value: unknown): value is RoutePayload {
    return (
      record(value) &&
      path(value['pathname']) &&
      (value['hashPath'] === null || value['hashPath'] === undefined || path(value['hashPath'])) &&
      (value['reason'] === undefined ||
        ['initial', 'pushState', 'replaceState', 'popstate', 'hashchange', 'reconnect'].includes(
          String(value['reason']),
        ))
    );
  }

  function capture(reason: NonNullable<RoutePayload['reason']>): void {
    if (disposed || paused) return;
    try {
      const payload = currentRoute(reason);
      publish({ route: payload });
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            version: 1,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'route.changed',
            payload,
          }),
        );
      }
    } catch {
      // A metadata failure must never turn a successful native navigation into an exception.
      publish({ lastError: 'BRIDGE_DISCONNECTED' });
    }
  }

  function retry(): void {
    if (disposed || paused || retryTimer !== undefined) return;
    if (attempts >= maxAttempts) {
      publish({ status: 'failed', lastError: 'BRIDGE_DISCONNECTED' });
      return;
    }
    const delay = Math.min(250 * 2 ** attempts, 5000) + Math.floor(Math.random() * 100);
    attempts += 1;
    publish({ status: 'reconnecting', clientId: null });
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delay);
  }

  async function connect(): Promise<void> {
    if (disposed || paused || connecting || socket !== null) return;
    connecting = true;
    const revision = generation;
    const controller = new AbortController();
    abort = controller;
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const bootstrap = new URL(options.bootstrapUrl, location.href);
      if (bootstrap.origin !== location.origin) throw new Error('Invalid bootstrap origin');
      const response = await fetch(bootstrap, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Bridge is unavailable');
      const text = await response.text();
      if (text.length > 4096) throw new Error('Invalid bootstrap size');
      const value: unknown = JSON.parse(text);
      if (
        !record(value) ||
        value['version'] !== 1 ||
        typeof value['endpoint'] !== 'string' ||
        typeof value['token'] !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value['token']) ||
        typeof value['reconnectAttempts'] !== 'number' ||
        !Number.isInteger(value['reconnectAttempts']) ||
        value['reconnectAttempts'] < 0 ||
        value['reconnectAttempts'] > 20
      )
        throw new Error('Invalid bootstrap');
      const endpoint = new URL(value['endpoint']);
      if (
        endpoint.protocol !== 'ws:' ||
        endpoint.hostname !== '127.0.0.1' ||
        endpoint.pathname !== '/__devanalyst/ws' ||
        endpoint.search ||
        endpoint.hash ||
        endpoint.username ||
        endpoint.password
      ) {
        throw new Error('Invalid bridge endpoint');
      }
      if (disposed || paused || revision !== generation) return;
      maxAttempts = value['reconnectAttempts'];
      const connection = new WebSocket(endpoint, [
        'devanalyst.v1',
        `devanalyst.auth.${value['token']}`,
      ]);
      socket = connection;
      const readyTimeout = setTimeout(() => {
        if (socket === connection && snapshot.status !== 'connected')
          connection.close(1000, 'Handshake timeout');
      }, 5000);
      connection.onmessage = (event: MessageEvent<unknown>) => {
        if (disposed || socket !== connection) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 65_536)
            throw new Error('Invalid frame');
          const message: unknown = JSON.parse(event.data);
          if (
            !record(message) ||
            message['version'] !== 1 ||
            typeof message['id'] !== 'string' ||
            typeof message['timestamp'] !== 'string' ||
            !record(message['payload'])
          )
            throw new Error('Invalid frame');
          const payload = message['payload'];
          if (message['type'] === 'bridge.ready') {
            if (
              typeof payload['clientId'] !== 'string' ||
              !/^[a-f0-9-]{36}$/.test(payload['clientId'])
            )
              throw new Error('Invalid client');
            clearTimeout(readyTimeout);
            attempts = 0;
            publish({ status: 'connected', clientId: payload['clientId'], lastError: null });
            capture(snapshot.serverRoute === null ? 'initial' : 'reconnect');
          } else if (message['type'] === 'route.acknowledged') {
            if (!route(payload['route']) || payload['clientId'] !== snapshot.clientId)
              throw new Error('Invalid route');
            publish({ serverRoute: payload['route'] });
          } else if (message['type'] === 'source.changed') {
            const file = payload['file'];
            if (
              typeof file !== 'string' ||
              file.length > 1024 ||
              file.startsWith('/') ||
              file.split('/').includes('..') ||
              !['add', 'change', 'unlink'].includes(String(payload['kind']))
            )
              throw new Error('Invalid source event');
            publish({ lastSource: { file, kind: String(payload['kind']) } });
          } else if (message['type'] === 'bridge.error') {
            const error = payload['error'];
            if (
              !record(error) ||
              typeof error['code'] !== 'string' ||
              !/^[A-Z_]{1,64}$/.test(error['code'])
            )
              throw new Error('Invalid error');
            publish({ lastError: error['code'] });
          } else throw new Error('Unsupported frame');
        } catch {
          publish({ lastError: 'INVALID_MESSAGE' });
          connection.close(1008, 'Invalid bridge message');
        }
      };
      connection.onerror = () => {
        if (!disposed) publish({ lastError: 'BRIDGE_DISCONNECTED' });
      };
      connection.onclose = () => {
        clearTimeout(readyTimeout);
        if (socket !== connection) return;
        socket = null;
        if (!disposed && !paused) retry();
      };
    } catch {
      if (!disposed && !paused && revision === generation) retry();
    } finally {
      clearTimeout(timeout);
      if (revision === generation) {
        connecting = false;
        abort = undefined;
      }
    }
  }

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const push: History['pushState'] = function (
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    const result = originalPush.apply(this, args);
    capture('pushState');
    return result;
  };
  const replace: History['replaceState'] = function (
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    const result = originalReplace.apply(this, args);
    capture('replaceState');
    return result;
  };
  const pop = (): void => capture('popstate');
  const hash = (): void => capture('hashchange');

  function pause(): void {
    paused = true;
    generation += 1;
    connecting = false;
    abort?.abort();
    clearTimeout(retryTimer);
    retryTimer = undefined;
    const previous = socket;
    socket = null;
    previous?.close(1000, 'Page suspended');
    publish({ status: 'disconnected', clientId: null });
  }

  function resume(): void {
    if (disposed) return;
    paused = false;
    attempts = 0;
    void connect();
  }

  const handle: BrowserBridgeHandle = {
    getSnapshot: () => ({
      ...snapshot,
      route: { ...snapshot.route },
      serverRoute: snapshot.serverRoute === null ? null : { ...snapshot.serverRoute },
      lastSource: snapshot.lastSource === null ? null : { ...snapshot.lastSource },
    }),
    reconnect: () => {
      if (!disposed) {
        pause();
        resume();
      }
    },
    stop: () => {
      if (disposed) return;
      disposed = true;
      inspector?.stop();
      pause();
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      window.removeEventListener('popstate', pop);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      if (window.__DEVANALYST_BRIDGE__ === handle) delete window.__DEVANALYST_BRIDGE__;
      publish({ status: 'stopped' });
    },
  };
  window.__DEVANALYST_BRIDGE__ = handle;
  try {
    history.pushState = push;
    history.replaceState = replace;
    window.addEventListener('popstate', pop);
    window.addEventListener('hashchange', hash);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    inspector = startElementInspector({ theme: options.theme ?? 'system' });
    void connect();
  } catch {
    handle.stop();
    publish({ status: 'failed', lastError: 'UNSUPPORTED_FEATURE' });
  }
  return handle;
}
