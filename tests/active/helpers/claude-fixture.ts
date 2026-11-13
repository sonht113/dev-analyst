import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Finding } from '@devanalyst/core';
export async function claudeFixture(scenario: Readonly<Record<string, unknown>> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-ai-test-'));
  const file = 'src/App.tsx';
  const code = 'export const App = () => <button onClick={save}>保存</button>;';
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), code);
  const executable = join(root, 'claude');
  const fixture = await readFile(resolve('tests/fixtures/claude-cli.mjs.txt'), 'utf8');
  await writeFile(
    executable,
    `#!${process.execPath}\n` +
      fixture
        .replace('__SCENARIO__', () => JSON.stringify(scenario))
        .replace('__ROOT__', () => JSON.stringify(root)),
  );
  await chmod(executable, 0o700);
  const evidence: Finding = {
    id: '74b5936d-a472-430c-95ae-c0275d7e9ead',
    type: 'component',
    confidence: 'VERIFIED',
    explanation: 'A JSX source declaration.',
    analyzedAt: new Date().toISOString(),
    cacheStatus: 'miss',
    evidence: {
      source: { file, start: { line: 1, column: 1 }, end: { line: 1, column: code.length + 1 } },
      code,
    },
  };
  return {
    root,
    executable,
    file,
    code,
    evidence,
    options: {
      workspaceRoot: root,
      executable,
      ai: { enabled: true, permittedPaths: ['src/**'], timeoutMs: 3000 },
      retryDelayMs: 10,
    },
    request: {
      requestId: 'test',
      evidence: [evidence],
      sourceHashes: { [file]: createHash('sha256').update(code).digest('hex') },
      depth: 'standard' as const,
      uiText: [{ id: 'save', text: '保存' }],
    },
    async calls(): Promise<
      readonly { args: string[]; cwd: string; envKeys: string[]; envPath: string; input?: string }[]
    > {
      try {
        return (await readFile(join(root, 'calls.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(
            (
              line: string,
            ): {
              args: string[];
              cwd: string;
              envKeys: string[];
              envPath: string;
              input?: string;
            } => JSON.parse(line),
          );
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return [];
        throw error;
      }
    },
  };
}
