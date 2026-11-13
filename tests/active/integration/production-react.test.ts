import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { build } from 'vite';

afterEach(() => vi.unstubAllEnvs());

it('excludes bridge code, endpoints, credentials, and local paths from the real React playground build', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const root = resolve('apps/playground-react');
  const output = await build({ root, logLevel: 'silent', build: { write: false } });
  const builds = Array.isArray(output) ? output : [output];
  let chunks = 0;
  for (const result of builds) {
    if (!('output' in result)) throw new Error('Expected a completed production build');
    for (const chunk of result.output) {
      const text =
        chunk.type === 'chunk'
          ? chunk.code
          : typeof chunk.source === 'string'
            ? chunk.source
            : new TextDecoder().decode(chunk.source);
      for (const forbidden of [
        '/__devanalyst/',
        '__DEVANALYST_BRIDGE__',
        'devanalyst.auth.',
        'startBridgeRuntime',
        '__DEVANALYST_INSPECTOR__',
        'devanalyst-inspector',
        'data-devanalyst-overlay',
        'startElementInspector',
        'extractElementMetadata',
        'registerSourceModule',
        'createStaticAnalyzer',
        'createClaudeCodeProvider',
        'devanalyst-claude-',
        '--strict-mcp-config',
        '__devanalyst_workspace__',
        'not-evaluated',
        'compile-time-ref-v1',
        'mapping-runtime.js',
        'devanalyst.mapping.registry',
        '__devanalystBinding',
        root,
        process.cwd(),
      ])
        expect(text).not.toContain(forbidden);
      chunks += 1;
    }
  }
  expect(chunks).toBeGreaterThan(0);
});
