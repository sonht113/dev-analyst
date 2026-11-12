'use client';

import { useState } from 'react';

export default function Home(): React.JSX.Element {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>DevAnalyst Next.js playground</h1>
      <p>Next.js foundation. Inspector and AI are not enabled.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Count: {count}
      </button>
    </main>
  );
}
