# Phase 07 validation — Predictive Page Pre-analysis

Date: 2026-11-13. Scope: React + Vite + TypeScript and the seven active packages only. The previous [session overview](chat-session-overview.md) was read before implementation. Initial Git status was clean; no commit, push, publication or external-service change was requested or performed.

## Delivered behavior

- Initial bridge connection starts sliced viewport structural collection and asynchronous AST pre-analysis automatically. Active pathname/hash-route changes create a new page generation; dynamic path segments are preserved locally without query/history collection.
- Verified JSX sites are checked against the Node transform registry before source access. Private/editable/control values, DOM text, URLs and arbitrary source coordinates are not sent over the page protocol. SVG tag names are normalized for structural transport.
- Page/module/component indexes, related-source snapshots, independent static/AI states and bounded incremental progress. Old revision progress cannot overwrite a newer browser item's status. Inspector status shows AST state/cache and page counts.
- Selected/hovered/button/link/form/menu/tab priority, shared-module and cross-page deduplication, cancellation after the last subscriber leaves, admission of selected uncached work under saturation, finite resource limits and retry suppression.
- Real AST worker threads isolate CPU work from Vite and rendering. Cancellation terminates workers before slots are released; Vite shutdown waits for worker/provider cleanup. Startup and HMR hooks do not await behavior analysis.
- Hash-validated in-memory reuse, dependency/config/malformed-source snapshot fingerprints, source/topology invalidation and late watcher revision handling. Parsed `sourceHashes` remain distinct from optional `dependencyHashes`; malformed/config text is not semantic evidence.
- Background Claude is disabled by default. Both `config.ai.enabled`/permitted paths and `preanalysis.backgroundAI: true` are required. Only source-backed AST uncertainty queues AI; source/path/hash/secret/no-tools/provider limits remain enforced. Failure preserves deterministic results and reports AI state separately.

See [usage and defaults](preanalysis.md) and [ADR 0009](adr/0009-predictive-page-preanalysis.md).

## Executed checks

Local environment: macOS/Darwin arm64, Node 22.23.2, pnpm 10.33.0, TypeScript 6.0.3, Vite 8.3.5, React 19.3.1, Playwright Chromium. Loopback and browser/subprocess suites ran through the approved outside-sandbox runner after the restricted sandbox rejected local port binding.

| Check                                      | Observed result                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --frozen-lockfile` | Passed for nine active workspace projects; dependency/lockfile updates performed through pnpm                   |
| `pnpm lint`                                | ESLint zero warnings, dependency boundaries/cycles and formatting passed                                        |
| `pnpm typecheck`                           | Active packages, tooling/tests and React app passed                                                             |
| `pnpm test:smoke`                          | 266 unit/integration tests in 23 files and 30 Chromium E2E tests passed                                         |
| `pnpm test:independent`                    | All seven libraries built independently after clearing generated outputs                                        |
| `pnpm build`                               | Active libraries and real React production build passed; outputs restored after independence checks             |
| `pnpm test:packages`                       | Public exports, private import rejection, declarations/maps, local package archives and CLI smoke checks passed |
| Production exclusion                       | Real React build forbids queue/worker/pre-analysis markers in addition to existing bridge/inspector/AI markers  |
| `git diff --check`                         | Passed                                                                                                          |

The final suites extend the previous 245 unit/integration and 27 browser cases by 21 and 3 respectively. Queue coverage includes scheduling, last-subscriber cancellation, rapid revisit, delayed selected admission, AI ordering/cancellation, stale hash rejection, late watcher events, memory eviction and deadlines. Public worker integration uses actual guarded source files, verifies AST/API/component/dependency evidence and cancellation, and observes parent event-loop turns during work. The existing privacy E2E now validates new structural messages through the strict client schema while retaining the original no-secret/no-text assertions.

## Failures found and corrected

1. The first restricted browser attempt could not bind loopback (`EPERM`); the authorized runner was used without reducing assertions.
2. Browser menu/tab classification initially gave native button precedence over semantic roles. Roles now determine the requested interactive kind.
3. A completed scan retained its timer handle, suppressing later mutation/HMR discovery. Completion clears the handle; real lazy-load and HMR cases verify rescheduling.
4. The temporary authenticated bridge fixture needed explicit resolution to the installed React JSX runtime. No dependency was installed for a historical framework.
5. Late watcher events could invalidate an already transformed current revision. Watcher reads now compare guarded hashes; identical current revisions remain usable, while obsolete source is still invalidated.
6. An urgent request arriving while the entry budget was occupied by active work initially lost admission. The bounded page index now retains that priority and admits it as soon as resources yield; a real Alt+Click E2E and queue regression cover it.
7. Existing privacy assertions expected route-only transport. They now strictly validate the additional authorized structural event types and continue rejecting private values/text.

No failing tests were removed, skipped in the final aggregate, or weakened to accept incorrect source evidence.

## Performance observations and limits

The final real browser responsiveness case observed 20 animation frames while progressive work ran: median interval 16.7 ms, maximum 16.8 ms. Numeric intervals are retained in the ignored `preanalysis-frame-observation.json` artifact. Parent event-loop integration also continues to tick during real worker execution. These are local, small-fixture responsiveness observations, not a large-project benchmark, an RSS guarantee, a hard frame-time SLA or proof of the future cached-response target below 100 ms. Discovery/resource bounds and worker isolation are enforced separately.

The cache is per-server memory only; persistent SQLite/layered caches, migrations and corruption recovery remain future work. The page index reflects safe committed JSX and a bounded static graph; unsupported origins, closed roots/cross-origin frames and discovery/occlusion limits remain explicit. Dynamic pathname/hash identity is supported without guessing router templates or extracting private query parameters. Component facts do not prove runtime behavior.

Successful live authenticated Claude inference remains unverified from Phase 06. Phase 07 does not change authentication, probe the provider, or transmit this project's source to a live provider during verification. Queue tests use controlled enrichment callbacks; existing provider subprocess tests use mock CLI protocol fixtures. Passing these does not establish live model quality or OS sandboxing. Linux/Node 24, other browser engines and complete product acceptance are not claimed by this local report.
