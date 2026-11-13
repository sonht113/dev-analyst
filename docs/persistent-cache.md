# Persistent analysis cache

`@devanalyst/cache` implements Phase 08 with SQLite in a worker thread. The DevAnalyst identity and React + Vite scope remain unchanged. The Vite plugin automatically persists eligible complete source analysis when `config.cache.enabled` is true, alongside Phase 07's memory cache.

```ts
import { devanalyst } from '@devanalyst/vite-plugin';

const inspector = devanalyst({
  config: {
    source: { include: ['src/**'] },
    cache: {
      enabled: true,
      directory: '.cache/devanalyst',
      maxSizeMb: 256,
    },
  },
});
```

The default file is `.cache/devanalyst/analysis.sqlite` under the configured workspace. Keep custom cache directories ignored by Git and outside Vite public/build output. Cache-directory HTTP requests are denied. `cache.enabled: false` keeps pre-analysis in memory without database writes. Node 22 currently emits SQLite's native experimental-feature warning.

Opening a page after restarting Vite rebuilds current JSX origin manifests and reuses valid persisted analysis. An already open page whose source modules have not been served by the new server generation can require a reload before those origins are accepted. The bridge does not fabricate origins to reuse cache data. Lazy modules are indexed after they commit, as in Phase 07.

## Inspect and clear

The retained plugin instance exposes Node-only controls:

```ts
const summary = await inspector.api.inspectCache();
// Counters, bytes, persistence/diagnostic state and up to 100 key summaries; no source bodies.
await inspector.api.clearCache({ kind: 'translation' });
await inspector.api.clearCache({ scope: 'element' });
await inspector.api.clearCache();
```

Inspection entries/scope summaries and clearing use the current project/source-policy partition; byte counters describe the shared database budget. Clearing affects that partition and invalidates memory results; active pre-analysis can repopulate valid entries. Scope/kind filters are optional. Provider/model-specific removal is also available through standalone `cache.inspect()` and `cache.delete(key)`. There is no unauthenticated cache-control or file-read browser endpoint. CLI cache commands are not added in this phase.

## Standalone Node API

Run from an authorized React + Vite project with `src/App.tsx`:

```ts
import { createHash } from 'node:crypto';
import { configSchema } from '@devanalyst/core';
import { createStaticAnalyzer } from '@devanalyst/analyzer';
import { createWorkspaceAccess } from '@devanalyst/analyzer/workspace';
import { openPersistentCache, cacheFingerprint } from '@devanalyst/cache';

const workspaceRoot = process.cwd();
const config = configSchema.parse({});
const access = await createWorkspaceAccess(workspaceRoot, config.source);
const cache = await openPersistentCache({ workspaceRoot, source: config.source });
const analyzer = createStaticAnalyzer({ workspaceRoot, source: config.source });
const file = 'src/App.tsx';
const revision = createHash('sha256')
  .update(await access.readSource(file))
  .digest('hex');
const identity = {
  scope: 'component' as const,
  kind: 'analysis' as const,
  subject: cacheFingerprint({ file }),
  revision,
  policy: cacheFingerprint({ source: config.source, analyzer: 'react-static-2' }),
  runtime: cacheFingerprint('static-source-only'),
  provider: 'deterministic',
  model: 'typescript-6.0.3',
  schemaVersion: 'react-static-2',
};

try {
  const cached = await cache.get(identity, { allowStale: true });
  const analysis =
    cached.status === 'fresh' && cached.payload.type === 'static'
      ? cached.payload.result
      : await analyzer.analyzeDetailed({
          requestId: 'example',
          sources: [{ file, start: null, end: null }],
        });
  if (cached.status !== 'fresh' && analysis.completion === 'complete') {
    await cache.put({
      identity,
      payload: { type: 'static', result: analysis },
      hashes: analysis.dependencyHashes ?? analysis.sourceHashes,
      missing: analysis.missingDependencies ?? [],
      aliases: analysis.sourceAliases ?? {},
      generation: cached.generation,
    });
  }
  // Use only the fresh analysis above as current source evidence.
} finally {
  await cache.close();
}
```

A caller supplies a deterministic identity for its actual analysis policy. Include resolver options and bump the analysis schema version when behavior changes. `createCacheKey(projectFingerprint, identity, hashes, missing, aliases)` exposes the concrete key/fingerprint construction; it does not authorize source access. Page identities require a route fingerprint and a structural runtime fingerprint. Use fingerprints of relevant non-sensitive context, never props, control values, user questions or raw browser state.

Values are closed unions: `static` contains a detailed AST result; `explanation` contains code findings; `translation` contains only translation findings; `index` contains structural JSX references. Translation identities use `kind: 'translation'` and a target `language`; split translations from code explanations rather than mixing provider outputs. Translation storage does not itself collect UI text or enable Claude.

## Freshness and background revalidation

A fresh hit rechecks every guarded source/config snapshot, unresolved import candidate and canonical source alias. This includes changes made while Vite was stopped. Watcher changes invalidate affected dependencies promptly; add/unlink/config topology changes use conservative project invalidation. Unchanged unrelated entries remain reusable. The provider/model, consent/depth, schema, language and relevant page/runtime identity are also part of cache identity.

`get(identity)` returns a miss for stale/expired data. With `{ allowStale: true }`, historical payloads return `status: 'stale'`, timestamps, stale cache labels and UNKNOWN confidence throughout findings, traces and graph edges. Historical source positions describe old code. Never attach them to a current selection as VERIFIED evidence. The orchestrator reports stale cache state while it queues bounded deterministic revalidation; its current-result API remains unavailable until fresh evidence exists.

Write with the generation returned by lookup. Invalidations/clears in another worker/process can make a later write return `{ stored: false }`, even if an unrelated source changed. Do not blindly retry with a new generation or treat that as a committed durable result. Recheck context before another attempt. A failed cache operation does not require failing the underlying source analysis.

A fresh AI hit does not invoke Claude. Background AI still needs both AI enabled/permitted-path consent and `preanalysis.backgroundAI: true`. Optional `preanalysis.claude.model`/`executable` select the existing guarded provider; changing model alters the AI key. Source policy, no-tools permissions, secret checks and live-authentication limitations remain in force. No additional browser AI request API or translation UI is introduced.

## Privacy, limits and recovery

Only structural indexes and allowed source facts persist. Route pathnames are hashed before storage; list keys, props, form/password values, history state and raw DOM text do not enter the database. Relative source paths/snippets and source-grounded explanation text are local cached data. They are not encrypted. Secret detection is heuristic, so restrict source includes and do not pass private runtime data through standalone APIs. Marked private/password/default-value source contexts and likely credentials are conservatively left uncached.

Default limits are 2,000 entries, 256 MiB logical record bytes, 2 MiB/record, 64 outstanding worker requests, a 15-second worker deadline, 24-hour freshness and seven days of stale history. SQLite's physical database cap is twice the logical byte budget plus 4 MiB of overhead reserve; a rollback journal can temporarily use comparable bounded space. `maxSizeMb` is the logical budget, not an exact total-disk/RSS cap. LRU favors stale entries; worker/queue/full-disk failures fall back to fresh computation. Custom Node options expose TTL, entry count and queue limits.

`inspect().persistent` and `diagnostic` distinguish disk operation from in-memory fallback. Corrupt/foreign/future-version or unsafe-path database contents are preserved, not overwritten. Cache clears in fallback mode clear memory only. For a clean persistent recovery, stop relevant servers and choose a new empty cache directory or quarantine the old database offline. Existing policy partitions are intentionally isolated; using a new source policy does not expose or automatically erase older cached content. Direct database tampering by a trusted local administrator is outside the integrity/checksum boundary.

See [ADR 0010](adr/0010-persistent-analysis-cache.md) and [validation](phase-08-validation.md). Small-fixture latency observations do not establish a whole-application cached-response SLA. Rich inspector explanation/translation/follow-up UI, editor integration and release preparation remain separate work.
