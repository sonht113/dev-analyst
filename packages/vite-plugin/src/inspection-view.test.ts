import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticAnalyzer, instrumentReactSource } from '@devanalyst/analyzer';
import { inspectorItemSchema } from '@devanalyst/core';
import { selectInspection } from './inspection-view.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it('projects the selected handler and reachable imported calls, excluding sibling behavior', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-inspection-view-'));
  roots.push(root);
  const code =
    'import {save} from "./service";export function App(){return <><button onClick={save}>保存</button><button onClick={()=>fetch("/unrelated")}>削除</button></>}';
  await writeFile(join(root, 'App.tsx'), code);
  await writeFile(
    join(root, 'service.ts'),
    'export function save(){return request()} function request(){return fetch("/orders",{method:"POST"})}',
  );
  const result = await createStaticAnalyzer({
    workspaceRoot: root,
    source: { include: ['**/*.ts', '**/*.tsx'] },
  }).analyzeDetailed({
    requestId: 'projection',
    sources: [{ file: 'App.tsx', start: null, end: null }],
  });
  const site = instrumentReactSource(code, 'App.tsx', '/__devanalyst/mapping-runtime.js').manifest
    .sites[0];
  if (!site) throw new Error('Missing selected origin');
  const selected = selectInspection(result, site);
  expect(selected.items.some((item) => item.group === 'handler')).toBe(true);
  expect(
    selected.items.some((item) => item.group === 'api' && item.title.includes('/orders')),
  ).toBe(true);
  expect(JSON.stringify(selected)).not.toContain('/unrelated');
  expect(
    selected.items.some((item) => item.trace.some((source) => source.file === 'service.ts')),
  ).toBe(true);
  for (const item of selected.items) expect(inspectorItemSchema.safeParse(item).success).toBe(true);
  expect(result.findings.every((finding) => finding.execution === 'not-evaluated')).toBe(true);
  expect(
    selectInspection(result, {
      ...site,
      source: { ...site.source, start: { line: 1000, column: 1 } },
    }),
  ).toMatchObject({
    limited: true,
    findings: [],
    items: [{ confidence: 'UNKNOWN', evidence: null }],
  });
});
