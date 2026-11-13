import { afterEach, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStaticAnalyzer } from '@devanalyst/analyzer';
import { createClaudeCodeProvider } from '@devanalyst/ai';
import { claudeFixture } from '../helpers/claude-fixture.js';
const cleanup: string[] = [];
afterEach(async () => {
  for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true });
});
it('sends validated deterministic source context through a real subprocess and resolves model citations to actual source', async () => {
  const f = await claudeFixture();
  cleanup.push(f.root);
  const code =
    'function save(){fetch("/save")} export const App = ({ready}) => ready && <button onClick={save}>保存</button>;';
  await writeFile(join(f.root, f.file), code);
  const analysis = await createStaticAnalyzer({ workspaceRoot: f.root }).analyzeDetailed({
    requestId: 'static',
    sources: [{ file: f.file, start: null, end: null }],
  });
  expect(analysis.completion).toBe('complete');
  const provider = createClaudeCodeProvider(f.options);
  const result = await provider.explainDetailed({
    ...f.request,
    evidence: analysis.findings,
    sourceHashes: analysis.sourceHashes,
  });
  expect(result.findings).toHaveLength(2);
  for (const finding of result.findings) {
    expect(finding.confidence).not.toBe('VERIFIED');
    expect(finding.evidence?.source.file).toBe(f.file);
  }
  for (const citation of result.citations)
    expect(analysis.findings.some((item) => item.id === citation.evidenceIds[0])).toBe(true);
  const call = (await f.calls()).find((item) => item.input);
  expect(call?.input).toContain('deterministicFindings');
  expect(call?.input).toContain('not-evaluated');
  expect(call?.input).toContain('"branch":"truthy"');
  expect(call?.input).toContain('"subjectId"');
  expect(call?.args).not.toEqual(
    expect.arrayContaining(['--dangerously-skip-permissions', '--add-dir']),
  );
  expect(await readFile(join(f.root, f.file), 'utf8')).toBe(code);
});
