import type { NextConfig } from 'next';
import { withDevAnalyst } from '@devanalyst/next-plugin';

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Keep stale dev-generated globals out of production checks without skipping library checks.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
};

export default withDevAnalyst(config);
