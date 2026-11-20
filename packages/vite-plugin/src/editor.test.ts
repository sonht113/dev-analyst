import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@sonht113/core';
import { openSource } from './editor.js';

const roots: string[] = [];
const previousPath = process.env['PATH'];
afterEach(async () => {
  process.env['PATH'] = previousPath;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-editor-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'bin'));
  await writeFile(
    join(root, 'src/space file.tsx'),
    'export const App = () => <button>Hi</button>;\n',
  );
  const log = join(root, 'arguments.json');
  for (const command of ['code', 'cursor'])
    await writeFile(
      join(root, 'bin', command),
      `#!${process.execPath}\nimport('node:fs').then(fs=>fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))));`,
      { mode: 0o700 },
    );
  process.env['PATH'] = join(root, 'bin');
  return { root, log };
}
const source = { file: 'src/space file.tsx', start: { line: 1, column: 26 }, end: null };
describe('safe exact editor navigation', () => {
  it.each(['code', 'cursor'] as const)(
    'launches %s with fixed argument arrays and exact coordinates',
    async (command) => {
      const { root, log } = await fixture();
      await openSource(root, defineConfig({ editor: { command } }), source);
      expect(JSON.parse(await readFile(log, 'utf8'))).toEqual([
        '--reuse-window',
        '--goto',
        `${await realpath(root)}/src/space file.tsx:1:26`,
      ]);
    },
  );
  it('rejects traversal, missing/excluded files, secrets, options, invalid positions and symlink escapes', async () => {
    const { root, log } = await fixture();
    const other = await fixture();
    await symlink(join(other.root, 'src/space file.tsx'), join(root, 'src/escape.tsx'));
    await writeFile(join(root, 'src/.env.ts'), 'PRIVATE_TOKEN');
    for (const file of [
      '../outside.ts',
      '/etc/passwd',
      '--command',
      'src/.env.ts',
      'src/escape.tsx',
      'src/missing.ts',
      'src/space file.tsx',
    ]) {
      await expect(
        openSource(root, defineConfig({ source: { exclude: ['src/space file.tsx'] } }), {
          ...source,
          file,
        }),
      ).rejects.toMatchObject({ code: expect.any(String) });
    }
    await expect(openSource(root, defineConfig({}), source, '0'.repeat(64))).rejects.toMatchObject({
      code: 'SOURCE_CHANGED',
    });
    for (const position of [
      null,
      { line: 0, column: 1 },
      { line: 99, column: 1 },
      { line: 1, column: 999 },
    ])
      await expect(
        openSource(root, defineConfig({}), { ...source, start: position }),
      ).rejects.toMatchObject({ code: expect.any(String) });
    await expect(readFile(log)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports disabled and missing editor commands with recovery', async () => {
    const { root } = await fixture();
    await expect(
      openSource(root, defineConfig({ editor: { enabled: false } }), source),
    ).rejects.toMatchObject({ code: 'DEVELOPMENT_ONLY' });
    process.env['PATH'] = join(root, 'missing-bin');
    await expect(openSource(root, defineConfig({}), source)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FEATURE',
      message: expect.stringContaining('PATH'),
    });
  });
});
