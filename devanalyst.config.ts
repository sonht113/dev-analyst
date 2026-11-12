import { defineConfig } from '@devanalyst/core';

/** Explicit example for the React playground; Phase 02 does not auto-load this file. */
export default defineConfig({
  workspaceRoot: '../..',
  source: { include: ['apps/playground-react/src/**', 'packages/core/src/**'] },
  ai: { enabled: false, permittedPaths: [] },
});
