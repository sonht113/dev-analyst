import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  clientEventSchema,
  DevAnalystError,
  PROTOCOL_VERSION,
  type BridgeOptions,
  type ClientEvent,
  type PageProgress,
  type InspectorUpdate,
  type RoutePayload,
  type ServerEvent,
  type BridgeBootstrap,
  type SerializedError,
} from '@devanalyst/core';

export interface BridgeClient {
  readonly id: string;
  readonly route: Readonly<RoutePayload> | null;
}

export type BridgeLifecycleEvent =
  | {
      readonly type: 'inspector';
      readonly clientId: string;
      readonly event: Extract<ClientEvent, { type: 'inspector.request' | 'inspector.cancel' }>;
    }
  | {
      readonly type: 'page';
      readonly clientId: string;
      readonly event: Extract<ClientEvent, { type: 'page.index' | 'page.priority' }>;
    }
  | { readonly type: 'connected' | 'disconnected'; readonly clientId: string }
  | { readonly type: 'route'; readonly clientId: string; readonly route: Readonly<RoutePayload> }
  | { readonly type: 'source'; readonly file: string; readonly kind: 'add' | 'change' | 'unlink' };

export interface LocalBridge {
  readonly port: number;
  bootstrap(): BridgeBootstrap;
  clients(): readonly BridgeClient[];
  sourceChanged(file: string, kind: 'add' | 'change' | 'unlink'): void;
  reportError(error: SerializedError): void;
  progress(clientId: string, payload: PageProgress): void;
  inspection(clientId: string, payload: InspectorUpdate): void;
  close(): Promise<void>;
}

interface Peer {
  readonly id: string;
  route: RoutePayload | null;
  alive: boolean;
  windowStart: number;
  messages: number;
}

export function errorHasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function isLoopbackPeer(address: string | undefined): boolean {
  if (address === '::1') return true;
  const normalized = address?.replace(/^::ffff:/i, '');
  return normalized !== undefined && isIP(normalized) === 4 && normalized.startsWith('127.');
}

function envelope(): { version: 1; id: string; timestamp: string } {
  return { version: PROTOCOL_VERSION, id: randomUUID(), timestamp: new Date().toISOString() };
}

function reject(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy(),
  );
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, rejectPromise) => {
    const failed = (error: Error): void => {
      server.off('listening', listening);
      rejectPromise(error);
    };
    const listening = (): void => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen(port, '127.0.0.1');
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new DevAnalystError('BRIDGE_START_FAILED', 'The loopback bridge address is unavailable.');
  return address.port;
}

/** Authenticates upgrades before allocating a WebSocket session. Never serves files. */
export async function startLocalBridge(options: {
  readonly settings: BridgeOptions;
  readonly origins: () => readonly string[];
  readonly onEvent: (event: BridgeLifecycleEvent) => void;
  readonly onError: (error: DevAnalystError) => void;
}): Promise<LocalBridge> {
  const { settings } = options;
  const token = randomBytes(32).toString('hex');
  const tokenBytes = Buffer.from(token);
  const peers = new Map<WebSocket, Peer>();
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  http.requestTimeout = 5000;
  http.headersTimeout = 5000;
  http.on('clientError', (_error, socket) => socket.destroy());
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: settings.maxMessageBytes,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has('devanalyst.v1') ? 'devanalyst.v1' : false),
  });
  let port = settings.port;
  for (let attempt = 0; ; attempt += 1) {
    try {
      port = await listen(http, port);
      break;
    } catch (cause: unknown) {
      if (
        !errorHasCode(cause, 'EADDRINUSE') ||
        settings.strictPort ||
        port === 0 ||
        attempt + 1 >= settings.maxPortAttempts ||
        port === 65535
      ) {
        sockets.close();
        throw new DevAnalystError(
          errorHasCode(cause, 'EADDRINUSE') ? 'BRIDGE_PORT_IN_USE' : 'BRIDGE_START_FAILED',
          'The local bridge could not bind. Choose bridge.port: 0, a free port, or strictPort: false.',
          { cause },
        );
      }
      port += 1;
    }
  }
  let closing: Promise<void> | undefined;
  http.on('error', () =>
    options.onError(
      new DevAnalystError(
        'BRIDGE_START_FAILED',
        'The local bridge server failed. Restart the Vite server.',
      ),
    ),
  );
  sockets.on('error', () =>
    options.onError(
      new DevAnalystError(
        'BRIDGE_DISCONNECTED',
        'The local WebSocket server failed. Restart the Vite server.',
      ),
    ),
  );

  function send(socket: WebSocket, message: ServerEvent): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > settings.maxMessageBytes * 4) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message), (error) => {
      if (error) socket.terminate();
    });
  }

  function authorized(request: IncomingMessage): boolean {
    if (!isLoopbackPeer(request.socket.remoteAddress)) return false;
    if (!request.headers.origin || !options.origins().includes(request.headers.origin))
      return false;
    if (
      (request.headers.host !== `127.0.0.1:${port}` &&
        !(port === 80 && request.headers.host === '127.0.0.1')) ||
      request.url !== '/__devanalyst/ws'
    )
      return false;
    const protocols =
      request.headers['sec-websocket-protocol']?.split(',').map((value) => value.trim()) ?? [];
    if (protocols.length !== 2 || !protocols.includes('devanalyst.v1')) return false;
    const credential = protocols
      .find((value) => value.startsWith('devanalyst.auth.'))
      ?.slice('devanalyst.auth.'.length);
    if (credential === undefined || !/^[a-f0-9]{64}$/.test(credential)) return false;
    const supplied = Buffer.from(credential);
    return supplied.length === tokenBytes.length && timingSafeEqual(supplied, tokenBytes);
  }

  http.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (closing !== undefined) {
      reject(socket, 503);
      return;
    }
    if (!authorized(request)) {
      reject(socket, 403);
      return;
    }
    if (peers.size >= settings.maxConnections) {
      reject(socket, 429);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (connection) =>
      sockets.emit('connection', connection),
    );
  });

  sockets.on('connection', (socket) => {
    const peer: Peer = {
      id: randomUUID(),
      route: null,
      alive: true,
      windowStart: Date.now(),
      messages: 0,
    };
    peers.set(socket, peer);
    options.onEvent({ type: 'connected', clientId: peer.id });
    send(socket, { ...envelope(), type: 'bridge.ready', payload: { clientId: peer.id } });
    socket.on('pong', () => {
      peer.alive = true;
    });
    socket.on('error', () => {
      if (socket.readyState === WebSocket.OPEN) socket.terminate();
    });
    socket.once('close', () => {
      peers.delete(socket);
      options.onEvent({ type: 'disconnected', clientId: peer.id });
    });
    socket.on('message', (data, binary) => {
      if (Date.now() - peer.windowStart >= 1000) {
        peer.windowStart = Date.now();
        peer.messages = 0;
      }
      peer.messages += 1;
      if (binary || peer.messages > 60) {
        socket.close(1008, 'Unsupported or excessive messages');
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        socket.close(1008, 'Invalid JSON');
        return;
      }
      const parsed = clientEventSchema.safeParse(value);
      if (!parsed.success) {
        socket.close(1008, 'Invalid bridge message');
        return;
      }
      if (parsed.data.type === 'route.changed') {
        peer.route = parsed.data.payload;
        options.onEvent({ type: 'route', clientId: peer.id, route: { ...parsed.data.payload } });
        send(socket, {
          ...envelope(),
          type: 'route.acknowledged',
          payload: { clientId: peer.id, route: parsed.data.payload },
        });
      } else if (
        parsed.data.type === 'inspector.request' ||
        parsed.data.type === 'inspector.cancel'
      ) {
        if (
          peer.route &&
          (parsed.data.type === 'inspector.cancel' ||
            (peer.route.pathname === parsed.data.payload.route.pathname &&
              (peer.route.hashPath ?? null) === (parsed.data.payload.route.hashPath ?? null)))
        )
          options.onEvent({ type: 'inspector', clientId: peer.id, event: parsed.data });
      } else if (parsed.data.type === 'page.index' || parsed.data.type === 'page.priority') {
        if (
          peer.route &&
          (parsed.data.type === 'page.priority' ||
            (parsed.data.payload.route.pathname === peer.route.pathname &&
              (parsed.data.payload.route.hashPath ?? null) === (peer.route.hashPath ?? null)))
        )
          options.onEvent({ type: 'page', clientId: peer.id, event: parsed.data });
      } else {
        send(socket, {
          ...envelope(),
          type: 'bridge.error',
          payload: {
            requestId: parsed.data.payload.requestId,
            error: {
              code: 'UNSUPPORTED_FEATURE',
              message: 'This phase supports route tracking and source-change notifications only.',
              recoverable: true,
            },
          },
        });
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) {
        socket.terminate();
        continue;
      }
      peer.alive = false;
      socket.ping(undefined, false, (error) => {
        if (error) socket.terminate();
      });
    }
  }, 15_000);
  heartbeat.unref();

  return {
    port,
    bootstrap: () => ({
      version: PROTOCOL_VERSION,
      endpoint: `ws://127.0.0.1:${port}/__devanalyst/ws`,
      token,
      reconnectAttempts: settings.reconnectAttempts,
    }),
    clients: () =>
      [...peers.values()].map((peer) => ({
        id: peer.id,
        route: peer.route === null ? null : { ...peer.route },
      })),
    sourceChanged(file, kind) {
      options.onEvent({ type: 'source', file, kind });
      for (const socket of peers.keys())
        send(socket, { ...envelope(), type: 'source.changed', payload: { file, kind } });
    },
    progress(clientId, payload) {
      for (const [socket, peer] of peers)
        if (peer.id === clientId) send(socket, { ...envelope(), type: 'page.progress', payload });
    },
    inspection(clientId, payload) {
      for (const [socket, peer] of peers)
        if (peer.id === clientId)
          send(socket, { ...envelope(), type: 'inspector.update', payload });
    },
    reportError(error) {
      for (const socket of peers.keys())
        send(socket, { ...envelope(), type: 'bridge.error', payload: { requestId: null, error } });
    },
    close() {
      closing ??= (async () => {
        clearInterval(heartbeat);
        for (const socket of peers.keys()) socket.close(1001, 'Vite server stopping');
        const deadline = setTimeout(() => {
          for (const socket of peers.keys()) socket.terminate();
        }, 250);
        deadline.unref();
        http.closeAllConnections();
        await Promise.all([
          new Promise<void>((resolve) => sockets.close(() => resolve())),
          new Promise<void>((resolve) => http.close(() => resolve())),
        ]);
        clearTimeout(deadline);
        peers.clear();
      })();
      return closing;
    },
  };
}
