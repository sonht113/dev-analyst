# React + Vite testing and acceptance

**React + Vite + TypeScript is the only currently supported framework combination.** All gates now target the seven active packages and `apps/playground-react`. Historical directories and their tests remain preserved and excluded. See [ADR 0004](adr/0004-vite-local-bridge.md) and the [Phase 02 validation report](phase-02-validation.md).

## Commands

| Command                          | Purpose                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install the nine active workspace projects, including the root                                      |
| `pnpm lint`                      | ESLint on active code, dependency boundaries, and formatting                                        |
| `pnpm typecheck`                 | Build declaration prerequisites and check active libraries, tooling/tests, and React                |
| `pnpm test`                      | Build packages and run all active Vitest unit/integration tests                                     |
| `pnpm test:unit`                 | Unit tests, excluding active integration files                                                      |
| `pnpm test:integration`          | Real Vite/bridge, CLI/consumer startup, and production builds                                       |
| `pnpm build`                     | Build seven libraries and the React playground                                                      |
| `pnpm test:independent`          | Build each active library with generated outputs removed first                                      |
| `pnpm test:packages`             | Public exports, private path rejection, declarations/maps, local archives, CLI smoke checks         |
| `pnpm test:e2e`                  | Chromium route/inspector/privacy/keyboard, React HMR, lifecycle, retry, restart, and teardown tests |
| `pnpm test:smoke`                | All unit/integration tests followed by Chromium E2E                                                 |

The root `tsconfig.json` extends `tsconfig.tools.json` and references the seven active package projects directly. Editors can therefore discover the same strict tooling/test configuration checked by `pnpm typecheck`, including Node types and browser runtime globals. Files outside each package's production `include` (such as unit tests) join this root project rather than an inferred editor project. The separate `tsconfig.packages.json` still controls library-only builds.

Install Chromium with `pnpm exec playwright install chromium`. Integration/E2E need permission to bind local loopback ports and launch browser/subprocesses. Use the environment's authorized test runner; document unavailable checks rather than substituting mocks or weakening assertions. Do not run the independence checker concurrently with builds/watchers.

## Phase 02 coverage

- Core contracts: loopback-only settings, bounded ports/resources/retries, bootstrap endpoint/credential validation, route metadata, existing finding/error/logger rules.
- Real workspace files: allowlists, mandatory sensitive-file exclusion, traversal/absolute paths, file/directory symlink escape, canonical excluded targets, bounded reads.
- Real Vite/WebSocket integration: runtime injection, credential-free HTML/module/snapshots, authenticated Origin/token checks, unsupported RPC/invalid JSON/version/route rejection, binary/rate/payload/connection limits, connection/disconnection, file changes, observer isolation, base paths, disabled config, port conflicts/fallback, restart/token rotation, and shutdown.
- Actual consumer and CLI subprocesses: `npm run dev` starts the configured bridge, CLI dev lifecycle and port release, doctor without services, missing config, production refusal, and safe errors.
- Production: real React application build and controlled Vite builds, including a custom development build mode, exclude DevAnalyst runtime markers/endpoints/local paths.
- Chromium against real React + Vite: server-acknowledged routes for all navigation APIs without document reload, sanitized metadata and preserved history state, React Fast Refresh preserving counter state, source notices, reconnect/stop, page lifecycle suspension, native navigation errors, bootstrap outage retries, and actual Vite restart.

Network tracing is disabled to avoid persisting bootstrap credentials; failures can retain fixture screenshots. Browser fixtures are owned temporary copies under the React app, allowing dependency resolution without changing user source. Tests remove only those fixtures. The outage test injects bootstrap failures specifically for error recovery; successful integration, routes, HMR, restart, and production tests use the real feature.

## Phase 03 coverage

The inspector also captures frame load in observed parent documents so a newly loaded same-origin document can receive its first inspection before debounced subtree discovery. A deterministic load-handler regression supplements native Playwright frame clicks; see [CI follow-up](ci-watcher-validation.md).

The separate `tests/e2e/inspector.spec.ts` fixture runs with real React + Vite and the injected runtime, alongside the Phase 02 bridge suite. It covers passive/modifier hover, nested selection, disabled controls, SVG, pin/copy/close, keyboard/context menus/focus restoration, normal links/forms/typing/right-click, bounded/private metadata, same-origin nested frames/open shadows, scrolling/resizing/layout changes, host CSS isolation and event boundaries, dynamic React/SPA/HMR, disconnect/reconnect, clipboard/DOM-read failure and recovery, passive-tooltip tab order, focus preservation after returning to host inputs and stop cleanup. Attribute-policy unit tests verify forbidden fields are never requested. Real production-build tests continue to check inspector exclusion.

A controlled 2,000-node DOM checks metadata bounds; a 1,000-event hover burst checks geometry coalescing and records its dispatch duration in `hover-measurement.json` under ignored test results. This is a synthetic local responsiveness observation, not a full application benchmark or the future cached-analysis target. A screenshot is retained for visual inspection of the isolated panel. Tests do not claim full accessible-name calculation, manual assistive-technology validation, arbitrary rotated iframe geometry, cross-origin internals, closed roots or other browser-engine coverage. See [Phase 03 validation](phase-03-validation.md).

## Phase 04 coverage

`packages/analyzer/src/instrumentation.test.ts` checks source ranges, lexical owners, deterministic IDs, fragments/conditionals/lists/memo/class/SVG, source-map positions, identifier/directive preservation, safe skips and limits. `packages/inspector/src/mapping-runtime.test.ts` exercises committed-node registration, identity, ref cleanup/StrictMode cycles, stale/ambiguous/tag/detached outcomes and untrusted manifest validation.

`tests/active/integration/mapping.test.ts` uses actual Vite transforms to verify map composition, namespaced module resolution/protection, disabled/SSR exclusion and real workspace policy/symlink/upstream-rewrite handling. `tests/e2e/mapping.spec.ts` copies the complex React source fixtures from `tests/fixtures/react-mapping/` into an owned temporary workspace. A sibling local package sits outside its Vite app root; aliases and explicit workspace includes make it eligible. Chromium checks exact source evidence, stable keyed rows, nested/memo/class/lazy/portal/render-prop patterns, native refs/unknowns, DOM clones, SPA/HMR, syntax-error invalidation/recovery and equivalence with an uninstrumented Vite baseline. The fixture records transform duration diagnostics as an ignored JSON artifact.

The mapping browser fixture explicitly uses the native fs.watch backend on macOS too. Simulated saves are separated beyond the pinned watcher coalescing window; syntax-error recovery waits for a real failed compilation response and asserts state/no-reload preservation. The bridge source-change test waits for the target watched entry before writing. See [CI watcher follow-up](ci-watcher-validation.md) for hosted failure evidence and the reproduced race.

Production tests check additional mapping markers. TypeScript/MagicString are Node-only production dependencies of analyzer; trace-mapping is a test dependency. No historical framework fixture is touched. See [Phase 04 validation](phase-04-validation.md) for results, timing observations and limits.

## Phase 05 coverage

`packages/analyzer/src/engine.test.ts` uses actual temporary source files to check parsing, declaration/export/prop structure, condition polarity, callback/import/barrel tracing, known API/router/hook/state/effect patterns, shadowing/mutation/dynamic uncertainty, guarded JSONC/config aliases, canonical symlink/import/call cycles, limits and cancellation. No application code is evaluated. Existing workspace-policy tests continue through Vite's public-package compatibility re-export.

`tests/active/integration/analysis.test.ts` imports the real analyzer package and loads mixed TSX/TS/JS/JSX workspace fixtures. It asserts precise API evidence, actual selected-subject → handler → service → API graph reachability, source-only confidence, no execution of source/config payloads and snapshot refresh. Metrics are written to a controlled temporary JSON artifact. The mapping E2E suite additionally passes a browser-selected source reference into the Node engine and verifies React state remains unchanged.

Run lint after transient fixture suites finish; a concurrently removed fixture can race directory walking. No analysis work is added to runtime startup/hover/HMR. See [Phase 05 validation](phase-05-validation.md) for executed results and measured work; [ADR 0007](adr/0007-static-analysis-engine.md) defines limits and unsupported behavior.

## Phase 06 coverage

`packages/ai/src/claude.test.ts` drives owned executable CLI fixtures with real Node subprocesses. It checks disabled/production behavior, version/auth/probe distinctions, no-tools startup arguments and runtime guards, environment isolation, structured Vietnamese output and resolved source citations, UNKNOWN UI-only translations, source/hash/permission/secret limits, token/output budgets, bounded retry/queue behavior, cancellation/deadlines and POSIX descendant termination. The fake CLI emits controlled protocol successes/failures; these tests do not claim live model or authentication success.

`tests/active/integration/ai.test.ts` uses the public analyzer and AI packages, actual React source, fresh AST findings/hashes and actual process transport to a mock CLI. It verifies rendering-guard and call-relation context, source-backed citations, confidence downgrading and unchanged source bytes. Production tests check provider markers remain absent from the real React bundle. The native installed CLI and the documented readiness API are checked separately; successful live inference depends on actual CLI authentication/model entitlement. See [Phase 06 validation](phase-06-validation.md) and [ADR 0008](adr/0008-claude-code-provider.md).

## Phase 07 coverage

Queue tests in `packages/analyzer/src/preanalysis.test.ts` check priority ordering, module/cross-page deduplication, last-subscriber and rapid-navigation cancellation, dependency refresh, stale and late-result rejection, AST-before-AI, AI cancellation, capacity admission, memory/deadline limits and retry suppression. Core tests reject private fields, unbounded batches and inconsistent statuses.

`tests/active/integration/preanalysis.test.ts` uses real worker threads and guarded workspace sources to verify component/dependency indexes, source-backed API findings, hash reuse/refresh, worker cancellation and parent event-loop progress. Authenticated bridge integration rejects forged/unregistered sites and obsolete routes, streams progress and cleans disconnected pages. Production checks forbid pre-analysis runtime/worker/queue markers.

`tests/e2e/preanalysis.spec.ts` uses actual React/Vite/Chromium for automatic collection, button/link/form/menu/tab metadata, private exclusions, repeated shared components, lazy components, dynamic/hash routes, cache reuse, selected uncached priority under a full queue, HMR/state preservation and frame observations. Network traces remain disabled; timing attachments contain only numeric frame observations. See [Phase 07 validation](phase-07-validation.md) for executed results and limitations.

## Phase 08 coverage

Cache unit tests use real SQLite files/workers for restart persistence, page/component/element and translation separation, model/schema/route/runtime key isolation, dependency/missing-file/alias invalidation, stale confidence, generation-checked concurrency, populated transactional migration, malformed/future/unsafe databases, secret exclusions, byte/entry/TTL eviction, row corruption, lock waits and request bounds. Queue tests keep stale data out of current results and preserve fresh analysis when cache operations fail.

`tests/active/integration/cache.test.ts` drives the actual guarded analyzer, SQLite workers and a real subprocess using the existing mocked Claude CLI fixture. It proves AST/AI reuse across composition lifetimes, model-specific AI misses, offline resolver changes, parent event-loop progress and local hit timings. This is not live authenticated inference. Bridge integration denies cache HTTP routes and unsafe public cache placement; production output excludes cache markers. The React/Vite Chromium suite verifies persistence after restart/page entry, real watcher invalidation and exclusion of private fixture values from SQLite. See [Phase 08 validation](phase-08-validation.md).

## Phase 09 coverage

Source-literal and selected-projection tests cover static/entity/nested text, privacy/dynamic/control exclusions, source provenance, handler/import/API reachability, sibling exclusion and unknown scope. Client reducer tests reject malformed confidence, raw private transmission, stale/late messages and check digest-only selection requests and progressive chunks.

The authenticated bridge verifies selected analysis when automatic page pre-analysis is disabled, forged source rejection and closed input schemas. `tests/e2e/analysis-ui.spec.ts` drives real React/Vite/Chromium, AST workers and SQLite with an owned mock Claude subprocess. It verifies no hover inference, independent fast translation, progressive source/AI findings, source links, copies, call search/confidence filtering, themes/locales/mobile/keyboard, private/runtime exclusion, HMR confidence demotion, provider failure, frame observations and no-repeat inference across dev server restart. Existing inspector tests retain host/SVG/frame/shadow/lazy/selection coverage and now assert the AI-disabled state. Production exclusion covers the new UI/transport/glossary markers. See [Phase 09 validation](phase-09-validation.md).

## Complete product acceptance

Phase 02 infrastructure, Phase 03 local inspection, Phase 04 safe JSX mapping, Phase 05 static analysis and Phase 06 provider APIs are not completion of the entire product. Every [F01–F18 capability and Definition of Done](implementation-plan.md#definition-of-done) remains required. Later tests must extend mapping, analysis, provider and inspector coverage as those features evolve, and cover live authenticated inference, conversational follow-up/editor journeys, wider failure recovery and measured whole-project performance. Phase 07–09 cover scheduling, persistent caches/invalidation and selected translation/analysis UI within their documented limits.

Current local HTTP support does not establish HTTPS/middleware-mode support. Path guards are not an OS sandbox for future AI subprocesses. Runtime source mapping and provider security must be verified in their own phases. Do not infer product readiness from foundation or route-counter tests.

Never delete failing tests to make CI green, weaken assertions, fabricate evidence, mock the feature under test in its primary integration check, or claim unexecuted tests passed. Run appropriate scoped checks before a phase completes and record commands, environment, results, limitations, and remaining work. Documentation-only changes need formatting/link/scope checks rather than launching runtime suites.

## Future Roadmap

Other framework verification has no active allocation. Expansion requires explicit owner authorization after complete React + Vite support.
