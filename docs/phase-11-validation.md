# Phase 11 validation — Framework adapters

Date: 2026-11-16. The owner explicitly authorized Next.js + React, Vue 3 + Vite and Nuxt 4 alongside React + Vite, superseding the previous restriction for these three targets. Identity remains DevAnalyst. Existing uncommitted Phase 10 work was preserved; no commit, push, publication or external-service modification was performed. No later phase is authorized.

## Delivered behavior

- Concrete `FrameworkAdapter`/capability contract and original source evidence, independent JSX and SFC compiler strategies, neutral browser provenance registry and shared inspector UI. No private React/Vue runtime traversal or fake Vite server.
- Shared Node services extracted into `@devanalyst/server`: authenticated bridge, workspace/path policy, source registry, workers/queue, Claude, SQLite, configuration and guarded editor navigation. Existing Vite public compatibility exports remain available; package references/exports are synchronized.
- Vue SFC compiler ranges/source maps, UTF-16-preserving script projection, template conditions/bindings, direct symbol-resolved handler/service/API links and explicit Composition API source facts. Original SFC hashes and actual bytes are retained. Public directives preserve refs/keyed DOM instances and template HMR state; invalid/conflicting registrations demote old evidence.
- Next public custom development server, Webpack/Turbopack loader hooks, automatic private owner-only compiler IPC, hydration bootstrap and orderly shutdown. Explicit client boundaries map; Server Components remain UNKNOWN and server action/server-only module bodies are excluded from client call tracing.
- Nuxt public module/Vite/listen hooks, hydrated client template mapping, dev-only committed-page notification and route-aware pre-analysis. No Nitro/server-only runtime claims.
- Four realistic applications, eleven active library packages and sixteen workspace projects including root. Typed config helpers are available from each integration. Framework identity is part of cache policy; original Vue evidence passes existing opt-in/no-tools/path/hash/secret Claude controls.
- Native development and production tests, installation/setup/limits/recovery guide, ADR 0013, architecture/constitution/plan/testing/progress/structure and handoff updated.

## Executed checks

Environment: Darwin arm64, Node **22.23.2**, pnpm **10.33.0**, TypeScript **6.0.3**, Playwright Chromium. Framework versions: Next **16.4.6**, React **19.3.1**, Vue/compiler **3.5.45**, plugin-vue **6.0.11**, Vue Router **5.5.1**, Nuxt/Kit **4.6.4**, Nitro **2.13.6**, Vite **8.3.5**. Linux/Node 24 hosted CI has not been executed in this session.

| Command/check                                        | Result                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                                     | Passed: eleven libraries, strict root tools/tests and all four apps                                                            |
| `pnpm test`                                          | **355 tests in 38 files passed**, including real framework production builds/servers and existing React regression tests       |
| `pnpm test:e2e`                                      | **49/49 passed** in the full Chromium run                                                                                      |
| Final `playwright test tests/e2e/frameworks.spec.ts` | **7/7 passed**, after strengthening API-chain assertions, async Vue and invalid-config coverage                                |
| `pnpm build`                                         | Passed: eleven libraries and four native application builds                                                                    |
| `pnpm test:independent`                              | Passed: all eleven packages from removed prerequisite outputs, then restored outputs                                           |
| `pnpm test:packages`                                 | Passed: public main/private-path contracts, declarations/maps, local archives and CLI executable smoke for all eleven packages |
| `pnpm lint`                                          | Passed: ESLint, package boundaries/cycles and formatting                                                                       |
| Documentation/whitespace                             | Relative document targets verified; `git diff --check` passed                                                                  |

The final framework cases use actual Vue/Vite, Nuxt/Vite, Next/Webpack and Next/Turbopack subprocesses and Chromium. They assert bridge connection, normal counter behavior, exact original source file/line/strategy, selected VERIFIED API-chain evidence, live source edit/revision change, preserved HMR state, committed dynamic navigation, new source analysis and completed pre-analysis. Vue additionally verifies keyed row identity/reorder and an asynchronously loaded component. Next server-rendered heading provenance remains UNKNOWN. Three native invalid-config cases verify `INVALID_CONFIG` diagnostics, no browser injection and continued host interaction. Teardown deadlines and clean Next exit are asserted; forced shutdown is a failure.

Production cases build all four new configurations using native tools, scan emitted application JavaScript/HTML (including Nuxt server output and Next application chunks), reject DevAnalyst runtime/mapping/IPC/provider/cache markers, check public output for the owned local root, then start native production/preview servers and verify development endpoints are absent. Vue's ordinary SPA fallback HTML is distinguished from Nuxt/Next 404 responses. Existing React exclusion tests remain. These checks do not claim that every native framework trace/metadata/source-map artifact is path-free.

Vue integration uses actual worker source evidence, enforced mocked Claude subprocess transport and reopened real SQLite. It verifies original SFC hashes, source preservation and cross-framework policy isolation; it does not establish live model success. IPC tests verify owner-only filesystem permissions, strict request shape, traversal/extra-command rejection and filesystem cleanup. Compiler/config tests and browser tests use public exports/native compilers, not mocked framework mapping.

## Measured observations

One final local four-framework run recorded the following rounded journey times in ignored `test-results/frameworks-*/framework-timing.json` artifacts:

| Configuration  | Select → selected analysis READY | Link → route/source analysis/pre-analysis ready |
| -------------- | -------------------------------: | ----------------------------------------------: |
| Vue/Vite       |                           504 ms |                                          358 ms |
| Nuxt/Vite      |                           499 ms |                                          610 ms |
| Next/Webpack   |                           511 ms |                                        1,041 ms |
| Next/Turbopack |                           505 ms |                                          803 ms |

These include browser actions, rendering, polling resolution, worker/scheduling and route compilation; automatic pre-analysis may already be running. They are single local observations, not isolated transform/cache benchmarks, percentile results or proof of the future sub-100 ms cached-response target.

## Recovery and corrections verified during implementation

Sandboxed loopback/Unix-socket restrictions and initial registry DNS failures required authorized outside-sandbox runs; dependencies were subsequently resolved offline through pnpm. Early failures exposed Vue descriptor/HMR state resets, Nuxt runtime import resolution under `/_nuxt`, strict pnpm Turbopack runtime resolution and Next shutdown/socket ownership. These were fixed through stable Vue setup imports/per-site manifests, explicit public integration runtime exports and public Next lifecycle cleanup. The browser tests retain state preservation and teardown assertions.

The shared Claude context originally excluded `.vue`; it now admits the extension through the same guards. Vue condition citations were corrected to original expression ranges rather than whole directive syntax. A unary-read false state-update case was corrected and regression-tested. A worker completion test's default one-second polling budget failed under concurrent cold compiler load; its bounded wait is now ten seconds, with behavior and cancellation assertions retained. The strengthened Nuxt API case initially targeted a page without a service call; the realistic fixture now includes an explicit imported service handler. A warning observation test was corrected to observe the imported native console. No failing behavior test was removed or replaced by a feature mock.

## Explicit limits

See [frameworks](frameworks.md) for installation and the exact runtime/bundler/OS envelope. Next Pages Router, transitive implicit client modules, Edge/Windows IPC/custom base or output configuration and other pipelines are unverified. Vue Options-API-only/render-function/preprocessor/external-block mapping and macro/auto-import semantics remain outside verified coverage. Nuxt Nitro 3, other builders/presets/layers/non-default base configurations are unverified. Native Linux execution awaits CI. SSR-only/server-action/Nitro execution is never claimed from DOM metadata.

`devanalyst dev` and project/plugin doctor remain Vite-specific; shared `status --url` works on the common diagnostics endpoint. Offline CLI analysis defaults to React; explicit framework selection is available through the analyzer API. Next startup needs the documented development wrapper plus client bootstrap; no separate bridge or manual credential/socket configuration is required. Config changes require restart.

Vendor declarations require scoped `skipLibCheck` exceptions at Nuxt Kit and affected application boundaries; implementation source remains strict and shared packages retain declaration checks (ADR 0013). No unsupported builder was installed solely for types. Packages remain private and local installation/archives are verified, not public registry publication. Installed editor GUI behavior, Windows launch, live authenticated Claude, conversational follow-ups, whole-project performance/accessibility hardening and release ownership/licensing/policy remain outstanding. Phase 11 is not overall product completion.
