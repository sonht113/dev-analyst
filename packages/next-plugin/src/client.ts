'use client';
import { useEffect } from 'react';
// Next replaces this exact compile-time expression; production retains no development markers.
declare const process: { env: { NODE_ENV: string } };
/** Include once in the root layout. Starts after hydration; renders no application DOM. */
export function DevAnalystClient(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const controller = new AbortController();
    let script: HTMLScriptElement | undefined;
    void fetch('/__devanalyst/diagnostics', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (
          controller.signal.aborted ||
          typeof value !== 'object' ||
          value === null ||
          !('state' in value) ||
          value.state !== 'ready'
        )
          return;
        script = document.createElement('script');
        script.type = 'module';
        script.src = '/__devanalyst/client.js';
        document.head.appendChild(script);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          window.dispatchEvent(
            new CustomEvent('devanalyst:diagnostic', {
              detail: {
                code: 'BRIDGE_DISCONNECTED',
                recovery: 'Start the DevAnalyst Next development wrapper and reload.',
              },
            }),
          );
      });
    return () => {
      controller.abort();
      script?.remove();
    };
  }, []);
  return null;
}
