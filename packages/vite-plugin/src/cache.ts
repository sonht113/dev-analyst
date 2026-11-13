import {
  cacheFingerprint,
  openPersistentCache,
  type CacheIdentityInput,
  type CacheInspection,
  type CacheIdentity,
  type CachePayload,
} from '@devanalyst/cache';
import {
  DevAnalystError,
  type DevAnalystConfig,
  type PageElement,
  type StaticAnalysisResult,
} from '@devanalyst/core';
import type {
  PageAnalysisSnapshot,
  PageOrchestratorOptions,
  StaticAnalyzerOptions,
} from '@devanalyst/analyzer';

/** Node-only composition: persisted context contains fingerprints and source facts, never browser text/values. */
export function createViteAnalysisCache(options: {
  workspaceRoot: string;
  config: DevAnalystConfig;
  analyzer: ViteAnalyzerOptions;
  model: string;
  enabledAI: boolean;
  report: (error: DevAnalystError) => void;
}) {
  const staticPolicy = cacheFingerprint({
    source: options.config.source,
    analyzer: options.analyzer,
    version: 'react-static-2',
  });
  const aiPolicy = cacheFingerprint({
    staticPolicy,
    ai: options.config.ai,
    background: options.enabledAI,
    model: options.model,
    cli: '2.1.323',
    version: 'claude-context-1',
  });
  const runtime = cacheFingerprint('static-source-only-not-runtime-execution');
  const known = new Map<
    string,
    {
      hashes: Readonly<Record<string, string>>;
      missing: readonly string[];
      aliases: Readonly<Record<string, string>>;
      target: string;
      bytes: number;
    }
  >();
  const stamps = new Map<string, string>();
  const pendingPages = new Map<string, PageAnalysisSnapshot>();
  let timer: ReturnType<typeof setTimeout> | undefined,
    flush: Promise<void> = Promise.resolve(),
    closed = false,
    closing = false,
    flushing = false,
    lastError: string | null = null;
  let enabled = options.config.cache.enabled;
  function report(error: unknown): void {
    const code = error instanceof DevAnalystError ? error.code : 'CACHE_UNAVAILABLE';
    if (lastError !== code) {
      lastError = code;
      options.report(
        new DevAnalystError(
          code,
          'Persistent cache could not reuse or store this context. Inspect cache diagnostics; fresh analysis remains available.',
        ),
      );
    }
  }
  const opening = enabled
    ? openPersistentCache({
        workspaceRoot: options.workspaceRoot,
        source: options.config.source,
        directory: options.config.cache.directory,
        maxBytes: options.config.cache.maxSizeMb * 1024 * 1024,
      })
        .then((cache) => {
          if (cache.initialInspection.diagnostic)
            report(
              new DevAnalystError(
                cache.initialInspection.diagnostic,
                'Persistence is disabled for an invalid cache database.',
              ),
            );
          return cache;
        })
        .catch((error: unknown) => {
          report(error);
          enabled = false;
          return null;
        })
    : Promise.resolve(null);
  function component(
    element: Pick<PageElement, 'file' | 'revision'>,
    ai = false,
  ): CacheIdentityInput {
    return {
      scope: 'component',
      kind: 'analysis',
      subject: cacheFingerprint({ file: element.file }),
      revision: element.revision,
      policy: ai ? aiPolicy : staticPolicy,
      runtime,
      provider: ai ? 'claude-code' : 'deterministic',
      model: ai ? options.model : 'typescript-6.0.3',
      schemaVersion: ai ? 'claude-analysis-1' : 'react-static-2',
      language: ai ? 'vi' : null,
    };
  }
  function elementIdentity(element: PageElement): CacheIdentityInput {
    return {
      ...component(element),
      scope: 'element',
      subject: element.elementId,
      runtime: cacheFingerprint({ site: element.elementId, tag: element.tag, kind: element.kind }),
    };
  }
  function pageIdentity(page: PageAnalysisSnapshot): CacheIdentityInput {
    const route = cacheFingerprint({
      pathname: page.route.pathname,
      hashPath: page.route.hashPath ?? null,
    });
    return {
      ...component({ file: 'page', revision: cacheFingerprint('page-index-v1') }),
      scope: 'page',
      subject: route,
      route,
      runtime: cacheFingerprint(
        page.items
          .map(({ elementId, revision }) => ({ elementId, revision }))
          .sort((a, b) => a.elementId.localeCompare(b.elementId)),
      ),
    };
  }
  const keyOf = (element: Pick<PageElement, 'file' | 'revision'>) =>
    `${element.file}:${element.revision}`;
  function remember(
    element: Pick<PageElement, 'file' | 'revision'>,
    result: StaticAnalysisResult,
    target: string,
  ): void {
    const hashes = result.dependencyHashes ?? result.sourceHashes,
      missing = result.missingDependencies ?? [],
      aliases = result.sourceAliases ?? {};
    const bytes = Buffer.byteLength(JSON.stringify({ hashes, missing, aliases }));
    if (bytes > 256 * 1024) return;
    known.delete(keyOf(element));
    while (
      known.size >= 64 ||
      [...known.values()].reduce((sum, item) => sum + item.bytes, 0) + bytes > 4 * 1024 * 1024
    )
      known.delete(known.keys().next().value ?? '');
    known.set(keyOf(element), { hashes, missing, aliases, target, bytes });
  }
  async function write(
    identity: CacheIdentityInput,
    payload: CachePayload,
    result: {
      hashes: Readonly<Record<string, string>>;
      missing: readonly string[];
      aliases?: Readonly<Record<string, string>>;
    },
  ): Promise<string | null> {
    const cache = await opening;
    if (!cache || closed) return null;
    const previous = await cache.get(identity);
    const stored = await cache.put({
      identity,
      payload,
      hashes: result.hashes,
      missing: [...result.missing],
      aliases: result.aliases ?? {},
      generation: previous.generation,
    });
    return stored.stored ? stored.key : null;
  }
  const hooks: NonNullable<PageOrchestratorOptions['persistence']> = {
    async load(element, page, signal) {
      try {
        const cache = await opening;
        if (!cache || closed || signal.aborted) return null;
        // Index layers validate their own full fingerprints; module facts stay route independent.
        await cache.get(pageIdentity(page));
        await cache.get(elementIdentity(element));
        const hit = await cache.get(component(element), { allowStale: true });
        if (hit.status === 'stale' && !signal.aborted) return { stale: true };
        if (signal.aborted || hit.status !== 'fresh' || hit.payload.type !== 'static') return null;
        remember(element, hit.payload.result, hit.key);
        if (options.enabledAI) {
          const ai = await cache.get(component(element, true));
          if (!signal.aborted && ai.status === 'fresh' && ai.payload.type === 'explanation')
            return { result: hit.payload.result, explanations: ai.payload.findings };
        }
        return { result: hit.payload.result };
      } catch (error: unknown) {
        report(error);
        return null;
      }
    },
    async save(element, result, explanations, signal) {
      if (signal.aborted || result.completion !== 'complete' || closed) return;
      try {
        const hashes = result.dependencyHashes ?? result.sourceHashes,
          missing = result.missingDependencies ?? [],
          aliases = result.sourceAliases ?? {};
        const target = await write(
          component(element),
          { type: 'static', result: { ...result, requestId: 'cached-static' } },
          { hashes, missing, aliases },
        );
        if (target) remember(element, result, target);
        if (explanations && options.enabledAI)
          await write(
            component(element, true),
            { type: 'explanation', findings: [...explanations] },
            { hashes, missing, aliases },
          );
      } catch (error: unknown) {
        report(error);
      }
    },
  };
  async function persistPage(page: PageAnalysisSnapshot): Promise<void> {
    const entries: Extract<CachePayload, { type: 'index' }>['entries'] = [];
    const hashes: Record<string, string> = {},
      aliases: Record<string, string> = {},
      missing = new Set<string>();
    for (const item of page.items) {
      if (item.state !== 'READY') continue;
      const cached = known.get(keyOf(item));
      if (!cached) continue;
      const deps = cached.hashes;
      const metadata = {
        elementId: item.elementId,
        file: item.file,
        revision: item.revision,
        tag: item.tag,
        kind: item.kind,
        target: cached.target,
      };
      const identity = elementIdentity(item),
        stamp = cacheFingerprint({
          metadata,
          deps,
          missing: cached.missing,
          aliases: cached.aliases,
        });
      if (stamps.get(item.elementId) !== stamp) {
        if (
          await write(
            identity,
            { type: 'index', entries: [metadata] },
            { hashes: deps, missing: cached.missing },
          )
        ) {
          if (stamps.size >= 512) stamps.clear();
          stamps.set(item.elementId, stamp);
        }
      }
      entries.push(metadata);
      Object.assign(hashes, deps);
      for (const file of cached.missing) missing.add(file);
      Object.assign(aliases, cached.aliases);
    }
    if (!entries.length || Object.keys(hashes).length > 128 || missing.size > 4096) return;
    const identity = pageIdentity(page),
      stamp = cacheFingerprint({ entries, hashes, missing: [...missing], aliases });
    const key = cacheFingerprint(identity);
    if (
      stamps.get(key) !== stamp &&
      (await write(
        identity,
        { type: 'index', entries },
        { hashes, missing: [...missing], aliases },
      ))
    ) {
      if (stamps.size >= 512) stamps.clear();
      stamps.set(key, stamp);
    }
  }
  function queueFlush(): void {
    if (flushing || closing || closed) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      const pages = [...pendingPages.values()];
      pendingPages.clear();
      flushing = true;
      flush = (async () => {
        for (const page of pages) {
          if (closed) return;
          try {
            await persistPage(page);
          } catch (error: unknown) {
            report(error);
          }
        }
      })().finally(() => {
        flushing = false;
        if (pendingPages.size) queueFlush();
      });
    }, 200);
  }
  return {
    hooks,
    reportFailure: report,
    store: () => opening,
    index(client: string, page: PageAnalysisSnapshot): void {
      if (!enabled || closed || closing) return;
      if (pendingPages.size >= 32 && !pendingPages.has(client)) return;
      pendingPages.set(client, page);
      queueFlush();
    },
    async invalidate(file: string, revision: string | null, topology: boolean): Promise<void> {
      stamps.clear();
      try {
        await (await opening)?.invalidateSource(file, revision, topology);
      } catch (error: unknown) {
        report(error);
      }
    },
    async inspect(): Promise<CacheInspection | null> {
      try {
        return (await (await opening)?.inspect()) ?? null;
      } catch (error: unknown) {
        report(error);
        return null;
      }
    },
    async clear(
      filter: { scope?: CacheIdentity['scope']; kind?: CacheIdentity['kind'] } = {},
    ): Promise<number> {
      stamps.clear();
      known.clear();
      pendingPages.clear();
      await flush;
      return (await (await opening)?.clear(filter)) ?? 0;
    },
    async close(): Promise<void> {
      closing = true;
      clearTimeout(timer);
      timer = undefined;
      await flush;
      for (const page of pendingPages.values()) {
        try {
          await persistPage(page);
        } catch (error: unknown) {
          report(error);
        }
      }
      pendingPages.clear();
      closed = true;
      await (await opening)?.close();
    },
  };
}
type ViteAnalyzerOptions = Pick<
  StaticAnalyzerOptions,
  'aliases' | 'tsconfig' | 'compilerOptions' | 'limits'
>;
