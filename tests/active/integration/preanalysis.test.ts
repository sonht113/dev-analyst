import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createPageOrchestrator,
  createWorkerAnalyzer,
  createWorkspaceAccess,
} from '@devanalyst/analyzer';
import { configSchema } from '@devanalyst/core';
const roots: string[] = [];
const stops: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it('runs real AST in a cancellable worker, indexes dependencies/components, reuses hashes and refreshes dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-preanalysis-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  const code =
    'import {save} from "./service"; export function App(){return <button onClick={save}>Save</button>}';
  const file = 'src/App.tsx';
  const revision = createHash('sha256').update(code).digest('hex');
  await writeFile(join(root, file), code);
  await writeFile(join(root, 'src/service.ts'), 'export function save(){ return fetch("/orders")}');
  const source = configSchema.parse({}).source;
  const access = await createWorkspaceAccess(root, source);
  const worker = createWorkerAnalyzer({ workspaceRoot: root });
  let executions = 0,
    turns = 0;
  const interval = setInterval(() => turns++, 2);
  stops.push(() => clearInterval(interval));
  const queue = createPageOrchestrator({
    analyze: (request) => {
      executions++;
      return worker.analyzeDetailed(request);
    },
    validate: async (hashes) => {
      for (const [path, hash] of Object.entries(hashes))
        if (
          createHash('sha256')
            .update(await access.readSource(path))
            .digest('hex') !== hash
        )
          return false;
      return true;
    },
  });
  stops.push(queue.stop);
  const element = {
    elementId: 'a'.repeat(64),
    file,
    revision,
    tag: 'button',
    kind: 'button' as const,
  };
  queue.index('browser', 'initial', { pathname: '/orders/123' }, [element]);
  await expect.poll(() => queue.getSnapshot('browser')?.completed).toBe(1);
  expect(turns).toBeGreaterThan(3);
  expect(
    queue.getSnapshot('browser')?.components.some((component) => component.name === 'App'),
  ).toBe(true);
  expect(queue.getSnapshot('browser')?.files).toContain('src/service.ts');
  expect(
    queue
      .getResult(file, revision)
      ?.findings.some(
        (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/orders',
      ),
  ).toBe(true);
  queue.remove('browser');
  queue.index('browser', 'next', { pathname: '/orders/456' }, [element]);
  await expect.poll(() => queue.getSnapshot('browser')?.items[0]?.cache).toBe('fresh');
  expect(executions).toBe(1);
  await writeFile(
    join(root, 'src/service.ts'),
    'export function save(){ return fetch("/updated")}',
  );
  queue.invalidate('src/service.ts');
  expect(queue.getResult(file, revision)).toBeNull();
  await expect.poll(() => queue.getSnapshot('browser')?.completed).toBe(1);
  expect(
    queue
      .getResult(file, revision)
      ?.findings.some(
        (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/updated',
      ),
  ).toBe(true);
  expect(executions).toBe(2);
  const controller = new AbortController();
  const pending = worker.analyzeDetailed({
    requestId: 'cancel',
    sources: [{ file, start: null, end: null }],
    signal: controller.signal,
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
});
it('fingerprints JSON resolver configuration and malformed dependencies independently of source-evidence hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-preanalysis-config-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(
    join(root, 'src/App.tsx'),
    'import {save} from "@service";export const App=()=> <button onClick={save}/>',
  );
  await writeFile(join(root, 'src/bad.ts'), 'export function save( {');
  await writeFile(
    join(root, 'tsconfig.json'),
    '{"compilerOptions":{"paths":{"@service":["src/bad.ts"]}}}',
  );
  const worker = createWorkerAnalyzer({
    workspaceRoot: root,
    source: { include: ['src/**', 'tsconfig.json'] },
    tsconfig: 'tsconfig.json',
  });
  const result = await worker.analyzeDetailed({
    requestId: 'config',
    sources: [{ file: 'src/App.tsx', start: null, end: null }],
  });
  expect(result.completion).toBe('partial');
  expect(result.dependencyHashes?.['tsconfig.json']).toMatch(/^[a-f0-9]{64}$/);
  expect(result.dependencyHashes?.['src/bad.ts']).toMatch(/^[a-f0-9]{64}$/);
  expect(result.sourceHashes['src/bad.ts']).toBeUndefined();
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'SOURCE_PARSE_ERROR')).toBe(
    true,
  );
});
