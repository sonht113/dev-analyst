import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DevAnalystError,
  pageElementSchema,
  type AnalysisState,
  type Finding,
  type PageElement,
  type PageItemStatus,
  type RoutePayload,
  type StaticAnalysisResult,
  type SourceReference,
} from '@devanalyst/core';
import type { AnalysisRequest } from './index.js';

const limitsSchema = z.strictObject({
  concurrency: z.number().int().min(1).max(2).default(1),
  maxEntries: z.number().int().min(1).max(128).default(64),
  maxPages: z.number().int().min(1).max(128).default(32),
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(32 * 1024 * 1024)
    .default(16 * 1024 * 1024),
  jobTimeoutMs: z.number().int().min(100).max(300000).default(90000),
});
export interface PageAnalysisSnapshot {
  readonly requestId: string;
  readonly route: RoutePayload;
  readonly items: readonly (PageElement & PageItemStatus)[];
  readonly components: readonly { readonly name: string; readonly source: SourceReference }[];
  readonly files: readonly string[];
  readonly total: number;
  readonly completed: number;
  readonly limited: boolean;
}
export interface PageOrchestratorOptions {
  readonly limits?: z.input<typeof limitsSchema>;
  readonly analyze: (request: AnalysisRequest) => Promise<StaticAnalysisResult>;
  /** Guarded current hashes, including all dependencies. Called before accepting/reusing results. */
  readonly validate: (
    hashes: Readonly<Record<string, string>>,
    missing?: readonly string[],
    aliases?: Readonly<Record<string, string>>,
  ) => Promise<boolean>;
  /** Composition supplies the opt-in Claude provider; absent by default. No DOM text is passed. */
  readonly enrich?: (
    result: StaticAnalysisResult,
    signal: AbortSignal,
  ) => Promise<readonly Finding[]>;
  readonly persistence?: {
    load(
      element: PageElement,
      page: PageAnalysisSnapshot,
      signal: AbortSignal,
    ): Promise<
      { result: StaticAnalysisResult; explanations?: readonly Finding[] } | { stale: true } | null
    >;
    save(
      element: PageElement,
      result: StaticAnalysisResult,
      explanations: readonly Finding[] | undefined,
      signal: AbortSignal,
    ): Promise<void>;
  };
  readonly onProgress?: (clientId: string, snapshot: PageAnalysisSnapshot) => void;
}
interface Entry {
  key: string;
  generation: number;
  file: string;
  revision: string;
  state: AnalysisState;
  aiState: AnalysisState;
  cache: PageItemStatus['cache'];
  error: string | null;
  result?: StaticAnalysisResult;
  explanations?: readonly Finding[];
  bytes: number;
  order: number;
  used: number;
  stage: 'static' | 'ai' | null;
  controller?: AbortController;
}
interface Page {
  id: string;
  route: RoutePayload;
  elements: Map<string, PageElement>;
  boosts: Map<string, number>;
  limited: boolean;
}
const weights: Record<PageElement['kind'], number> = {
  button: 70,
  link: 70,
  form: 60,
  menu: 60,
  tab: 60,
  component: 10,
};
const keyOf = (element: PageElement) => `${element.file}:${element.revision}`;
/** Bounded shared-module queue. Runtime visibility is metadata, never evidence of execution. */
export function createPageOrchestrator(options: PageOrchestratorOptions) {
  const limits = limitsSchema.parse(options.limits ?? {});
  const pages = new Map<string, Page>();
  const entries = new Map<string, Entry>();
  const priorities = new Map<string, number>();
  const jobs = new Set<Promise<void>>();
  let clock = 0,
    active = 0,
    activeAI = 0,
    stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notifications = new Set<string>();
  let notifyTimer: ReturnType<typeof setTimeout> | undefined;

  function snapshot(client: string): PageAnalysisSnapshot | null {
    const page = pages.get(client);
    if (!page) return null;
    const items = [...page.elements.values()].map((element) => {
      const entry = entries.get(keyOf(element));
      return {
        ...element,
        state: entry?.state ?? 'NOT_ANALYZED',
        aiState: entry?.aiState ?? 'NOT_ANALYZED',
        cache: entry?.cache ?? 'miss',
        error: entry?.error ?? null,
      } satisfies PageElement & PageItemStatus;
    });
    const components = new Map<string, { name: string; source: SourceReference }>();
    const files = new Set<string>();
    const processed = new Set<string>();
    for (const item of items) {
      if (processed.has(keyOf(item))) continue;
      processed.add(keyOf(item));
      files.add(item.file);
      const result = entries.get(keyOf(item))?.result;
      if (item.state !== 'READY' || !result) continue;
      for (const file of Object.keys(result.dependencyHashes ?? result.sourceHashes))
        if (files.size < 512) files.add(file);
      for (const node of result.graph.nodes)
        if (node.kind === 'component' && node.source && components.size < 128)
          components.set(node.id, { name: node.name, source: node.source });
    }
    return {
      requestId: page.id,
      route: { ...page.route },
      items,
      components: structuredClone([...components.values()]),
      files: [...files],
      total: items.length,
      completed: items.filter((item) => item.state === 'READY' || item.state === 'FAILED').length,
      limited: page.limited,
    };
  }
  function notify(): void {
    if (stopped) return;
    for (const client of pages.keys()) notifications.add(client);
    notifyTimer ??= setTimeout(() => {
      notifyTimer = undefined;
      for (const client of notifications) {
        const value = snapshot(client);
        if (value) {
          try {
            options.onProgress?.(client, value);
          } catch {
            const page = pages.get(client);
            if (page) page.limited = true;
          }
        }
      }
      notifications.clear();
    }, 30);
  }
  function rebuildPriorities(): void {
    priorities.clear();
    for (const page of pages.values())
      for (const element of page.elements.values()) {
        const key = keyOf(element);
        priorities.set(
          key,
          Math.max(
            priorities.get(key) ?? -1,
            weights[element.kind],
            page.boosts.get(element.elementId) ?? 0,
          ),
        );
      }
  }
  function priority(entry: Entry): number {
    return priorities.get(entry.key) ?? -1;
  }
  function cancelUnused(): void {
    rebuildPriorities();
    for (const entry of entries.values())
      if (priority(entry) < 0) {
        entry.controller?.abort();
        entry.stage = null;
        if (!entry.result) entry.state = 'NOT_ANALYZED';
        if (entry.aiState === 'QUEUED' || entry.aiState === 'ANALYZING')
          entry.aiState = 'NOT_ANALYZED';
      }
  }
  function schedule(): void {
    if (!stopped)
      timer ??= setTimeout(() => {
        timer = undefined;
        pump();
      }, 10);
  }
  function totalBytes(): number {
    return [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  }
  function evict(required = 0, incomingBytes = 0): boolean {
    const unused = [...entries.values()]
      .filter((entry) => !entry.controller && priority(entry) < 0)
      .sort((a, b) => a.used - b.used);
    while (
      (entries.size + required > limits.maxEntries ||
        totalBytes() + incomingBytes > limits.maxBytes) &&
      unused.length
    ) {
      const entry = unused.shift();
      if (entry) entries.delete(entry.key);
    }
    return (
      entries.size + required <= limits.maxEntries &&
      totalBytes() + incomingBytes <= limits.maxBytes
    );
  }
  function admit(element: PageElement, urgent = false): Entry | undefined {
    const key = keyOf(element);
    let entry = entries.get(key);
    if (!entry) {
      if (!evict(1)) {
        if (!urgent) return;
        const victim = [...entries.values()]
          .filter(
            (candidate) =>
              !candidate.controller && priority(candidate) < (priorities.get(key) ?? 90),
          )
          .sort((a, b) => priority(a) - priority(b) || a.used - b.used)[0];
        if (!victim) return;
        entries.delete(victim.key);
      }
      entry = {
        key,
        generation: 0,
        file: element.file,
        revision: element.revision,
        state: 'QUEUED',
        aiState: 'NOT_ANALYZED',
        cache: 'miss',
        error: null,
        bytes: 0,
        order: ++clock,
        used: clock,
        stage: 'static',
      };
      entries.set(key, entry);
    } else {
      entry.used = ++clock;
      if (entry.controller?.signal.aborted && entry.state !== 'STALE') {
        entry.stage = 'static';
        entry.state = 'QUEUED';
      }
      if (
        !entry.controller &&
        entry.stage === null &&
        entry.state !== 'FAILED' &&
        entry.state !== 'STALE'
      ) {
        entry.stage = 'static'; // Even a cache hit must recheck all guarded dependency hashes.
        entry.state = 'QUEUED';
      }
    }
    return entry;
  }
  function pump(): void {
    if (stopped) return;
    // Keep urgent uncached sites in the bounded page index until an active slot/entry can yield.
    const waiting = [...pages.values()]
      .flatMap((page) => [...page.elements.values()])
      .filter(
        (element) => !entries.has(keyOf(element)) && (priorities.get(keyOf(element)) ?? 0) >= 90,
      )
      .sort((a, b) => (priorities.get(keyOf(b)) ?? 0) - (priorities.get(keyOf(a)) ?? 0));
    for (const element of waiting) admit(element, true);
    const queued = [...entries.values()]
      .filter((entry) => entry.stage && !entry.controller && priority(entry) >= 0)
      .sort((a, b) => priority(b) - priority(a) || a.order - b.order);
    for (const entry of queued) {
      const ai = entry.stage === 'ai';
      if (ai ? activeAI >= 1 : active >= limits.concurrency) continue;
      if (ai) activeAI++;
      else active++;
      const job = run(entry, ai);
      jobs.add(job);
      const settled = () => {
        jobs.delete(job);
        if (ai) activeAI--;
        else active--;
        schedule();
      };
      void job.then(settled, settled);
    }
  }
  function markStale(entry: Entry): void {
    delete entry.result;
    delete entry.explanations;
    entry.bytes = 0;
    entry.state = 'STALE';
    entry.cache = 'stale';
    entry.aiState = 'STALE';
    entry.error = 'SOURCE_CHANGED';
  }
  function isStaticQueued(entry: Entry): boolean {
    return entry.stage === 'static';
  }
  async function run(entry: Entry, ai: boolean): Promise<void> {
    let cacheFailed = false;
    const controller = new AbortController();
    entry.controller = controller;
    entry.stage = null;
    const startedEpoch = entry.generation;
    const subscriber = [...pages].find(([, page]) =>
      [...page.elements.values()].some((element) => keyOf(element) === entry.key),
    );
    const element = subscriber
      ? [...subscriber[1].elements.values()].find((element) => keyOf(element) === entry.key)
      : undefined;
    const deadline = setTimeout(() => controller.abort(), limits.jobTimeoutMs);
    const current = () =>
      !stopped &&
      !controller.signal.aborted &&
      startedEpoch === entry.generation &&
      priority(entry) >= 0;
    try {
      if (ai) {
        entry.aiState = 'ANALYZING';
        notify();
        const result = entry.result;
        if (result && options.enrich) {
          if (
            !(await options.validate(
              result.dependencyHashes ?? result.sourceHashes,
              result.missingDependencies,
              result.sourceAliases,
            ))
          ) {
            markStale(entry);
            return;
          }
          if (!current()) return;
          const explanations = await options.enrich(result, controller.signal);
          if (!current()) return;
          if (
            !(await options.validate(
              result.dependencyHashes ?? result.sourceHashes,
              result.missingDependencies,
              result.sourceAliases,
            ))
          ) {
            if (current()) markStale(entry);
            return;
          }
          if (!current()) return;
          const bytes = Buffer.byteLength(JSON.stringify(explanations));
          if (bytes > 256 * 1024 || !evict(0, bytes)) throw new Error('Result limit');
          entry.explanations = explanations;
          entry.bytes += bytes;
          entry.aiState = 'READY';
          if (element)
            await options.persistence
              ?.save(element, result, explanations, controller.signal)
              .catch(() => {
                cacheFailed = true;
              });
        }
      } else {
        if (!entry.result && options.persistence && subscriber && element) {
          const page = snapshot(subscriber[0]);
          if (page) {
            const restored = await options.persistence
              .load(element, page, controller.signal)
              .catch(() => {
                cacheFailed = true;
                return null;
              });
            if (!current()) return;
            if (restored && 'stale' in restored) {
              entry.cache = 'stale';
              entry.state = 'STALE';
              notify();
            } else if (restored && restored.result.sourceHashes[entry.file] === entry.revision) {
              const bytes = Buffer.byteLength(JSON.stringify(restored));
              if (bytes <= 2 * 1024 * 1024 + 256 * 1024 && evict(0, bytes)) {
                entry.result = restored.result;
                entry.bytes = bytes;
                if (restored.explanations) {
                  entry.explanations = restored.explanations;
                }
              }
            }
          }
        }
        const cached = entry.result;
        if (
          cached &&
          (await options.validate(
            cached.dependencyHashes ?? cached.sourceHashes,
            cached.missingDependencies,
            cached.sourceAliases,
          ))
        ) {
          if (!current()) return;
          entry.cache = 'fresh';
          entry.state = 'READY';
          if (entry.explanations) entry.aiState = 'READY';
        } else {
          if (!current()) return;
          delete entry.result;
          delete entry.explanations;
          entry.bytes = 0;
          entry.state = 'ANALYZING';
          entry.cache = entry.cache === 'stale' ? 'stale' : 'miss';
          entry.error = null;
          entry.aiState = 'NOT_ANALYZED';
          notify();
          const result = await options.analyze({
            requestId: randomUUID(),
            sources: [{ file: entry.file, start: null, end: null }],
            signal: controller.signal,
          });
          if (!current()) return;
          if (
            result.completion === 'cancelled' ||
            result.sourceHashes[entry.file] !== entry.revision ||
            !(await options.validate(
              result.dependencyHashes ?? result.sourceHashes,
              result.missingDependencies,
              result.sourceAliases,
            ))
          ) {
            entry.state = 'STALE';
            entry.cache = 'stale';
            entry.error = 'SOURCE_CHANGED';
            return;
          }
          if (!current()) return;
          const bytes = Buffer.byteLength(JSON.stringify(result));
          if (bytes > 2 * 1024 * 1024 || !evict(0, bytes)) throw new Error('Result limit');
          entry.result = result;
          entry.cache = 'miss';
          entry.bytes = bytes;
          entry.state = 'READY';
          entry.error = result.completion === 'partial' ? 'PARTIAL_ANALYSIS' : null;
          notify();
          if (element)
            await options.persistence
              ?.save(element, result, undefined, controller.signal)
              .catch(() => {
                cacheFailed = true;
              });
          if (!current()) return;
        }
        // Only source-backed uncertainty needs Claude. A hover cannot force an AI invocation.
        if (
          options.enrich &&
          entry.result?.findings.some(
            (finding) => finding.confidence !== 'VERIFIED' && finding.evidence !== null,
          ) &&
          entry.aiState === 'NOT_ANALYZED'
        ) {
          entry.aiState = 'QUEUED';
          entry.stage = 'ai';
        }
      }
    } catch (error: unknown) {
      if (current()) {
        if (ai) entry.aiState = 'FAILED';
        else entry.state = 'FAILED';
        entry.error = error instanceof DevAnalystError ? error.code : 'ANALYSIS_FAILED';
      }
    } finally {
      clearTimeout(deadline);
      if (entry.controller === controller) delete entry.controller;
      if (
        controller.signal.aborted &&
        startedEpoch === entry.generation &&
        !stopped &&
        !isStaticQueued(entry)
      ) {
        if (priority(entry) >= 0) {
          if (ai) entry.aiState = 'FAILED';
          else entry.state = 'FAILED';
          entry.error = 'CANCELLED';
        }
      }
      if (cacheFailed && entry.state === 'READY') entry.error ??= 'CACHE_UNAVAILABLE';
      evict();
      notify();
    }
  }
  return {
    index(
      client: string,
      requestId: string,
      route: RoutePayload,
      elements: readonly PageElement[],
      limited = false,
      urgent: 'hovered' | 'selected' | null = null,
    ): void {
      if (stopped) return;
      let page = pages.get(client);
      if (!page || page.id !== requestId) {
        if (!page && pages.size >= limits.maxPages) return;
        page = {
          id: requestId,
          route: { ...route },
          elements: new Map(),
          boosts: new Map(),
          limited,
        };
        pages.set(client, page);
        cancelUnused();
      }
      page.limited ||= limited;
      if (urgent)
        for (const [id, boost] of page.boosts)
          if (boost === (urgent === 'selected' ? 100 : 90)) page.boosts.delete(id);
      for (const input of elements) {
        const element = pageElementSchema.parse(input);
        if (!page.elements.has(element.elementId) && page.elements.size >= 128) {
          page.limited = true;
          const victim = urgent
            ? [...page.elements.values()]
                .filter(
                  (item) =>
                    (page.boosts.get(item.elementId) ?? weights[item.kind]) <
                    (urgent === 'selected' ? 100 : 90),
                )
                .sort(
                  (a, b) =>
                    (page.boosts.get(a.elementId) ?? weights[a.kind]) -
                    (page.boosts.get(b.elementId) ?? weights[b.kind]),
                )[0]
            : undefined;
          if (!victim) continue;
          page.elements.delete(victim.elementId);
          page.boosts.delete(victim.elementId);
        }
        if (urgent) page.boosts.set(element.elementId, urgent === 'selected' ? 100 : 90);
        page.elements.set(element.elementId, element);
        rebuildPriorities();
        if (!admit(element, urgent !== null)) page.limited = true;
      }
      cancelUnused();
      schedule();
      notify();
    },
    prioritize(
      client: string,
      requestId: string,
      elementId: string,
      priority: 'hovered' | 'selected',
    ): void {
      const page = pages.get(client);
      if (!page || page.id !== requestId || !page.elements.has(elementId)) return;
      // Only the current hovered/selected targets retain an interaction boost.
      const value = priority === 'selected' ? 100 : 90;
      for (const [id, boost] of page.boosts) if (boost === value) page.boosts.delete(id);
      page.boosts.set(elementId, value);
      rebuildPriorities();
      const element = page.elements.get(elementId);
      if (element) admit(element, true);
      schedule();
      notify();
    },
    remove(client: string): void {
      pages.delete(client);
      cancelUnused();
      notify();
    },
    invalidate(file: string, topologyChanged = false, observedRevision?: string): void {
      for (const entry of entries.values()) {
        // A watcher can deliver a save after Vite has already transformed/analyzed that revision.
        if (
          observedRevision &&
          ((entry.file === file && entry.revision === observedRevision) ||
            (!topologyChanged &&
              (entry.result?.dependencyHashes ?? entry.result?.sourceHashes)?.[file] ===
                observedRevision))
        )
          continue;
        const affected =
          topologyChanged ||
          entry.file === file ||
          (entry.result?.dependencyHashes ?? entry.result?.sourceHashes)?.[file] !== undefined ||
          entry.result?.sourceAliases?.[file] !== undefined ||
          entry.result?.missingDependencies?.includes(file) === true;
        if (affected || entry.controller) {
          entry.generation++;
          entry.controller?.abort();
          delete entry.result;
          delete entry.explanations;
          entry.bytes = 0;
          entry.state = 'STALE';
          entry.cache = 'stale';
          entry.aiState = 'NOT_ANALYZED';
          entry.error = 'SOURCE_CHANGED';
          // A dependency edit can reuse current root metadata; a root edit needs a fresh mapping revision.
          entry.stage = entry.file !== file && priority(entry) >= 0 ? 'static' : null;
        }
      }
      schedule();
      notify();
    },
    getSnapshot: snapshot,
    /** Results stay Node-side; stale results are never returned as current findings. */
    getResult(file: string, revision: string): StaticAnalysisResult | null {
      const entry = entries.get(`${file}:${revision}`);
      return entry?.state === 'READY' && entry.result
        ? structuredClone({
            ...entry.result,
            findings: entry.result.findings.map((finding) => ({
              ...finding,
              cacheStatus: entry.cache === 'fresh' ? ('fresh' as const) : ('miss' as const),
            })),
          })
        : null;
    },
    getExplanations(file: string, revision: string): readonly Finding[] | null {
      const entry = entries.get(`${file}:${revision}`);
      return entry?.state === 'READY' && entry.aiState === 'READY' && entry.explanations
        ? structuredClone(entry.explanations)
        : null;
    },
    getStats: () => ({ entries: entries.size, bytes: totalBytes(), active, activeAI }),
    async stop(): Promise<void> {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(notifyTimer);
      for (const entry of entries.values()) entry.controller?.abort();
      pages.clear();
      entries.clear();
      notifications.clear();
      await Promise.allSettled([...jobs]);
    },
  };
}
