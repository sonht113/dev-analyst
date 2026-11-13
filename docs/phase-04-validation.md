# Phase 04 — Reliable DOM-to-Source Mapping validation

The owner explicitly authorized Phase 04 for React + Vite source mapping, ahead of behavioral analysis. [ADR 0006](adr/0006-react-source-mapping.md) records the researched strategy, public contracts, ID definitions and limitations. Existing Phase 03/editor configuration changes were preserved. No historical framework source was altered and no commit/publication is authorized.

## Acceptance evidence

| Requirement                                   | Evidence                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correct selected source and lexical component | Compiler unit positions plus actual Vite/Chromium selections, workspace-relative paths and one-based source coordinates                                                                      |
| Nested/reusable/fragments/conditionals/lists  | Unit and browser cases; repeated rows in a sibling local package have common site ID and distinct runtime IDs retained through keyed reorder                                                 |
| React behavior and source maps                | Exact map positions after the actual Vite React transform; DOM output, counter state and native-ref lifecycle match an uninstrumented Vite baseline under StrictMode                         |
| HMR and SPA                                   | Browser navigation without reload, source line/revision updates with state preservation, syntax-error stale invalidation and correction recovery                                             |
| Unsupported/ambiguous results                 | Existing refs/spreads/custom elements/factories/DOM clones return UNKNOWN; registry unit tests cover multiple owners, reused refs, stale/tag mismatch/detached nodes and malformed manifests |
| Development/privacy boundaries                | Disabled/SSR/production exclusion, existing trusted middleware and workspace policy, symlink escape prevention, no source-text/DOM-value RPC or AI invocation                                |
| Diagnostics and measured work                 | Bounded relative-file skip/site diagnostics and transform durations captured from real fixture transforms                                                                                    |

## Executed verification

Local environment: 2026-11-12, Darwin 24.1.0 arm64, Node.js 22.23.2, pnpm 10.33.0, Vite 8.3.5, React 19.3.1, Playwright Chromium.

| Check                                             | Result                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile --offline`        | Passed for nine workspace projects; dependency resolution updated through pnpm                         |
| `pnpm lint`                                       | Passed ESLint, package boundaries/cycle checks and formatting                                          |
| `pnpm typecheck`                                  | Passed root tooling/tests, seven active packages and React app                                         |
| TypeScript server semantic/suggestion diagnostics | No diagnostics across 20 changed TypeScript files; files belong to the intended package/root projects  |
| `pnpm test:smoke`                                 | Passed 145 unit/integration tests in 16 files, followed by 25 Chromium E2E tests                       |
| `pnpm test:independent`                           | All seven packages build with generated prerequisite outputs removed                                   |
| `pnpm build`                                      | Passed seven packages and the React production build                                                   |
| `pnpm test:packages`                              | Passed ESM imports, declarations/maps, private import rejection, local package archives and CLI checks |
| Changed-document local links / `git diff --check` | Passed; historical framework source/configuration remains unchanged                                    |

The final real fixture diagnostic capture contains five transform observations. Mapped App (15 sites), sibling Row (2 sites) and Lazy (1 site) took **4.69 ms, 3.80 ms and 0.90 ms**, respectively. The unsupported dynamic-factory module took **15.82 ms**; the no-host-JSX entry took **1.82 ms**. These are individual local timings including guarded file read and instrumentation/skip processing, not a statistical benchmark, full-page overhead estimate, or the future cached-analysis latency target. The JSON artifact is `test-results/mapping-records-measured-t-4bdcc-stics-from-the-real-fixture/mapping-diagnostics.json` (ignored output, recreated by E2E).

Earlier development failures in module resolution, fixture setup and expected map columns were fixed without deleting or weakening acceptance assertions. A chained sandbox integration invocation could not bind loopback (`EPERM`); authorized direct integration/smoke commands exercised the real services. Other browser engines, hosted CI, Node.js 24 and other React versions were not run. Package checks only created temporary local archives, not publication. No commits were created.

## Boundaries

Mapping covers registered safe intrinsic JSX templates, not all React programs. Ref/spread/custom-element and opaque factory cases are deliberately skipped. Module-level JSX can have a verified origin while component identity is null. Lexical names are not a private runtime owner stack. Source IDs are stable under documented structural conditions; runtime IDs identify DOM objects only for the page lifetime. Cross-module React-element introspection/cloning, arbitrary JSX factories, upstream rewritten code, hydration/SSR and other React/browser versions have no general semantics guarantee. Read [ADR 0006](adr/0006-react-source-mapping.md) before extending coverage.

HMR invalidation is asynchronous and begins when an allowed source watcher event is observed. Stale results lose claimed source fields; no source position is guessed for an unknown result. Browser manifests and Node diagnostics are bounded and remain in memory; this is not persistent caching. Behavior analysis, editor opening, translation, AI/provider enforcement and release preparation remain pending. Full product completion is not claimed.
