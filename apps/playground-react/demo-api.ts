import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createDemoStore } from './src/services/demo-data.js';
/** Local development/preview synthetic API. All mutations stay in this server's memory. */
export function demoApi(): Plugin {
  const store = createDemoStore();
  const middleware = (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ): void => {
    if (request.url?.split('?')[0] !== '/api/react-orders') {
      next();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers['x-demo-failure'] === 'true') {
      response.writeHead(503);
      response.end(JSON.stringify({ message: 'デモのエラー再現' }));
      return;
    }
    if (request.method === 'GET') {
      response.end(JSON.stringify(store.snapshot()));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405);
      response.end(JSON.stringify({ message: '許可されていないリクエストメソッドです' }));
      return;
    }
    void (async () => {
      try {
        let body = '';
        for await (const chunk of request) {
          body += String(chunk);
          if (body.length > 8192) {
            response.writeHead(413);
            response.end(JSON.stringify({ message: 'リクエストが大きすぎます' }));
            return;
          }
        }
        const value: unknown = JSON.parse(body);
        const result = store.command(value);
        response.writeHead(result.status);
        response.end(JSON.stringify(result.body));
      } catch {
        if (!response.headersSent) response.writeHead(400);
        response.end(JSON.stringify({ message: 'デモのリクエストが無効です' }));
      }
    })();
  };
  return {
    name: 'commerce-demo-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
