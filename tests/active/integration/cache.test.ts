import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import {
  createPageOrchestrator,
  createWorkerAnalyzer,
  createWorkspaceAccess,
  createStaticAnalyzer,
} from '@devanalyst/analyzer';
import { createClaudeCodeProvider } from '@devanalyst/ai';
import { openPersistentCache, cacheFingerprint } from '@devanalyst/cache';
import { configSchema, type DevAnalystError, type PageElement } from '@devanalyst/core';
import { createViteAnalysisCache } from '../../../packages/vite-plugin/src/cache.js';
import { claudeFixture } from '../helpers/claude-fixture.js';
const roots: string[] = [],
  stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it('restores AST and actual mock-Claude subprocess results across integration lifetimes without reinvoking the provider', async () => {
  const f = await claudeFixture();
  roots.push(f.root);
  const code =
    'function emit(props){return props.onSave()} export const App=(props)=> <button onClick={()=>emit(props)}>Save</button>;';
  await writeFile(join(f.root, f.file), code);
  const config = configSchema.parse({
    ai: { enabled: true, permittedPaths: ['src/**'], timeoutMs: 3000 },
  });
  const access = await createWorkspaceAccess(f.root, config.source);
  const errors: DevAnalystError[] = [];
  let executions = 0;
  function session(model = 'sonnet') {
    const storage = createViteAnalysisCache({
      workspaceRoot: f.root,
      config,
      analyzer: {},
      model,
      enabledAI: true,
      report: (error) => errors.push(error),
    });
    const worker = createWorkerAnalyzer({ workspaceRoot: f.root });
    const provider = createClaudeCodeProvider({ ...f.options, model });
    const queue = createPageOrchestrator({
      analyze: (request) => {
        executions++;
        return worker.analyzeDetailed(request);
      },
      validate: async (hashes) => {
        for (const [file, hash] of Object.entries(hashes))
          if (
            createHash('sha256')
              .update(await access.readSource(file))
              .digest('hex') !== hash
          )
            return false;
        return true;
      },
      persistence: storage.hooks,
      enrich: (result, signal) =>
        provider.explain({
          requestId: result.requestId,
          evidence: result.findings.filter((finding) => finding.evidence !== null).slice(0, 24),
          sourceHashes: result.sourceHashes,
          depth: 'standard',
          signal,
        }),
      onProgress: (client, page) => storage.index(client, page),
    });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await queue.stop();
      await storage.close();
    };
    stops.push(close);
    return { queue, storage, close };
  }
  const element: PageElement = {
    elementId: 'a'.repeat(64),
    file: f.file,
    revision: createHash('sha256').update(code).digest('hex'),
    tag: 'button',
    kind: 'button',
  };
  const first = session();
  first.queue.index('browser', 'one', { pathname: '/orders/private-id' }, [element]);
  await expect
    .poll(() => first.queue.getSnapshot('browser')?.items[0]?.aiState, { timeout: 10000 })
    .toBe('READY');
  expect(executions).toBe(1);
  expect((await f.calls()).filter((call) => call.input)).toHaveLength(1);
  await first.close();
  const second = session();
  second.queue.index('browser', 'two', { pathname: '/orders/another-id' }, [element]);
  await expect
    .poll(() => second.queue.getSnapshot('browser')?.items[0]?.aiState, { timeout: 10000 })
    .toBe('READY');
  expect(second.queue.getSnapshot('browser')?.items[0]?.cache).toBe('fresh');
  expect(executions).toBe(1);
  expect((await f.calls()).filter((call) => call.input)).toHaveLength(1);
  const inspected = await second.storage.inspect();
  expect(inspected?.persistent).toBe(true);
  expect(inspected?.scopes['component']).toBeGreaterThanOrEqual(2);
  expect(second.queue.getExplanations(element.file, element.revision)?.[0]?.confidence).toBe(
    'INFERRED',
  );
  await second.close();
  const changedModel = session('sonnet-next');
  changedModel.queue.index('browser', 'three', { pathname: '/orders/another-id' }, [element]);
  await expect
    .poll(() => changedModel.queue.getSnapshot('browser')?.items[0]?.aiState, { timeout: 10000 })
    .toBe('READY');
  expect(executions).toBe(1);
  expect((await f.calls()).filter((call) => call.input)).toHaveLength(2);
  expect(errors).toEqual([]);
});
it('tracks missing resolver candidates and rejects stale persisted resolution after offline edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-cache-resolution-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  const code = 'import {save} from "./service";export const App=()=> <button onClick={save}/>;';
  await writeFile(join(root, 'src/App.tsx'), code);
  await writeFile(join(root, 'src/service.js'), 'export function save(){return fetch("/old")}');
  const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed({
    requestId: 'resolution',
    sources: [{ file: 'src/App.tsx', start: null, end: null }],
  });
  expect(result.completion).toBe('complete');
  expect(result.missingDependencies).toContain('src/service.ts');
  const cache = await openPersistentCache({ workspaceRoot: root });
  stops.push(cache.close);
  const identity = {
    scope: 'component' as const,
    kind: 'analysis' as const,
    subject: cacheFingerprint('app'),
    revision: result.sourceHashes['src/App.tsx'] ?? '',
    policy: cacheFingerprint('policy'),
    provider: 'deterministic',
    model: 'ts6',
    schemaVersion: '2',
  };
  const previous = await cache.get(identity);
  await cache.put({
    identity,
    payload: { type: 'static', result },
    hashes: result.dependencyHashes ?? result.sourceHashes,
    missing: result.missingDependencies ?? [],
    generation: previous.generation,
  });
  expect((await cache.get(identity)).status).toBe('fresh');
  await cache.close();
  await writeFile(join(root, 'src/service.ts'), 'export function save(){return fetch("/new")}');
  const reopened = await openPersistentCache({ workspaceRoot: root });
  stops.push(reopened.close);
  expect((await reopened.get(identity)).status).toBe('miss');
  const refreshed = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed({
    requestId: 'new',
    sources: [{ file: 'src/App.tsx', start: null, end: null }],
  });
  expect(
    refreshed.findings.some(
      (finding) => finding.detail.kind === 'api' && finding.detail.endpoint === '/new',
    ),
  ).toBe(true);
});
it('keeps the parent event loop responsive during repeated persistent lookups and records local timings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-cache-performance-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  const code = 'export const App=()=> <button/>;';
  await writeFile(join(root, 'src/App.tsx'), code);
  const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed({
    requestId: 'performance',
    sources: [{ file: 'src/App.tsx', start: null, end: null }],
  });
  const cache = await openPersistentCache({ workspaceRoot: root });
  stops.push(cache.close);
  const identity = {
    scope: 'component' as const,
    kind: 'analysis' as const,
    subject: cacheFingerprint('app'),
    revision: result.sourceHashes['src/App.tsx'] ?? '',
    policy: cacheFingerprint('policy'),
    provider: 'deterministic',
    model: 'ts6',
    schemaVersion: '2',
  };
  const miss = await cache.get(identity);
  await cache.put({
    identity,
    payload: { type: 'static', result },
    hashes: result.sourceHashes,
    generation: miss.generation,
  });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1),
    durations: number[] = [];
  try {
    for (let index = 0; index < 20; index++) {
      const started = performance.now();
      expect((await cache.get(identity)).status).toBe('fresh');
      durations.push(performance.now() - started);
    }
  } finally {
    clearInterval(timer);
  }
  expect(ticks).toBeGreaterThan(2);
  await writeFile(
    join(tmpdir(), 'devanalyst-phase08-cache-metrics.json'),
    JSON.stringify(
      { lookups: durations.length, parentTurns: ticks, durationsMs: durations },
      null,
      2,
    ),
  );
});
