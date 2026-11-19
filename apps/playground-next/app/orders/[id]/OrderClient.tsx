'use client';
import { useState } from 'react';
import { saveOrder } from '../../services/orders';
export default function OrderClient() {
  const [count, setCount] = useState(0);
  function save() {
    setCount(count + 1);
    saveOrder();
  }
  return (
    <section>
      <button id="route-action" onClick={save}>
        注文詳細
      </button>
      <p>{count}</p>
    </section>
  );
}
