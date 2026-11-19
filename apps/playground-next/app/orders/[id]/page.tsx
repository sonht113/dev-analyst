import OrderClient from './OrderClient';
export default async function OrderPage() {
  return (
    <main>
      <h2 id="server-heading">注文詳細（サーバーで表示）</h2>
      <OrderClient />
    </main>
  );
}
