import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@devanalyst/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/{core,vite-plugin,inspector,analyzer,ai,cache,cli}/**/*.test.ts',
      'tests/active/**/*.test.ts',
    ],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
