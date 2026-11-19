export type OrderStatus = 'pending' | 'approved' | 'shipped' | 'cancelled';
export const orderStatuses: readonly OrderStatus[] = [
  'pending',
  'approved',
  'shipped',
  'cancelled',
];
export interface Order {
  id: number;
  customer: string;
  product: string;
  quantity: number;
  unitPrice: number;
  status: OrderStatus;
  priority: boolean;
  note: string;
  date: string;
}
export interface OrdersPayload {
  orders: Order[];
}
export interface OrderCommand {
  action: 'refresh' | 'approve' | 'update' | 'reset';
  ids?: number[];
  quantity?: number;
  priority?: boolean;
  note?: string;
}
export const statusLabels: Record<OrderStatus, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  shipped: '配送済み',
  cancelled: 'キャンセル済み',
};
export function createOrders(): Order[] {
  const customers = [
    '青空ストア',
    'さくらスタジオ',
    'ひかりマーケット',
    '東京デザイン',
    'なみ工房',
    'くも書店',
  ];
  const products = [
    'メカニカルキーボード',
    'ワイヤレスマウス',
    '27インチモニター',
    'デスクライト',
    'USB-Cハブ',
    'スタジオヘッドホン',
  ];
  const states: OrderStatus[] = [
    'pending',
    'approved',
    'shipped',
    'pending',
    'cancelled',
    'pending',
  ];
  return Array.from({ length: 36 }, (_, index) => ({
    id: 42 + index,
    customer: customers[index % 6] ?? 'サンプル顧客',
    product: products[index % 6] ?? 'サンプル商品',
    quantity: (index % 4) + 1,
    unitPrice: [12800, 4900, 32800, 6400, 8900, 15800][index % 6] ?? 1000,
    status: states[index % 6] ?? 'pending',
    priority: index % 5 === 0,
    note: '営業時間内に配送してください。',
    date: `2026-11-${String(16 - (index % 12)).padStart(2, '0')}`,
  }));
}
export const money = (value: number) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value);
export function isOrder(value: unknown): value is Order {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value &&
    Number.isSafeInteger(value.id) &&
    Number(value.id) > 0 &&
    'customer' in value &&
    typeof value.customer === 'string' &&
    value.customer.length <= 100 &&
    'product' in value &&
    typeof value.product === 'string' &&
    value.product.length <= 100 &&
    'quantity' in value &&
    Number.isInteger(value.quantity) &&
    Number(value.quantity) >= 1 &&
    Number(value.quantity) <= 99 &&
    'unitPrice' in value &&
    typeof value.unitPrice === 'number' &&
    Number.isFinite(value.unitPrice) &&
    value.unitPrice >= 0 &&
    value.unitPrice <= 1000000 &&
    'status' in value &&
    ['pending', 'approved', 'shipped', 'cancelled'].includes(String(value.status)) &&
    'priority' in value &&
    typeof value.priority === 'boolean' &&
    'note' in value &&
    typeof value.note === 'string' &&
    value.note.length <= 500 &&
    'date' in value &&
    typeof value.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date)
  );
}
/** Synthetic, process-local demo API data. No database, credentials or external requests. */
export function createDemoStore() {
  let orders = createOrders();
  return {
    snapshot: (): OrdersPayload => ({ orders: orders.map((order) => ({ ...order })) }),
    command(value: unknown): { status: number; body: OrdersPayload | { message: string } } {
      if (
        typeof value !== 'object' ||
        value === null ||
        !('action' in value) ||
        !['refresh', 'approve', 'update', 'reset'].includes(String(value.action)) ||
        Object.keys(value).some(
          (key) => !['action', 'ids', 'quantity', 'priority', 'note'].includes(key),
        )
      )
        return { status: 400, body: { message: 'デモのリクエストが無効です。' } };
      if (value.action === 'refresh') return { status: 200, body: this.snapshot() };
      if (value.action === 'reset') {
        orders = createOrders();
        return { status: 200, body: this.snapshot() };
      }
      if (
        !('ids' in value) ||
        !Array.isArray(value.ids) ||
        !value.ids.length ||
        value.ids.length > 36 ||
        value.ids.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id)) ||
        new Set(value.ids).size !== value.ids.length
      )
        return { status: 400, body: { message: '有効な注文を1〜36件選択してください。' } };
      const ids: unknown[] = value.ids;
      const selected = orders.filter((order) => ids.includes(order.id));
      if (selected.length !== ids.length)
        return { status: 404, body: { message: '注文が見つかりません。' } };
      if (value.action === 'approve') {
        if (selected.some((order) => order.status !== 'pending'))
          return {
            status: 409,
            body: { message: '承認待ちの注文のみ承認できます。データを再読み込みしてください。' },
          };
        orders = orders.map((order) =>
          ids.includes(order.id) ? { ...order, status: 'approved' } : order,
        );
      } else {
        if (
          ids.length !== 1 ||
          !('quantity' in value) ||
          typeof value.quantity !== 'number' ||
          !Number.isInteger(value.quantity) ||
          value.quantity < 1 ||
          value.quantity > 99 ||
          !('priority' in value) ||
          typeof value.priority !== 'boolean' ||
          !('note' in value) ||
          typeof value.note !== 'string' ||
          value.note.length > 500 ||
          selected.some((order) => order.status !== 'pending')
        )
          return {
            status: 400,
            body: {
              message:
                '承認待ちの注文のみ編集できます。数量は1〜99、メモは500文字以内で入力してください。',
            },
          };
        const { quantity, priority, note } = value;
        orders = orders.map((order) =>
          ids.includes(order.id) ? { ...order, quantity, priority, note } : order,
        );
      }
      return { status: 200, body: this.snapshot() };
    },
  };
}
