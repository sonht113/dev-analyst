# Phase 05 — Static Code Analysis Engine validation

Phase 05 implements the owner-requested static engine in the existing `@devanalyst/analyzer` package, retaining the confirmed DevAnalyst identity rather than creating `@devlens/analyzer`. [ADR 0007](adr/0007-static-analysis-engine.md) records the strategy and scope. [Static analysis API](static-analysis.md) documents actual invocation and interpretation. Earlier uncommitted Phase 03/04/editor work is preserved.

## Acceptance evidence

| Acceptance                | Executed coverage                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-file button tracing | Actual TS/JS source imports, renamed bindings, re-export barrels, service functions and an Axios client; selected JSX reaches the API call node through graph edges                        |
| Components/exports/props  | Named/default/memo/class/list candidates, destructured/typed props, parent-child source relationships and inferred prop callback candidates; plain render-method classes remain inferred   |
| Conditional rendering     | If/ternary/logical/nullish/loop syntax and simple early-return guards; regression prevents a containing if from becoming a contradictory guard; switch fallthrough remains unknown         |
| Navigation/API evidence   | React Router link/hook references, native navigation, fetch, Axios clients/methods; literal source locations and expressions retained, dynamic endpoints/method overrides remain uncertain |
| State/hooks/effects       | React hook aliases, useCallback, effects, setters/reducer dispatch, class state APIs, custom hook conventions and uncalled nested function boundaries                                      |
| Safe imports/config       | Closed TypeScript compiler host, real allowed files, JSONC/local extends/path mappings, explicit aliases, canonical symlinks/cycles, malformed/excluded/outside sources                    |
| No application execution  | Sources containing file-write/throw payloads and an executable config remain unexecuted; no marker file appears                                                                            |
| Bounded failure behavior  | File/byte/AST/node/edge/finding/resolution/depth limits, cancellation, cycles and structured partial diagnostics                                                                           |
| Browser integration       | Actual Phase 04 selected JSX source is passed to the Node engine with matching revision/hash; handler/state findings are returned while host React state stays unchanged                   |

## Executed checks

Local verification: 2026-11-12–13, Darwin 24.1.0 arm64, Node.js 22.23.2, pnpm 10.33.0, Vite 8.3.5, React 19.3.1, Playwright Chromium.

| Check                                             | Result                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --frozen-lockfile`        | Passed; all nine workspace projects and generated dependency resolution agree                            |
| `pnpm lint`                                       | Passed ESLint with zero warnings, package boundaries/cycle checks and formatting                         |
| `pnpm typecheck`                                  | Passed root tools/tests, seven packages and the React app                                                |
| TypeScript server semantic/suggestion diagnostics | No diagnostics in changed TypeScript files; configured package/root projects selected correctly          |
| `pnpm test:smoke`                                 | Passed 191 unit/integration tests in 18 files and 26 Chromium E2E tests                                  |
| `pnpm test:integration`                           | Separate authorized run passed 34 tests in five integration files                                        |
| `pnpm test:independent`                           | All seven packages independently build with prerequisite outputs removed                                 |
| `pnpm build`                                      | Passed package builds and the React production build                                                     |
| `pnpm test:packages`                              | Passed public ESM exports, private import rejection, declarations/maps, local packaging and CLI checks   |
| API guide example                                 | Executed the documented Node invocation against the real React playground source; completed successfully |
| Changed-document local links / `git diff --check` | Passed                                                                                                   |

Phase 05 adds 43 engine unit cases, three public-package integration cases and one browser-to-Node analysis case. Source selection also rejects an exclusive end boundary. Production tests check that analyzer implementation markers stay out of application bundles.

The mixed-source integration fixture reads five source/config snapshots (1,187 bytes), visits 226 AST nodes and makes 38 bounded resolution attempts, producing 37 findings, 30 graph nodes and 46 edges in **109.67 ms**. This is an individual fresh request, not a benchmark or target. The fixture writes its latest observation to `join(tmpdir(), 'devanalyst-phase05-metrics.json')`.

An initial lint invocation raced a concurrently deleted test fixture directory; the subsequent isolated lint run passed. A separate sandbox integration invocation could not open loopback fixtures and was stopped; the authorized run and complete smoke suite passed. Resolver/config and fixture expectation failures were corrected without dropping or weakening source-evidence assertions. TypeScript server checks exposed deprecated TypeScript 6 APIs; import handling now uses `phaseModifier`, while a typed compatibility view reads existing projects' legacy `baseUrl` settings. No packages were published or commits created.

## Limits

`VERIFIED` describes source syntax or a symbol relation under analyzed configuration, never a witnessed runtime event. Dynamic dispatch, prop instance choice, external implementations, effective CSS, switch fallthrough, arbitrary value propagation, request interceptors and actual network/navigation/state outcomes are not guaranteed. All detailed findings declare `execution: not-evaluated`; unknown/partial results remain visible. See the ADR for the full supported envelope and defaults.

Snapshots are fresh per request and individually guarded; there is no atomic project snapshot or persistent cache. Timings are local observations, not performance targets. Other browser engines, Node.js 24 and hosted CI are not claimed. Browser result display/RPC, AI execution, translation, caching and editor navigation remain pending, and no product-completion or publication claim is made.
