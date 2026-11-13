import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding, PageElement, StaticAnalysisResult } from '@devanalyst/core';
import { createPageOrchestrator, type PageOrchestratorOptions } from './preanalysis.js';
const queues: ReturnType<typeof createPageOrchestrator>[] = [];
afterEach(() => {
  queues.splice(0).forEach((queue) => queue.stop());
  vi.useRealTimers();
});
const route = { pathname: '/orders/123', hashPath: null };
function element(n: number, kind: PageElement['kind'] = 'component'): PageElement {
  return {
    elementId: n.toString(16).padStart(64, '0'),
    file: `src/C${n}.tsx`,
    revision: 'a'.repeat(64),
    tag: kind === 'component' ? 'div' : 'button',
    kind,
  };
}
function result(file: string, uncertainty = false): StaticAnalysisResult {
  return {
    requestId: 'test',
    completion: 'complete',
    findings: uncertainty
      ? [
          {
            id: 'test',
            type: 'explanation',
            confidence: 'INFERRED',
            explanation: 'Uncertain',
            evidence: { source: { file, start: null, end: null }, code: 'source' },
            analyzedAt: new Date().toISOString(),
            cacheStatus: 'miss',
            subjectId: 'subject',
            detail: {
              kind: 'call',
              targetId: null,
              expression: 'dynamic()',
              resolution: 'unresolved',
            },
            conditions: [],
            execution: 'not-evaluated',
            traces: [],
          },
        ]
      : [],
    graph: { nodes: [], edges: [] },
    diagnostics: [],
    selectedSubjects: [],
    sourceHashes: { [file]: 'a'.repeat(64), 'src/shared.ts': 'b'.repeat(64) },
    metrics: { files: 2, bytes: 1, astNodes: 1, resolutionAttempts: 1, durationMs: 1 },
  };
}
function setup(overrides: Partial<PageOrchestratorOptions> = {}) {
  vi.useFakeTimers();
  const analyze = vi.fn(async (request) => result(request.sources[0].file));
  const validate = vi.fn(async () => true);
  const queue = createPageOrchestrator({ analyze, validate, ...overrides });
  queues.push(queue);
  return { queue, analyze, validate };
}
async function tick(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms);
}
describe('page analysis queue', () => {
  it('does not publish restored AI as ready until its source validation completes', async () => {
    const target = element(1),
      cached = result(target.file, true);
    const gate: { resolve: (valid: boolean) => void } = {
      resolve: () => {
        throw new Error('Validation has not started');
      },
    };
    const { queue, analyze } = setup({
      validate: () =>
        new Promise<boolean>((resolve) => {
          gate.resolve = resolve;
        }),
      persistence: {
        load: async () => ({ result: cached, explanations: cached.findings }),
        save: async () => undefined,
      },
    });
    queue.index('browser', 'restored', route, [target]);
    await tick();
    expect(queue.getSnapshot('browser')?.items[0]?.aiState).toBe('NOT_ANALYZED');
    expect(queue.getExplanations(target.file, target.revision)).toBeNull();
    gate.resolve(true);
    await tick();
    expect(queue.getSnapshot('browser')?.items[0]).toMatchObject({
      state: 'READY',
      aiState: 'READY',
      cache: 'fresh',
    });
    expect(analyze).not.toHaveBeenCalled();
  });
  it('orders selected, hovered, buttons/links, forms/menus/tabs before visible components; shares module jobs', async () => {
    const { queue, analyze } = setup();
    const elements = [
      element(1),
      element(2, 'form'),
      element(3, 'button'),
      element(4),
      element(5),
      { ...element(3, 'link'), elementId: 'f'.repeat(64) },
    ];
    queue.index('client', 'page', route, elements);
    queue.prioritize('client', 'page', element(4).elementId, 'hovered');
    queue.prioritize('client', 'page', element(5).elementId, 'selected');
    await tick();
    expect(analyze.mock.calls.map(([request]) => request.sources[0].file)).toEqual([
      'src/C5.tsx',
      'src/C4.tsx',
      'src/C3.tsx',
      'src/C2.tsx',
      'src/C1.tsx',
    ]);
    expect(queue.getSnapshot('client')).toMatchObject({ total: 6, completed: 6 });
  });
  it('bounds concurrency, deduplicates across pages and cancels only after the last subscriber leaves', async () => {
    const signals: AbortSignal[] = [];
    const { queue } = setup({
      analyze: (request) =>
        new Promise((resolve) => {
          if (!request.signal) throw new Error('Signal required');
          signals.push(request.signal);
          request.signal.addEventListener('abort', () =>
            resolve({ ...result(request.sources[0]?.file ?? ''), completion: 'cancelled' }),
          );
        }),
    });
    queue.index('a', 'a', route, [element(1), element(2)]);
    queue.index('b', 'b', route, [element(1)]);
    await tick();
    expect(signals).toHaveLength(1);
    queue.remove('a');
    expect(signals[0]?.aborted).toBe(false);
    queue.remove('b');
    expect(signals[0]?.aborted).toBe(true);
    await tick();
    expect(signals).toHaveLength(1);
    expect(queue.getStats().active).toBe(0);
  });
  it('reuses unchanged dependency hashes on repeated navigation, and refreshes edited dependencies', async () => {
    const { queue, analyze, validate } = setup();
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    queue.remove('a');
    queue.index('a', 'two', { pathname: '/orders/456' }, [element(1)]);
    await tick();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(result('src/C1.tsx').sourceHashes, undefined, undefined);
    expect(queue.getSnapshot('a')?.items[0]?.cache).toBe('fresh');
    queue.invalidate('src/shared.ts');
    expect(queue.getResult(element(1).file, element(1).revision)).toBeNull();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('STALE');
    await tick();
    expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('rejects stale root revisions and never accepts late obsolete results', async () => {
    let finish: ((value: StaticAnalysisResult) => void) | undefined;
    const { queue } = setup({
      analyze: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    queue.invalidate(element(1).file);
    finish?.(result(element(1).file));
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('STALE');
    expect(queue.getResult(element(1).file, element(1).revision)).toBeNull();
  });
  it('runs AST before optional source-backed AI, deduplicates AI and preserves deterministic results on provider failure', async () => {
    const order: string[] = [];
    const enrich = vi.fn(async () => {
      order.push('ai');
      throw new Error('Auth unavailable');
    });
    const { queue } = setup({
      analyze: async (request) => {
        order.push('ast');
        return result(request.sources[0]?.file ?? '', true);
      },
      enrich,
    });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(order).toEqual(['ast', 'ai']);
    expect(queue.getSnapshot('a')?.items[0]).toMatchObject({ state: 'READY', aiState: 'FAILED' });
    expect(queue.getResult(element(1).file, element(1).revision)).not.toBeNull();
    queue.prioritize('a', 'one', element(1).elementId, 'hovered');
    await tick();
    expect(enrich).toHaveBeenCalledTimes(1);
  });
  it('skips AI for verified-only AST results and when no provider was supplied', async () => {
    const enrich = vi.fn(async () => []);
    const { queue } = setup({ enrich });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(enrich).not.toHaveBeenCalled();
  });
  it('reports queue saturation and admits a selected uncached element ahead of background work', async () => {
    const { queue, analyze } = setup({ limits: { maxEntries: 1 } });
    queue.index('a', 'one', route, [element(1), element(2)]);
    expect(queue.getSnapshot('a')?.limited).toBe(true);
    queue.prioritize('a', 'one', element(2).elementId, 'selected');
    await tick();
    expect(analyze.mock.calls[0]?.[0].sources[0].file).toBe(element(2).file);
    expect(queue.getStats().entries).toBe(1);
  });
  it('enforces result memory limits without infinite retries', async () => {
    const execute = vi.fn(async (request) => ({
      ...result(request.sources[0]?.file ?? ''),
      diagnostics: [{ code: 'LIMIT', source: null, message: 'x'.repeat(2000) }],
    }));
    const { queue } = setup({ limits: { maxBytes: 1024 }, analyze: execute });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('FAILED');
    expect(queue.getStats().bytes).toBe(0);
    queue.prioritize('a', 'one', element(1).elementId, 'selected');
    await tick();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('aborts timed out work and does not retry it on each hover', async () => {
    const signals: AbortSignal[] = [];
    const execute = vi.fn(
      (request) =>
        new Promise<StaticAnalysisResult>((resolve) => {
          if (!request.signal) throw new Error('Signal required');
          signals.push(request.signal);
          request.signal.addEventListener('abort', () =>
            resolve({ ...result(element(1).file), completion: 'cancelled' }),
          );
        }),
    );
    const { queue } = setup({ limits: { jobTimeoutMs: 100 }, analyze: execute });
    queue.index('a', 'one', route, [element(1)]);
    await tick(200);
    expect(signals[0]?.aborted).toBe(true);
    expect(queue.getSnapshot('a')?.items[0]).toMatchObject({ state: 'FAILED', error: 'CANCELLED' });
    queue.prioritize('a', 'one', element(1).elementId, 'hovered');
    await tick();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('reschedules a rapidly revisited module after the obsolete worker has released its slot', async () => {
    let finish: ((value: StaticAnalysisResult) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<StaticAnalysisResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { queue } = setup({ analyze: execute });
    queue.index('a', 'one', route, [element(1)]);
    await tick(20);
    queue.remove('a');
    queue.index('a', 'two', route, [element(1)]);
    finish?.(result(element(1).file));
    await tick(20);
    expect(execute).toHaveBeenCalledTimes(2);
    finish?.(result(element(1).file));
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('READY');
  });
  it('cancels an AI job on obsolete navigation and discards its late output', async () => {
    let signal: AbortSignal | undefined;
    let finish: ((value: readonly Finding[]) => void) | undefined;
    const { queue } = setup({
      analyze: async (request) => result(request.sources[0]?.file ?? '', true),
      enrich: (_result, currentSignal) =>
        new Promise((resolve) => {
          signal = currentSignal;
          finish = resolve;
        }),
    });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.aiState).toBe('ANALYZING');
    queue.remove('a');
    expect(signal?.aborted).toBe(true);
    finish?.([]);
    await tick();
    expect(queue.getExplanations(element(1).file, element(1).revision)).toBeNull();
    expect(queue.getStats().activeAI).toBe(0);
  });
  it('rejects changed hashes before Claude receives any source context', async () => {
    const validate = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const enrich = vi.fn(async () => []);
    const { queue } = setup({
      analyze: async (request) => result(request.sources[0]?.file ?? '', true),
      validate,
      enrich,
    });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(enrich).not.toHaveBeenCalled();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('STALE');
    expect(queue.getResult(element(1).file, element(1).revision)).toBeNull();
  });
  it('admits a waiting selection when an active entry finishes under a full capacity limit', async () => {
    let finish: ((value: StaticAnalysisResult) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<StaticAnalysisResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { queue } = setup({ limits: { maxEntries: 1 }, analyze: execute });
    queue.index('a', 'one', route, [element(1), element(2)]);
    await tick(20);
    queue.prioritize('a', 'one', element(2).elementId, 'selected');
    finish?.(result(element(1).file));
    await tick(20);
    expect(execute.mock.calls).toHaveLength(2);
    finish?.(result(element(2).file));
    await tick();
    expect(
      queue.getSnapshot('a')?.items.find((item) => item.elementId === element(2).elementId)?.state,
    ).toBe('READY');
  });
  it('does not invalidate a revision already observed before a late watcher notification', async () => {
    const { queue, analyze } = setup();
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    queue.invalidate(element(1).file, true, element(1).revision);
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('READY');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('evicts unused cached bytes to admit the next page without exceeding memory', async () => {
    const { queue } = setup({ limits: { maxBytes: 1024 } });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('READY');
    queue.remove('a');
    queue.index('a', 'two', route, [element(2)]);
    await tick();
    expect(queue.getSnapshot('a')?.items[0]?.state).toBe('READY');
    expect(queue.getStats().bytes).toBeLessThanOrEqual(1024);
  });
  it('labels stale cache reuse while revalidating and never exposes historical facts as current', async () => {
    let finish: ((result: StaticAnalysisResult) => void) | undefined;
    const { queue } = setup({
      persistence: { load: async () => ({ stale: true }), save: async () => undefined },
      analyze: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    queue.index('a', 'one', route, [element(1)]);
    await tick(20);
    expect(queue.getSnapshot('a')?.items[0]).toMatchObject({ state: 'ANALYZING', cache: 'stale' });
    expect(queue.getResult(element(1).file, element(1).revision)).toBeNull();
    finish?.(result(element(1).file));
    await tick();
    expect(queue.getSnapshot('a')?.items[0]).toMatchObject({ state: 'READY', cache: 'miss' });
  });
  it('keeps fresh deterministic results available when cache reads or writes fail', async () => {
    const { queue, analyze } = setup({
      persistence: {
        load: async () => {
          throw new Error('cache unavailable');
        },
        save: async () => {
          throw new Error('cache unavailable');
        },
      },
    });
    queue.index('a', 'one', route, [element(1)]);
    await tick();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot('a')?.items[0]).toMatchObject({
      state: 'READY',
      error: 'CACHE_UNAVAILABLE',
    });
    expect(queue.getResult(element(1).file, element(1).revision)).not.toBeNull();
  });
});
