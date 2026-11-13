import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['bridge.spec.ts', 'inspector.spec.ts', 'mapping.spec.ts'],
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  // Network traces would persist bootstrap credentials. Keep only fixture screenshots on failure.
  use: { browserName: 'chromium', trace: 'off', screenshot: 'only-on-failure' },
});
