import { createDemoStore } from '../../services/demo-data';
const store = createDemoStore();
export async function GET(request: Request): Promise<Response> {
  if (request.headers.get('x-demo-failure') === 'true')
    return Response.json({ message: 'デモのエラー再現' }, { status: 503 });
  return Response.json(store.snapshot(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('x-demo-failure') === 'true')
    return Response.json({ message: 'デモのエラー再現' }, { status: 503 });
  try {
    const body = await request.text();
    if (body.length > 8192)
      return Response.json({ message: 'リクエストが大きすぎます' }, { status: 413 });
    const value: unknown = JSON.parse(body);
    const result = store.command(value);
    return Response.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ message: 'デモのリクエストが無効です' }, { status: 400 });
  }
}
