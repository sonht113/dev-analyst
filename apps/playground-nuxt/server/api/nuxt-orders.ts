import { createDemoStore } from '../../app/services/demo-data.js';
const store = createDemoStore();
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  if (getRequestHeader(event, 'x-demo-failure') === 'true') {
    setResponseStatus(event, 503);
    return { message: 'デモのエラー再現' };
  }
  if (event.method === 'GET') return store.snapshot();
  if (event.method !== 'POST') {
    setResponseStatus(event, 405);
    return { message: '許可されていないリクエストメソッドです' };
  }
  try {
    let text = '';
    for await (const chunk of event.node.req) {
      text += String(chunk);
      if (text.length > 8192) {
        setResponseStatus(event, 413);
        return { message: 'リクエストが大きすぎます' };
      }
    }
    const value: unknown = JSON.parse(text);
    const result = store.command(value);
    setResponseStatus(event, result.status);
    return result.body;
  } catch {
    setResponseStatus(event, 400);
    return { message: 'デモのリクエストが無効です' };
  }
});
