import type { NextConfig } from 'next';
import { withDevAnalyst } from '@sonht113/next-plugin';

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Keep stale dev-generated globals out of production checks without skipping library checks.
  typescript: { tsconfigPath: 'tsconfig.build.json' },
};

export default withDevAnalyst(config);
