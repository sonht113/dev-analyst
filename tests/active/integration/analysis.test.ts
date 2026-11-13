import { afterEach, describe, expect, it } from 'vitest';
import { createStaticAnalyzer } from '@devanalyst/analyzer';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const cleanup: string[] = [];
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-static-integration-'));
  cleanup.push(root);
  for (const [name, path] of [
    ['App.tsx', 'src/App.tsx'],
    ['orders.ts', 'src/services/orders.ts'],
    ['api.js', 'src/api.js'],
    ['Child.jsx', 'packages/ui/Child.jsx'],
  ]) {
    if (!name || !path) throw new Error('Invalid fixture');
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(
      join(root, path),
      await readFile(resolve(`tests/fixtures/static-analysis/${name}.txt`), 'utf8'),
    );
  }
  await writeFile(
    join(root, 'tsconfig.json'),
    '{"compilerOptions":{"baseUrl":".","paths":{"@services/*":["src/services/*"],"@ui/*":["packages/ui/*"]}}}',
  );
  return root;
}
const source = { file: 'src/App.tsx', start: null, end: null };
describe('public static engine integration', () => {
  it('traces selected JSX handlers across real JS/TS workspace files with evidence, aliases and confidence', async () => {
    const root = await fixture();
    const engine = createStaticAnalyzer({
      workspaceRoot: root,
      source: { include: ['src/**', 'packages/ui/**', 'tsconfig.json'] },
      tsconfig: 'tsconfig.json',
    });
    const result = await engine.analyzeDetailed({ requestId: 'integration', sources: [source] });
    const api = result.findings.find(
      (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/orders',
    );
    expect(api).toMatchObject({
      confidence: 'VERIFIED',
      detail: { client: 'axios', method: 'POST', baseURL: '/api' },
      execution: 'not-evaluated',
      evidence: { source: { file: 'src/api.js', start: { line: 4 } } },
    });
    expect(
      api?.traces.some((trace) =>
        ['src/App.tsx', 'src/services/orders.ts', 'src/api.js'].every((file) =>
          trace.path.some((reference) => reference.file === file),
        ),
      ),
    ).toBe(true);
    const handler = result.findings.find(
      (finding) =>
        finding.detail.kind === 'handler' &&
        finding.detail.event === 'onClick' &&
        finding.detail.expression === 'submit',
    );
    expect(
      handler?.conditions.map((condition) => ({
        expression: condition.expression,
        branch: condition.branch,
      })),
    ).toEqual(
      expect.arrayContaining([
        { expression: 'canSave', branch: 'truthy' },
        { expression: '!visible', branch: 'falsy' },
      ]),
    );
    expect(
      result.findings.some(
        (finding) =>
          finding.detail.kind === 'navigation' &&
          finding.detail.destination === '/orders' &&
          finding.evidence?.source.file === 'src/App.tsx',
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result.metrics.files).toBe(5);
    expect(result.completion).toBe('complete');
    await writeFile(
      join(tmpdir(), 'devanalyst-phase05-metrics.json'),
      JSON.stringify(
        {
          metrics: result.metrics,
          findings: result.findings.length,
          nodes: result.graph.nodes.length,
          edges: result.graph.edges.length,
        },
        null,
        2,
      ),
    );
  });
  it('uses an exact source selection to identify a button and connects its static call graph to the API leaf', async () => {
    const root = await fixture();
    const code = await readFile(join(root, 'src/App.tsx'), 'utf8');
    const prefix = code.slice(0, code.indexOf('<button disabled')).split('\n');
    const engine = createStaticAnalyzer({
      workspaceRoot: root,
      source: { include: ['src/**', 'packages/ui/**', 'tsconfig.json'] },
      tsconfig: 'tsconfig.json',
    });
    const result = await engine.analyzeDetailed({
      requestId: 'selected',
      sources: [
        { ...source, start: { line: prefix.length, column: (prefix.at(-1)?.length ?? 0) + 1 } },
      ],
    });
    expect(result.selectedSubjects).toHaveLength(1);
    const api = result.findings.find(
      (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/orders',
    );
    if (!api) throw new Error('Missing API finding');
    const reached = new Set(result.selectedSubjects),
      queue = [...reached];
    for (let index = 0; index < queue.length; index++) {
      for (const edge of result.graph.edges)
        if (
          edge.from === queue[index] &&
          ['handler', 'calls', 'callback'].includes(edge.kind) &&
          !reached.has(edge.to)
        ) {
          reached.add(edge.to);
          queue.push(edge.to);
        }
    }
    expect(reached.has(api.subjectId)).toBe(true);
  });
  it('does not execute source or configuration files and refreshes source snapshots on a later request', async () => {
    const root = await fixture();
    const marker = join(root, 'EXECUTED');
    await writeFile(
      join(root, 'src/danger.ts'),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'executed');throw new Error('executed');export function danger(){return fetch('/old');}`,
    );
    await writeFile(join(root, 'vite.config.ts'), `throw new Error('config executed')`);
    const engine = createStaticAnalyzer({ workspaceRoot: root });
    const request = {
      requestId: 'source-read-only',
      sources: [{ ...source, file: 'src/danger.ts' }],
    };
    const before = await engine.analyzeDetailed(request);
    await expect(access(marker)).rejects.toThrow();
    expect(
      before.findings.some(
        (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/old',
      ),
    ).toBe(true);
    await writeFile(join(root, 'src/danger.ts'), 'export function danger(){return fetch("/new")}');
    const after = await engine.analyzeDetailed(request);
    expect(
      after.findings.some(
        (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/new',
      ),
    ).toBe(true);
    expect(after.sourceHashes['src/danger.ts']).not.toBe(before.sourceHashes['src/danger.ts']);
    await expect(access(marker)).rejects.toThrow();
  });
});
