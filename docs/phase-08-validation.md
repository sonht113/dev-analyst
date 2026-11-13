# Phase 08 validation — Persistent analysis cache

Date: 2026-11-13. Scope: React + Vite + TypeScript and the seven active packages. The historical `@devlens/cache` prompt uses the confirmed DevAnalyst identity: implementation extends `@devanalyst/cache`. Initial Git status contained the previous turn's uncommitted Phase 07 changes; those changes were retained. No commit, push, publication or external-service modification was authorized or performed.

## Implemented and observed

- Worker-owned SQLite storage survives cache-worker/composition lifetimes and actual Vite restart followed by page entry. Complete eligible AST results and cached AI explanations restore without another AST job or Claude invocation. A model change preserves valid AST reuse and causes the required AI miss.
- Independent page/component/element scopes and strict analysis/translation namespaces; keys include project/source policy, subject/revision, route/runtime fingerprints where relevant, provider/model, analysis schema and target language.
- Full guarded source/config hashes, previously missing resolver candidates and canonical source aliases. Offline file creation and symlink retargeting invalidate persisted reuse even if old module bytes remain unchanged. Vite watcher changes invalidate affected dependencies; topology changes are conservative.
- Explicit stale history with UNKNOWN confidence throughout findings/traces/graph, stale cache labels and timestamps. Current-result APIs do not expose stale facts during background revalidation. Cache failures preserve fresh deterministic results.
- Finite request/worker/entry/byte/TTL limits, stale-first LRU eviction, generation-checked writes across workers, atomic migrations, bounded lock waits, inspection/clear/delete controls and private cache files. Invalid databases preserve original contents and use a diagnostic memory fallback.
- Closed payload validation, secret/private-context exclusions and raw route/runtime omission. Actual SQLite fixture bytes exclude private password/text values. Cache-directory HTTP requests are denied, unsafe public/output placement disables persistence, and real production output excludes cache markers.

See [usage](persistent-cache.md) and [ADR 0010](adr/0010-persistent-analysis-cache.md).

## Executed checks

Local environment: macOS/Darwin arm64, Node 22.23.2, pnpm 10.33.0, TypeScript 6.0.3, Vite 8.3.5, React 19.3.1 and Playwright Chromium. Loopback/browser suites ran using the approved outside-sandbox runner. SQLite's Node 22 experimental-feature warning remains visible; it was not suppressed.

| Check                                      | Observed result                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm install --offline --frozen-lockfile` | Passed for nine active workspace projects; dependency resolution/lockfile updated through pnpm   |
| `pnpm lint`                                | ESLint zero warnings, browser/package boundaries, dependency cycles and formatting passed        |
| `pnpm typecheck`                           | Seven packages, root tooling/tests and React fixture passed                                      |
| `pnpm test:smoke`                          | **290 unit/integration tests in 25 files + 31 Chromium E2E tests passed**                        |
| `pnpm build`                               | Active libraries and real React production build passed                                          |
| `pnpm test:packages`                       | Public exports, private path rejection, declarations/maps, local packaging and CLI checks passed |
| `pnpm test:independent`                    | All seven libraries built independently from cleared outputs; full build restored afterward      |
| `git diff --check`                         | Passed                                                                                           |

Phase 08 adds 24 unit/integration cases and one browser case to Phase 07's 266/30 baseline. The 17 SQLite cases cover restart, scopes/namespaces and identity isolation, stale confidence, offline changes/missing imports, multi-worker generations/concurrent writes, populated concurrent migration, corrupt/future files, private fields/credentials, path/symlink safety, queue/entry/byte/TTL limits, corrupted rows, alias retargeting and bounded busy waits. Three public integration cases cover real AST + mocked Claude subprocess cache reuse, offline resolution and measured asynchronous reads. Two queue cases cover safe stale revalidation and cache-failure degradation; two authenticated bridge cases cover HTTP denial and public-directory refusal.

The populated migration fixture retains real cached records, downgrades the schema to the older layout, opens concurrent workers and verifies that old records become historical rather than current. Concurrent write/clear/invalidation tests use actual SQLite connections and generation comparisons, not mocked storage. The busy-writer case observes parent event-loop ticks during SQLite's bounded lock timeout and successful reads after release.

## Failures found and corrected

- Loading the main analyzer export inside each SQLite worker unnecessarily initialized the TypeScript compiler and increased startup contention. An aggregate run hit existing 3-second mock-Claude deadlines. The new public workspace-only export removes that dependency from cache workers. Original deadlines/assertions remain intact.
- A result could be marked AI READY before its asynchronous write completed. Closing the route/server in that interval aborted a later write guard, causing a repeat provider invocation after restart. Completed validated explanations now finish their guarded database write during shutdown; unfinished inference is still canceled. The actual subprocess integration verifies one inference across restart and one additional inference only after a model change.
- Input/result codec typing, optional/readonly fields and extended validation callback assertions were aligned with strict TypeScript and the new missing/alias proof fields. Regex escaping was corrected through lint without suppressions.
- Direct cache storage in public/build directories and direct HTTP access were identified during review and now have explicit rejection/denial regressions.

No failing tests were deleted, skipped in the final aggregate, weakened, or hidden by retries. Storage and primary integration tests use real SQLite; provider fixtures simulate the CLI protocol and are not claimed as authenticated model success.

## Performance observations

The final aggregate's small warm-cache fixture performed 20 validated lookups:

| Observation                       | Value   |
| --------------------------------- | ------- |
| Median                            | 2.48 ms |
| p95                               | 3.91 ms |
| Maximum                           | 4.01 ms |
| Parent timer turns during lookups | 47      |

Raw numeric observations are in `tmpdir()/devanalyst-phase08-cache-metrics.json`. The browser responsiveness case also retains its numeric frame artifact under ignored test results. These measurements demonstrate asynchronous small-fixture operation; they do not establish a whole-project inspector SLA, cold startup latency, total RSS/disk equivalence to logical cache bytes, or the product-wide cached-response target under all conditions.

## Operational and remaining limits

- The default 256 MiB is a logical record budget. SQLite's physical page cap is twice that budget plus 4 MiB; rollback journal overhead is temporary and bounded separately. Worker heap limits do not cap all native/process memory.
- Corrupt/foreign/future or unsafe databases use a bounded memory fallback and retain the disk file's contents. Clearing that fallback does not erase the preserved disk file. Stop relevant servers and select a new empty directory or quarantine the old file offline to recover persistence. Direct administrator tampering is outside the integrity boundary.
- Cache directories/files have private POSIX permissions; data is not encrypted. Runtime values and raw routes are excluded by the composition. Source snippets and source-grounded prose are local data, and source-secret detection remains heuristic. Narrowed source policies isolate previous partitions rather than silently expose or erase them.
- The existing source-origin gate still requires current verified manifests. The restart E2E explicitly reopens the page after restart; it does not claim uninterrupted component-origin registration when an old browser document survives a new server generation without serving those modules.
- Translation namespace storage and Node inspection/clearing APIs are delivered. Full inspector explanation/translation/follow-up UI, cache CLI utilities, editor navigation, broader performance/release matrices and complete product acceptance remain separate work.
- Live authenticated Claude inference, Linux/Node 24, other browser engines and hosted CI success were not established by this local run. No new live provider source transmission or authentication change occurred.
