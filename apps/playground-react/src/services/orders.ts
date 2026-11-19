import type { Order } from './demo-data.js';
import { isOrder, type OrdersPayload, type OrderCommand } from './demo-data.js';
async function decode(response: Response): Promise<OrdersPayload> {
  if (!response.ok)
    throw new Error(
      response.status === 503
        ? 'デモAPIで503エラーを再現しています。エラー再現を解除するか、再試行してください。'
        : response.status === 409
          ? 'データが更新されています。再読み込みしてから続けてください。'
          : 'リクエストを完了できません。再試行してください。',
    );
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('orders' in value) ||
    !Array.isArray(value.orders) ||
    value.orders.length > 100 ||
    !value.orders.every(isOrder)
  )
    throw new Error('デモAPIから無効なデータが返されました。');
  return { orders: value.orders };
}
export async function getOrders(fail = false, signal?: AbortSignal): Promise<OrdersPayload> {
  const response = await fetch('/api/react-orders', {
    cache: 'no-store',
    headers: { 'x-demo-failure': String(fail) },
    ...(signal ? { signal } : {}),
  });
  return decode(response);
}
export async function saveOrder(
  command: OrderCommand = { action: 'refresh' },
  fail = false,
): Promise<OrdersPayload> {
  const response = await fetch('/api/react-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-demo-failure': String(fail) },
    body: JSON.stringify(command),
  });
  return decode(response);
}

export function exportOrders(orders: readonly Order[]): void {
  const csv = [
    '注文番号,顧客,数量,合計金額,ステータス',
    ...orders.map((order) =>
      [
        order.id,
        order.customer,
        order.quantity,
        order.quantity * order.unitPrice,
        order.status,
      ].join(','),
    ),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'demo-orders.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Explicit read-only integration-lab probe; business edits use saveOrder. */
export async function probeOrders(): Promise<OrdersPayload> {
  const response = await fetch('/api/react-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh' }),
  });
  return decode(response);
}
