import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBoundaries, extractImports, findCycles } from '../../scripts/check-boundaries.mjs';

describe('workspace dependency boundaries', () => {
  it('accepts an acyclic graph', () => {
    expect(
      findCycles(
        new Map([
          ['inspector', ['core']],
          ['core', []],
        ]),
      ),
    ).toEqual([]);
  });

  it('detects transitive and self cycles', () => {
    expect(
      findCycles(
        new Map([
          ['a', ['b']],
          ['b', ['c']],
          ['c', ['a']],
        ]),
      ),
    ).toEqual(['a -> b -> c -> a']);
    expect(findCycles(new Map([['a', ['a']]]))).toEqual(['a -> a']);
  });

  it('detects dependencies across supported import syntaxes', () => {
    const result = extractImports(
      `import type { X } from 'a';
       export { Y } from 'b';
       type Z = import('c').Z;
       const d = import('node:fs');
       const e = require('e');
       const unknown = import(variable);`,
      'example.ts',
    );
    expect(result.imports).toEqual(['a', 'b', 'c', 'node:fs', 'e']);
    expect(result.dynamic).toBe(true);
  });

  it('reads Vue script dependencies without treating templates as TypeScript', () => {
    expect(
      extractImports(
        '<script setup lang="ts">import { ref } from "vue";</script><template />',
        'App.vue',
      ),
    ).toEqual({ imports: ['vue'], dynamic: false });
  });

  it('validates the real workspace', async () => {
    expect(await checkBoundaries()).toEqual([]);
  });

  it('rejects Node imports, undeclared imports, deep imports, and relative escapes in browser code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devanalyst-boundaries-'));
    try {
      await mkdir(join(root, 'apps'));
      await mkdir(join(root, 'packages/core/src'), { recursive: true });
      await mkdir(join(root, 'packages/inspector/src'), { recursive: true });
      await writeFile(
        join(root, 'packages/core/package.json'),
        JSON.stringify({ name: '@devanalyst/core' }),
      );
      await writeFile(join(root, 'packages/core/src/index.ts'), 'export {};');
      await writeFile(
        join(root, 'packages/inspector/package.json'),
        JSON.stringify({
          name: '@devanalyst/inspector',
          dependencies: { '@devanalyst/core': 'workspace:*' },
        }),
      );
      await writeFile(
        join(root, 'packages/inspector/src/index.ts'),
        `
        import 'node:fs';
        export * from '@devanalyst/core/private';
        import 'undeclared';
        import '../../core/src/index.js';
      `,
      );
      const errors = await checkBoundaries(root);
      expect(errors).toHaveLength(4);
      expect(errors.join('\n')).toContain('Node.js import node:fs');
      expect(errors.join('\n')).toContain('internal deep import');
      expect(errors.join('\n')).toContain('undeclared dependency');
      expect(errors.join('\n')).toContain('cross-boundary relative import');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
