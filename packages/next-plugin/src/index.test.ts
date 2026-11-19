import console from 'node:console';
import { afterEach, expect, it, vi } from 'vitest';
import { withDevAnalyst } from './index.js';
afterEach(() => vi.unstubAllEnvs());
it('leaves production and ordinary Next startup configuration untouched', () => {
  const config = { reactStrictMode: true };
  expect(withDevAnalyst(config)('phase-production-build')).toBe(config);
  expect(withDevAnalyst(config)('phase-development-server')).toBe(config);
});
it('preserves conflicting user compiler rules without blocking the host', () => {
  vi.stubEnv('DEVANALYST_NEXT_COMPILER_SOCKET', '/owned/compiler.sock');
  vi.stubEnv('DEVANALYST_NEXT_WORKSPACE_ROOT', '/workspace');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const config = { turbopack: { rules: { '*.tsx': { loaders: ['original'] } } } };
  expect(withDevAnalyst(config)('phase-development-server')).toBe(config);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('mapping is disabled'));
});
