# ADR 0010: Worker-owned SQLite analysis cache

- Status: Accepted for owner-authorized Phase 08
- Date: 2026-11-13

## Context

Phase 07 supplies progressive source analysis and per-server memory reuse. Phase 08 adds restart-safe persistence without changing the DevAnalyst identity, React + Vite scope, source evidence rules or AI consent. The prompt's historical `@devlens/cache` name maps to the existing `@devanalyst/cache` package. Uncommitted Phase 07 work is retained.

A synchronous database on Vite's main thread would compete with transforms and HMR. Source hashes alone do not detect newly appearing import candidates or symlink retargets with unchanged source bytes. Persisting arbitrary runtime metadata would violate the existing privacy boundary.

## Decision

Use Node's built-in `node:sqlite` `DatabaseSync` inside a dedicated bounded worker. The supported Node versions already provide it; no native addon or framework integration is introduced. Node 22 emits its experimental SQLite warning; it is not suppressed. The cache worker imports the explicit public `@devanalyst/analyzer/workspace` export so workspace access does not eagerly load the TypeScript compiler into every SQLite worker.

Use SQLite rollback journals, short `BEGIN IMMEDIATE` transactions, foreign keys, `secure_delete`, `trusted_schema=OFF`, parameterized statements and a 500 ms busy timeout. Reads and writes serialize within each worker; concurrent workers/processes coordinate through SQLite. Rollback journaling avoids persistent WAL growth from pinned readers. Lock failure reports `CACHE_BUSY` and fresh analysis remains usable. References: [Node SQLite API](https://nodejs.org/download/release/v22.17.0/docs/api/sqlite.html) and [SQLite PRAGMAs](https://www.sqlite.org/pragma.html).

Keep one database at `.cache/devanalyst/analysis.sqlite` under the canonical authorized workspace by default. Cache directories are created privately, directory/file symlinks and hard-linked database files are rejected, and POSIX modes are 0700/0600. Cache sidecar symlinks are also rejected. Vite denies cache-directory HTTP requests, including encoded and `@fs` forms, and refuses persistence inside its public/build output directories. Production startup remains excluded; production tests forbid cache markers. The host filesystem/admin remains a trust boundary, not an OS sandbox.

## Keys, values and layers

The cache has independent `page`, `component`, and `element` scopes and separate `analysis`/`translation` namespaces. Translation keys require a target language; page keys require route and structural runtime fingerprints. Closed schemas admit only detailed static analysis, code explanations, translation findings or structural index references. Raw DOM text, form/control values, props, history state, free-form questions and arbitrary metadata fields are not cache payloads.

A project partition fingerprints canonical workspace identity and source policy. Stable identity fingerprints include scope/kind, source subject and revision, analyzer/access policy, relevant route/runtime context, provider/model, analysis schema version and language. The concrete key additionally includes all source/config hashes, missing import candidates and source-alias resolutions. Object ordering is canonical; array order remains meaningful. Module source facts are route independent. Page indexes include route and committed-site fingerprints; element indexes include the JSX site and structural kind. No runtime business values are needed.

Component-scope records hold shared module AST results and separately keyed AI explanation results; multiple components in one source file share that work. Element/page records reference eligible component results rather than duplicate full AST payloads. Page indexes are bounded preparation hints, not a claim that cached DOM visibility or React execution remains current. The browser still discovers current committed elements and the server validates origin manifests. Opening the page after a server restart refreshes those manifests normally.

## Freshness and stale-while-revalidate

Every candidate lookup rechecks authorized source/configuration bytes through the workspace policy. It also checks previously missing import candidates and canonical alias targets. The analyzer exposes `missingDependencies` and `sourceAliases` separately from parsed-source evidence hashes. Changes made while Vite was stopped therefore invalidate reuse without depending on watcher history. Partial analyses are historical only and cannot become fresh cache hits.

Vite watcher events invalidate rows indexed by affected source/dependency/alias paths. Add/unlink and configuration topology changes conservatively invalidate that project's partition. In-memory analysis uses the same missing/alias checks. New facts are checked before insertion; transactional generations prevent writes obtained before invalidation/clear from repopulating a cleared or obsolete cache. Generations are conservative across concurrent writers; a rejected write may remain a memory-only result until a later analysis.

`get` returns only fresh hits by default. `allowStale` makes historical data explicit with timestamps, `status: stale`, `cacheStatus: stale`, and all nested finding/trace/graph confidence downgraded to UNKNOWN. Stale data cannot pass as current VERIFIED evidence. The orchestrator marks stale cache state while a bounded AST task revalidates; its current-result API does not expose historical findings. A fresh deterministic result replaces stale state. AI failure or cache failure does not invalidate usable deterministic facts.

## AI and privacy

Background AI still requires both enabled/permitted-path consent and explicit `preanalysis.backgroundAI`. A fresh persisted AI hit restores the explanation and suppresses a Claude invocation. Model, depth, consent, provider/CLI policy or schema changes alter its key. Cached AI output never overwrites deterministic facts. Completed, validated provider output is flushed during shutdown even if its route subscriber closes during the database write; canceled unfinished inference is discarded.

Only allowlisted source facts and structural indexes enter storage. Source paths retain mandatory exclusions and containment checks. A second cache-specific heuristic rejects likely credentials, private keys, token-bearing URLs and marked private/password/default-value source contexts. Such records remain uncached and fresh analysis can continue. Heuristics do not identify every possible source secret; select source includes appropriately. Local caches contain source snippets and explanations, are not encrypted, and hashes are identifiers rather than anonymization guarantees. Changing a permitted-path policy isolates prior partitions; clearing an old partition or using a new directory is an explicit operator action.

Translation storage is available through the API but does not authorize collecting/transmitting additional UI text or add a translation UI journey. Callers must split translation findings from code explanations. Browser snapshots and progress retain only structural status; SQLite contents are not served through the bridge.

## Limits, migration and failures

Default limits are 2,000 records, 256 MiB logical record bytes, 2 MiB per record, 64 outstanding requests, a 15-second worker deadline, a 256 MiB V8 worker heap, 24-hour freshness and a seven-day historical window. LRU eviction favors stale entries. SQLite's page cap bounds the database to twice the logical byte budget plus 4 MiB of metadata reserve; a rollback journal can transiently consume comparable bounded space. This is not a promise that total disk usage equals `maxSizeMb`, nor a whole-process RSS guarantee. Disk-full and queue/worker failures fail closed to fresh analysis.

Index updates coalesce to at most 32 pending page snapshots; there is one active index flush. Retained index dependency metadata is bounded to 64 modules/4 MiB, and repeated index writes are fingerprint-deduplicated. Database and worker queues have finite bounds. No cache work is awaited by Vite configureServer or HMR hooks.

The database uses an application ID and transactional `user_version` migrations. Version 1 adds the initial record/dependency schema, version 2 records missing candidates, and version 3 records alias resolutions. Earlier records are invalidated during upgrades rather than trusted without the newer dependency proof. Concurrent startup migrations serialize. Row checksums/strict codecs detect accidental row corruption; a corrupt row is discarded with a diagnostic.

Corrupt, foreign, future-version, inaccessible or unsafe-path database contents are preserved and fall back to a bounded in-memory database with explicit diagnostics. The cache API inspects/clears that fallback, not the preserved invalid disk file. To restore persistence, close relevant servers and select a new empty cache directory or quarantine the old file offline. Automatic destructive recovery is deliberately avoided because another process may own a live connection. Busy databases are not deleted or treated as corrupt. Worker failure/timeout rejects pending requests and terminates resources; fresh analysis continues.

## Validation

Use real SQLite files/workers for migration, concurrent readers/writers, compare-and-set invalidation, stale labels, size/TTL eviction, corruption, permissions, symlink safety, missing-file and alias changes. Public integration drives an actual mocked Claude CLI subprocess and proves no repeat invocation on a valid restart hit; changing model causes only the required AI miss. Chromium/Vite verifies reopening after restart, source invalidation and privacy. Measure warm hit latency and parent event-loop progress without claiming a universal cached-response SLA. See [Phase 08 validation](../phase-08-validation.md).
