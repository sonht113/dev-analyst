import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'DevAnalyst Next.js playground' };

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
