import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App(): React.JSX.Element {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>DevAnalyst React playground</h1>
      <p>React + Vite foundation. Inspector and AI are not enabled.</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Count: {count}
      </button>
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('The playground root element is missing.');
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
