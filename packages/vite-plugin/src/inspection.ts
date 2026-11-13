import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createClaudeCodeProvider, type ClaudeCodeOptions } from '@devanalyst/ai';
import {
  createPageOrchestrator,
  createWorkerAnalyzer,
  type StaticAnalyzerOptions,
} from '@devanalyst/analyzer';
import type { WorkspaceAccess } from '@devanalyst/analyzer/workspace';
import { cacheFingerprint, isSafeCacheContent, type CacheIdentityInput } from '@devanalyst/cache';
import {
  DevAnalystError,
  type ClientEvent,
  type DevAnalystConfig,
  type InspectorItem,
  type InspectorUpdate,
  type Finding,
} from '@devanalyst/core';
import type { createSourceMapping } from './mapping.js';
import type { createViteAnalysisCache } from './cache.js';
import { selectInspection } from './inspection-view.js';
import { glossaryTranslation } from '@devanalyst/inspector/glossary';
type Request = Extract<ClientEvent, { type: 'inspector.request' }>['payload'];
interface Session {
  request: Request;
  controller: AbortController;
  routeKey: string;
}
export function createInspectionService(options: {
  workspaceRoot: string;
  config: DevAnalystConfig;
  analyzer?: Pick<StaticAnalyzerOptions, 'aliases' | 'tsconfig' | 'compilerOptions' | 'limits'>;
  claude?: Pick<ClaudeCodeOptions, 'executable' | 'model'>;
  mapping: ReturnType<typeof createSourceMapping>;
  access: Promise<WorkspaceAccess>;
  orchestrator?: ReturnType<typeof createPageOrchestrator>;
  persistence: ReturnType<typeof createViteAnalysisCache>;
  maxMessageBytes: number;
  send: (client: string, update: InspectorUpdate) => void;
}) {
  const active = new Map<string, Session>();
  let stopped = false;
  const jobs = new Set<Promise<void>>();
  const own = !options.orchestrator;
  const engine =
    options.orchestrator ??
    createPageOrchestrator({
      analyze: createWorkerAnalyzer({
        ...options.analyzer,
        workspaceRoot: options.workspaceRoot,
        source: options.config.source,
      }).analyzeDetailed,
      validate: async (hashes, missing, aliases) => validate(hashes, missing, aliases),
      persistence: options.persistence.hooks,
      limits: { maxEntries: 32, maxPages: 32, concurrency: 1 },
    });
  const provider = options.config.ai.enabled
    ? createClaudeCodeProvider({
        ...options.claude,
        workspaceRoot: options.workspaceRoot,
        source: options.config.source,
        ai: { ...options.config.ai, concurrency: 1 },
      })
    : null;
  const translator = options.config.ai.enabled
    ? createClaudeCodeProvider({
        ...options.claude,
        workspaceRoot: options.workspaceRoot,
        source: options.config.source,
        ai: { ...options.config.ai, concurrency: 1 },
      })
    : null;
  const memories = new Map<string, readonly Finding[]>();
  const policy = cacheFingerprint({
    source: options.config.source,
    ai: options.config.ai,
    model: options.claude?.model ?? 'sonnet',
    version: 'inspector-v1',
    cli: '2.1.323',
  });
  const routeKey = (route: Request['route']) =>
    JSON.stringify([route.pathname, route.hashPath ?? null]);
  async function validate(
    hashes: Readonly<Record<string, string>>,
    missing: readonly string[] = [],
    aliases: Readonly<Record<string, string>> = {},
  ): Promise<boolean> {
    try {
      const access = await options.access;
      for (const [file, hash] of Object.entries(hashes))
        if (
          createHash('sha256')
            .update(await access.readSource(file))
            .digest('hex') !== hash
        )
          return false;
      for (const file of missing)
        if (await access.canonicalSourcePath(resolve(options.workspaceRoot, file))) return false;
      for (const [alias, target] of Object.entries(aliases))
        if ((await access.canonicalSourcePath(resolve(options.workspaceRoot, alias))) !== target)
          return false;
      return true;
    } catch {
      return false;
    }
  }
  function send(
    client: string,
    session: Session,
    lane: InspectorUpdate['lane'],
    state: InspectorUpdate['state'],
    items: InspectorItem[] = [],
    extra: Partial<Pick<InspectorUpdate, 'cache' | 'completion' | 'error' | 'limited'>> = {},
  ): void {
    if (stopped || session.controller.signal.aborted || active.get(client) !== session) return;
    let batch: InspectorItem[] = [];
    let reset = true;
    let limited = extra.limited ?? false;
    const payload = (items: InspectorItem[], reset: boolean): InspectorUpdate => ({
      requestId: session.request.requestId,
      elementId: session.request.element.elementId,
      revision: session.request.element.revision,
      lane,
      state,
      cache: extra.cache ?? 'miss',
      completion: extra.completion ?? 'complete',
      error: extra.error ?? null,
      limited,
      reset,
      items,
      observedAt: new Date().toISOString(),
    });
    const fits = (items: InspectorItem[]) =>
      Buffer.byteLength(JSON.stringify(payload(items, reset))) + 180 <= options.maxMessageBytes;
    for (const original of items.slice(0, 80)) {
      let item = original;
      if (!fits([item])) {
        limited = true;
        item = {
          ...item,
          confidence: 'UNKNOWN',
          evidence: null,
          trace: [],
          title: 'Transport limit',
          description: 'Evidence omitted because the configured message size is too small.',
        };
      }
      if (!fits([item])) continue;
      if (batch.length === 4 || !fits([...batch, item])) {
        options.send(client, payload(batch, reset));
        reset = false;
        batch = [];
      }
      batch.push(item);
    }
    options.send(client, payload(batch, reset));
  }
  function item(finding: Finding, group: InspectorItem['group']): InspectorItem {
    const safe =
      isSafeCacheContent(finding.explanation) &&
      (!finding.evidence || isSafeCacheContent(finding.evidence.code));
    return {
      id: finding.id,
      group,
      title: group === 'translation' ? 'Tiếng Việt' : 'AI explanation · Vietnamese',
      description: safe ? finding.explanation.slice(0, 2000) : 'Private context omitted.',
      confidence:
        safe && finding.confidence !== 'VERIFIED'
          ? finding.confidence
          : safe
            ? 'INFERRED'
            : 'UNKNOWN',
      evidence:
        safe && finding.evidence
          ? { source: finding.evidence.source, code: finding.evidence.code.slice(0, 768) }
          : null,
      trace: [],
      analyzedAt: finding.analyzedAt,
      cacheStatus: finding.cacheStatus,
    };
  }
  async function translation(client: string, session: Session): Promise<void> {
    const request = session.request,
      origin = options.mapping.inspect(request.element),
      literal = origin?.literal;
    if (
      origin?.private ||
      !literal ||
      !request.textDigest ||
      createHash('sha256').update(literal.text).digest('hex') !== request.textDigest ||
      !isSafeCacheContent(literal.evidence.code) ||
      !isSafeCacheContent(literal.text)
    ) {
      send(client, session, 'translation', 'READY', [], {
        error: origin?.private ? 'PRIVATE_CONTEXT' : 'NO_STATIC_TEXT',
        completion: 'partial',
      });
      return;
    }
    const hashes = { [request.element.file]: request.element.revision };
    if (!(await validate(hashes))) {
      send(client, session, 'translation', 'STALE', [], {
        cache: 'stale',
        error: 'SOURCE_CHANGED',
      });
      return;
    }
    const glossary = glossaryTranslation(literal.text),
      identity: CacheIdentityInput = {
        scope: 'element',
        kind: 'translation',
        subject: cacheFingerprint({ site: request.element.elementId, text: request.textDigest }),
        revision: request.element.revision,
        policy,
        runtime: request.textDigest,
        provider: glossary ? 'glossary' : 'claude-code',
        model: glossary ? 'ja-vi-ui-1' : (options.claude?.model ?? 'sonnet'),
        schemaVersion: 'inspector-translation-1',
        language: 'vi',
      };
    const key = cacheFingerprint({ identity, hashes });
    const memory = memories.get(key);
    if (memory) {
      send(
        client,
        session,
        'translation',
        'READY',
        memory.map((finding) => item({ ...finding, cacheStatus: 'fresh' }, 'translation')),
        { cache: 'fresh' },
      );
      return;
    }
    const cache = await options.persistence.store();
    let generation: number | undefined;
    try {
      if (cache) {
        const hit = await cache.get(identity);
        generation = hit.generation;
        if (hit.status === 'fresh' && hit.payload.type === 'translation') {
          send(
            client,
            session,
            'translation',
            'READY',
            hit.payload.findings.map((finding) => item(finding, 'translation')),
            { cache: 'fresh' },
          );
          return;
        }
      }
    } catch (error: unknown) {
      options.persistence.reportFailure(error);
    }
    if (session.controller.signal.aborted) return;
    if (glossary) {
      const finding: Finding = {
        id: randomUUID(),
        type: 'translation',
        confidence: 'INFERRED',
        explanation: glossary,
        evidence: literal.evidence,
        analyzedAt: new Date().toISOString(),
        cacheStatus: 'miss',
      };
      send(client, session, 'translation', 'READY', [item(finding, 'translation')]);
      remember(key, [finding]);
      try {
        if (cache && generation !== undefined)
          await cache.put({
            identity,
            payload: { type: 'translation', findings: [finding] },
            hashes,
            generation,
          });
      } catch (error: unknown) {
        options.persistence.reportFailure(error);
      }
      return;
    }
    if (request.mode !== 'expanded' || !translator) {
      send(client, session, 'translation', 'NOT_ANALYZED', [], {
        error: translator ? 'EXPAND_TO_TRANSLATE' : 'AI_DISABLED',
      });
      return;
    }
    send(client, session, 'translation', 'ANALYZING');
    try {
      const evidence: Finding = {
        id: randomUUID(),
        type: 'translation',
        confidence: 'VERIFIED',
        explanation: 'Literal source UI text; application execution is not evaluated.',
        evidence: literal.evidence,
        analyzedAt: new Date().toISOString(),
        cacheStatus: 'miss',
      };
      const findings = (
        await translator.explain({
          requestId: request.requestId,
          evidence: [evidence],
          sourceHashes: hashes,
          depth: 'shallow',
          uiText: [{ id: 'literal', text: literal.text }],
          question:
            'Translate only the supplied Japanese source literal into Vietnamese; do not infer business behavior.',
          signal: session.controller.signal,
        })
      ).filter((finding) => finding.type === 'translation');
      if (!(await validate(hashes))) {
        send(client, session, 'translation', 'STALE', [], {
          cache: 'stale',
          error: 'SOURCE_CHANGED',
        });
        return;
      }
      remember(key, findings);
      send(
        client,
        session,
        'translation',
        findings.length ? 'READY' : 'FAILED',
        findings.map((finding) => item(finding, 'translation')),
        { error: findings.length ? null : 'AI_INVALID_OUTPUT' },
      );
      try {
        if (cache && generation !== undefined)
          await cache.put({
            identity,
            payload: { type: 'translation', findings: [...findings] },
            hashes,
            generation,
          });
      } catch (error: unknown) {
        options.persistence.reportFailure(error);
      }
    } catch (error: unknown) {
      send(client, session, 'translation', 'FAILED', [], {
        error: error instanceof DevAnalystError ? error.code : 'AI_PROVIDER_UNAVAILABLE',
      });
    }
  }
  function remember(key: string, findings: readonly Finding[]): void {
    if (Buffer.byteLength(JSON.stringify(findings)) > 65536) return;
    while (memories.size >= 16) memories.delete(memories.keys().next().value ?? '');
    memories.set(key, findings);
  }
  async function analysis(client: string, session: Session): Promise<void> {
    const request = session.request,
      site = options.mapping.resolve(request.element);
    if (!site || options.mapping.inspect(request.element)?.private) {
      send(client, session, 'analysis', 'FAILED', [], { error: 'SOURCE_MAPPING_UNAVAILABLE' });
      return;
    }
    let result = engine.getResult(request.element.file, request.element.revision);
    const alreadyCached = Boolean(result);
    const subscriber = 'inspector:' + client;
    if (request.mode === 'expanded') {
      engine.index(subscriber, request.requestId, request.route, [request.element]);
      engine.prioritize(subscriber, request.requestId, request.element.elementId, 'selected');
      if (!result && !engine.getSnapshot(subscriber)) {
        send(client, session, 'analysis', 'FAILED', [], { error: 'INSPECTOR_LIMIT' });
        return;
      }
      send(client, session, 'analysis', 'QUEUED');
      for (
        let attempt = 0;
        !result && attempt < 120 && !session.controller.signal.aborted;
        attempt++
      ) {
        const snapshot = engine.getSnapshot(subscriber);
        if (snapshot?.items[0]?.state === 'FAILED') break;
        const state = snapshot?.items[0]?.state ?? 'QUEUED';
        if (attempt === 1 || state === 'STALE')
          send(client, session, 'analysis', state, [], {
            cache: state === 'STALE' ? 'stale' : 'miss',
          });
        await new Promise<void>((resolve) => {
          const end = () => {
            clearTimeout(timer);
            session.controller.signal.removeEventListener('abort', end);
            resolve();
          };
          const timer = setTimeout(end, 50);
          session.controller.signal.addEventListener('abort', end, { once: true });
        });
        result = engine.getResult(request.element.file, request.element.revision);
      }
    }
    if (!result) {
      send(
        client,
        session,
        'analysis',
        request.mode === 'compact' ? 'NOT_ANALYZED' : 'FAILED',
        [],
        { error: request.mode === 'compact' ? null : 'ANALYSIS_UNAVAILABLE' },
      );
      return;
    }
    if (
      session.controller.signal.aborted ||
      !(await validate(
        result.dependencyHashes ?? result.sourceHashes,
        result.missingDependencies,
        result.sourceAliases,
      ))
    ) {
      send(client, session, 'analysis', 'STALE', [], { cache: 'stale', error: 'SOURCE_CHANGED' });
      return;
    }
    const selected = selectInspection(result, site),
      cache =
        alreadyCached || result.findings.some((finding) => finding.cacheStatus === 'fresh')
          ? 'fresh'
          : 'miss';
    send(
      client,
      session,
      'analysis',
      'READY',
      (request.mode === 'compact' ? selected.items.slice(0, 2) : selected.items).map((item) => ({
        ...item,
        cacheStatus: cache,
      })),
      {
        cache,
        completion: result.completion === 'complete' ? 'complete' : 'partial',
        limited: selected.limited,
        error: result.completion === 'partial' ? 'PARTIAL_ANALYSIS' : null,
      },
    );
    if (request.mode !== 'expanded') return;
    if (!provider) {
      send(client, session, 'ai', 'NOT_ANALYZED', [], { error: 'AI_DISABLED' });
      return;
    }
    const evidence = selected.findings.filter((finding) => finding.evidence !== null).slice(0, 24);
    if (!evidence.length) {
      send(client, session, 'ai', 'NOT_ANALYZED', [], { error: 'NO_SOURCE_EVIDENCE' });
      return;
    }
    const hashes = result.dependencyHashes ?? result.sourceHashes,
      missing = result.missingDependencies ?? [],
      aliases = result.sourceAliases ?? {};
    const identity: CacheIdentityInput = {
      scope: 'element',
      kind: 'analysis',
      subject: request.element.elementId,
      revision: request.element.revision,
      policy,
      runtime: cacheFingerprint('selected-source-only-v1'),
      provider: 'claude-code',
      model: options.claude?.model ?? 'sonnet',
      schemaVersion: 'inspector-analysis-1',
      language: 'vi',
    };
    const key = cacheFingerprint({ identity, hashes, missing, aliases });
    const memory = memories.get(key);
    if (memory) {
      send(
        client,
        session,
        'ai',
        'READY',
        memory.map((finding) => item({ ...finding, cacheStatus: 'fresh' }, 'purpose')),
        { cache: 'fresh' },
      );
      return;
    }
    const store = await options.persistence.store();
    let generation: number | undefined;
    try {
      if (store) {
        const hit = await store.get(identity);
        generation = hit.generation;
        if (hit.status === 'fresh' && hit.payload.type === 'explanation') {
          send(
            client,
            session,
            'ai',
            'READY',
            hit.payload.findings.map((finding) => item(finding, 'purpose')),
            { cache: 'fresh' },
          );
          return;
        }
      }
    } catch (error: unknown) {
      options.persistence.reportFailure(error);
    }
    send(client, session, 'ai', 'ANALYZING');
    try {
      const findings = (
        await provider.explain({
          requestId: request.requestId,
          evidence,
          sourceHashes: result.sourceHashes,
          depth: options.config.ai.depth,
          question:
            'Explain the selected source element only, using the supplied handler/condition/call evidence. Do not claim runtime execution or invent destinations.',
          signal: session.controller.signal,
        })
      ).filter((finding) => finding.type !== 'translation');
      if (!(await validate(hashes, missing, aliases))) {
        send(client, session, 'ai', 'STALE', [], { cache: 'stale', error: 'SOURCE_CHANGED' });
        return;
      }
      if (session.controller.signal.aborted) return;
      remember(key, findings);
      send(
        client,
        session,
        'ai',
        findings.length ? 'READY' : 'FAILED',
        findings.map((finding) => item(finding, 'purpose')),
        { error: findings.length ? null : 'AI_INVALID_OUTPUT' },
      );
      try {
        if (store && generation !== undefined)
          await store.put({
            identity,
            payload: { type: 'explanation', findings: [...findings] },
            hashes,
            missing,
            aliases,
            generation,
          });
      } catch (error: unknown) {
        options.persistence.reportFailure(error);
      }
    } catch (error: unknown) {
      send(client, session, 'ai', 'FAILED', [], {
        error: error instanceof DevAnalystError ? error.code : 'AI_PROVIDER_UNAVAILABLE',
      });
    }
  }
  function cancel(client: string, stale = false): void {
    const session = active.get(client);
    if (!session) return;
    if (stale)
      for (const lane of ['translation', 'analysis', 'ai'] as const)
        send(client, session, lane, 'STALE', [], { cache: 'stale', error: 'SOURCE_CHANGED' });
    session.controller.abort();
    engine.remove('inspector:' + client);
    active.delete(client);
  }
  return {
    request(client: string, request: Request): void {
      cancel(client);
      if (stopped) return;
      const session: Session = {
        request,
        controller: new AbortController(),
        routeKey: routeKey(request.route),
      };
      active.set(client, session);
      if (active.size > 32) {
        send(client, session, 'analysis', 'FAILED', [], { error: 'INSPECTOR_LIMIT' });
        cancel(client);
        return;
      }
      if (!options.mapping.resolve(request.element)) {
        send(client, session, 'analysis', 'FAILED', [], { error: 'SOURCE_MAPPING_UNAVAILABLE' });
        return;
      }
      const deadline = setTimeout(() => cancel(client, true), options.config.ai.timeoutMs + 10000);
      const run = Promise.allSettled([translation(client, session), analysis(client, session)])
        .then((results) => {
          for (let index = 0; index < results.length; index++)
            if (results[index]?.status === 'rejected')
              send(client, session, index === 0 ? 'translation' : 'analysis', 'FAILED', [], {
                error: 'INSPECTOR_UNAVAILABLE',
              });
        })
        .finally(() => {
          clearTimeout(deadline);
          jobs.delete(run);
        });
      jobs.add(run);
    },
    cancel(client: string, requestId?: string) {
      if (!requestId || active.get(client)?.request.requestId === requestId) cancel(client);
    },
    route(client: string, route: Request['route']) {
      if (active.get(client)?.routeKey !== routeKey(route)) cancel(client, true);
    },
    invalidate(file: string) {
      memories.clear();
      for (const client of active.keys()) cancel(client, true);
      if (own) engine.invalidate(file, true);
    },
    async stop() {
      stopped = true;
      for (const client of active.keys()) cancel(client);
      await Promise.allSettled([...jobs]);
      if (own) await engine.stop();
    },
  };
}
