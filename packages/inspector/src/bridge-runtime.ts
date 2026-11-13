import { createInspectionClient } from './inspection-client.js';
import { startElementInspector, type ElementInspectorHandle } from './browser.js';
import type { PageProgress, RoutePayload } from '@devanalyst/core';
import { startPagePreanalysis, type BrowserPageAnalysis } from './preanalysis-runtime.js';

export interface BrowserBridgeSnapshot {
  readonly status:
    'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed' | 'stopped';
  readonly clientId: string | null;
  readonly route: RoutePayload;
  readonly serverRoute: RoutePayload | null;
  readonly lastSource: { readonly file: string; readonly kind: string } | null;
  readonly lastError: string | null;
  readonly pageAnalysis: BrowserPageAnalysis | null;
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
  readonly language?: 'en' | 'vi' | 'ja';
  readonly preanalysis?: boolean;
  readonly maxMessageBytes?: number;
}): BrowserBridgeHandle {
  window.__DEVANALYST_BRIDGE__?.stop();
  let inspector: ElementInspectorHandle | undefined;
  let inspection: ReturnType<typeof createInspectionClient> | undefined;
  const inspectionPageId = crypto.randomUUID();
  let preanalysis: ReturnType<typeof startPagePreanalysis> | undefined;
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
    pageAnalysis: null,
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
      if (
        snapshot.route?.pathname !== payload.pathname ||
        (snapshot.route?.hashPath ?? null) !== (payload.hashPath ?? null)
      )
        inspection?.invalidate();
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
        preanalysis?.reset(payload);
      }
    } catch {
      // A metadata failure must never turn a successful native navigation into an exception.
      publish({ lastError: 'BRIDGE_DISCONNECTED' });
    }
  }

  function progress(value: unknown): value is PageProgress {
    const states = ['NOT_ANALYZED', 'QUEUED', 'ANALYZING', 'READY', 'STALE', 'FAILED'];
    return (
      record(value) &&
      typeof value['requestId'] === 'string' &&
      /^[a-f0-9-]{36}$/.test(value['requestId']) &&
      typeof value['total'] === 'number' &&
      Number.isInteger(value['total']) &&
      value['total'] >= 0 &&
      value['total'] <= 128 &&
      typeof value['completed'] === 'number' &&
      Number.isInteger(value['completed']) &&
      value['completed'] >= 0 &&
      value['completed'] <= value['total'] &&
      typeof value['limited'] === 'boolean' &&
      Array.isArray(value['items']) &&
      value['items'].length <= 16 &&
      value['items'].every(
        (item: unknown) =>
          record(item) &&
          typeof item['revision'] === 'string' &&
          /^[a-f0-9]{64}$/.test(item['revision']) &&
          typeof item['elementId'] === 'string' &&
          /^[a-f0-9]{64}$/.test(item['elementId']) &&
          typeof item['state'] === 'string' &&
          states.includes(item['state']) &&
          typeof item['aiState'] === 'string' &&
          states.includes(item['aiState']) &&
          ['miss', 'fresh', 'stale'].includes(String(item['cache'])) &&
          (item['error'] === null ||
            (typeof item['error'] === 'string' && /^[A-Z_]{1,64}$/.test(item['error']))),
      )
    );
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
            inspection?.invalidate();
            capture(snapshot.serverRoute === null ? 'initial' : 'reconnect');
          } else if (message['type'] === 'route.acknowledged') {
            if (!route(payload['route']) || payload['clientId'] !== snapshot.clientId)
              throw new Error('Invalid route');
            publish({ serverRoute: payload['route'] });
          } else if (message['type'] === 'inspector.update') {
            if (!inspection?.accept(payload)) throw new Error('Invalid inspector result');
          } else if (message['type'] === 'page.progress') {
            if (!progress(payload)) throw new Error('Invalid page progress');
            preanalysis?.progress(payload);
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
            inspection?.invalidate();
            publish({ lastSource: { file, kind: String(payload['kind']) } });
            preanalysis?.refresh();
          } else if (message['type'] === 'bridge.error') {
            const error = payload['error'];
            if (
              !record(error) ||
              typeof error['code'] !== 'string' ||
              !/^[A-Z_]{1,64}$/.test(error['code'])
            )
              throw new Error('Invalid error');
            if (['SOURCE_CHANGED', 'WORKSPACE_ACCESS_DENIED'].includes(error['code']))
              inspection?.invalidate();
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
        preanalysis?.pause();
        inspection?.invalidate();
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
  const mappingInvalidated = (): void => inspection?.invalidate();

  function pause(): void {
    paused = true;
    preanalysis?.pause();
    inspection?.invalidate();
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
      pageAnalysis: preanalysis?.getSnapshot() ?? null,
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
      inspection?.stop();
      preanalysis?.stop();
      pause();
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      window.removeEventListener('popstate', pop);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('devanalyst:mapping-invalidated', mappingInvalidated);
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
    window.addEventListener('devanalyst:mapping-invalidated', mappingInvalidated);
    if (options.preanalysis !== false)
      preanalysis = startPagePreanalysis({
        maxMessageBytes: options.maxMessageBytes ?? 16384,
        send: (type, payload) => {
          if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 32768) return false;
          const message = JSON.stringify({
            version: 1,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            type,
            payload,
          });
          if (new TextEncoder().encode(message).length > (options.maxMessageBytes ?? 16384))
            return false;
          socket.send(message);
          return true;
        },
        changed: () => publish({ pageAnalysis: preanalysis?.getSnapshot() ?? null }),
      });
    inspection = createInspectionClient({
      route: () => snapshot.route,
      pageId: () => preanalysis?.getSnapshot()?.requestId ?? inspectionPageId,
      changed: () => window.dispatchEvent(new Event('devanalyst:inspection')),
      send: (type, payload) => {
        if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 32768) return false;
        const message = JSON.stringify({
          version: 1,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type,
          payload,
        });
        if (new TextEncoder().encode(message).length > (options.maxMessageBytes ?? 16384))
          return false;
        socket.send(message);
        return true;
      },
    });
    inspector = startElementInspector({
      theme: options.theme ?? 'system',
      language: options.language ?? 'en',
      onInspection: (metadata, expanded) => inspection?.inspect(metadata, expanded),
      getInspection: () => inspection?.getSnapshot() ?? null,
      onClose: () => inspection?.cancel(),
      onPriority: (element, priority) => preanalysis?.prioritize(element, priority),
    });
    void connect();
  } catch {
    handle.stop();
    publish({ status: 'failed', lastError: 'UNSUPPORTED_FEATURE' });
  }
  return handle;
}
