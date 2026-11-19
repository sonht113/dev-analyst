import './demo.css';
import { DevAnalystClient } from '@devanalyst/next-plugin/client';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'DevAnalyst Next.js 検証環境' };

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="ja">
      <body>
        <DevAnalystClient />
        {children}
      </body>
    </html>
  );
}
