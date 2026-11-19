# DevAnalyst progress

## Owner-requested Japanese playground UI

React, Next, Vue and Nuxt playgrounds now display Japanese navigation, order/status labels, forms, sample data, messages and detail routes with `lang="ja"`. Source literals remain available for Japanese-to-Vietnamese inspection; inspector preferences are independent. Existing framework journeys use the Japanese accessible names and retain HMR/host-behavior checks. See [playground usage](playgrounds.md).

## Owner-requested element flow simplification

The inspector now leads with translation and a compact selected-element flow: rendering guards, display expression/declaration sources, and event outcomes. Technical findings remain collapsed and available for source review. Handler guards no longer become rendering conditions. JSX/Vue display-source extraction and native anchor destinations extend the existing bounded source-only analysis; dynamic/runtime and ultimate API provenance remain explicitly unresolved. See [ADR 0015](adr/0015-element-flow-summary.md), [UI limits](inspector-ui.md) and [follow-up validation](element-flow-validation.md). This does not complete pending product/release work.

Phase 11 is explicitly authorized for Next.js + React, Vue 3 + Vite and Nuxt 4 alongside React + Vite. [ADR 0013](adr/0013-framework-adapters.md) supersedes the former React-only scope for these three targets. The complete [18-feature plan](implementation-plan.md) remains required; framework support is limited to [tested configurations](frameworks.md). Earlier phase sections below retain historical delivery context.

## Completed foundation and Phase 02

- Strict TypeScript, package exports/declarations/maps, shared schemas, structured errors/logging, and CLI help/version remain available.
- Vite registers development-only automatic runtime injection and an authenticated `127.0.0.1` bridge. The React fixture starts it through normal `npm run dev`.
- Browser route tracking covers initial state, pushState, replaceState, popstate, and hashchange without terminal-log inference. Queries/history-state/opaque fragments are omitted.
- Connections/disconnections, bounded reconnection, source notices, native React HMR, base paths, port conflicts/fallback, restart/token rotation, graceful shutdown, and credential-free diagnostics are implemented.
- Node workspace access guards enforce allowed paths, sensitive exclusions, canonical containment, file identity/change checks, and size bounds. No file/shell RPC or AI invocation is exposed.
- CLI dev/doctor support configured project startup, production refusal, diagnostics, and signal shutdown. Automatic loading of `devanalyst.config.ts`, editor navigation, and broader CLI utilities remain pending.
- Workspace installation, lockfile importers, root scripts/references, lint/tests, packaging checks, and CI now target seven active packages and the React fixture. No historical application/package source was deleted.

See [Phase 02 validation](phase-02-validation.md) for exact final executed checks. The [Phase 01 snapshot](phase-01-validation.md) remains historical evidence under its previous scope. The earlier documentation-only scope update preserved code/configuration at that time; Phase 02 now implements the separately authorized runtime and operational alignment.

## Completed Phase 03 — Browser Element Inspector

- Passive hover, Alt hover, Alt+Click, explicit Inspect mode and opt-in custom context menu; native app controls and right-click remain functional outside inspection.
- Shadow DOM overlay with multiple client-rectangle highlights, viewport-positioned panel, pin/unpin, close, copy, focus/menu/keyboard controls and system/light/dark styling.
- Bounded visible/Japanese-script text, allowlisted attributes, label candidates and structural DOM metadata. No form values, private/editable subtrees, arbitrary HTML/data/URL attributes, source claims, transport or AI calls.
- Same-origin nested frame and open-shadow content, dynamic React rendering, scrolling/resizing/layout changes, SPA navigation and HMR; loading, copy/error and connection states; full stop cleanup.
- See [Phase 03 validation](phase-03-validation.md) for executed checks and explicit browser/geometry/privacy limits. At Phase 03 delivery source mapping was pending; Phase 04 below adds it. Editor navigation, translation and AI remain pending.

## Completed Phase 04 — Reliable DOM-to-Source Mapping

- Development-only original JSX instrumentation through TypeScript AST/MagicString; authorized file reads, high-resolution source maps, no production or SSR injection.
- Actual committed-node provenance through public React refs/WeakMaps, relative file/range and lexical component evidence, deterministic source IDs and per-DOM runtime identities.
- Nested/reusable/fragment/conditional/list/lazy/memo/class/render-prop/portal fixtures, including an authorized local package outside the Vite app root. Native refs, source semantics and DOM output are compared to an uninstrumented baseline.
- HMR/SPA mapping, revision-aware invalidation including syntax-error edits, bounded diagnostics and explicit UNKNOWN for unsupported/ambiguous/unavailable nodes.
- Existing refs/spreads/custom elements and opaque element transformations are intentionally outside mapped coverage. See [Phase 04 validation](phase-04-validation.md) and [ADR 0006](adr/0006-react-source-mapping.md). At Phase 04 delivery behavior analysis was pending; Phase 05 below adds the bounded engine. Editor actions and AI remain pending.

## Completed Phase 05 — Static Code Analysis Engine

- Node-only `createStaticAnalyzer` with detailed structured findings/graph/diagnostics/metrics and a compatible `Finding[]` adapter. TS/JS/TSX/JSX are parsed and bound through TypeScript without application execution.
- Components/exports, props/JSX relationships, render/visibility/disabled expressions, local/imported/re-exported handlers/callbacks, hooks/state/effects and known React navigation/fetch/Axios patterns carry actual source evidence and distinct VERIFIED/INFERRED/UNKNOWN labels.
- Authorized closed import graph, TypeScript paths/JSONC extends, explicit aliases, canonical cycle handling and configurable resource/cancellation limits. Opaque/dynamic targets and source exclusions stay unknown.
- Workspace policy moves to analyzer with Vite compatibility re-exports; no new browser/bridge RPC, AI call or analysis work in HMR/hover/configureServer. Browser integration tests pass real selected source references to the Node API without changing React state.
- See [Phase 05 validation](phase-05-validation.md), [API guide](static-analysis.md) and [ADR 0007](adr/0007-static-analysis-engine.md). At Phase 05 delivery provider work was pending; Phase 06 below adds the API. Inspector presentation, persistent caching and editor opening still require separate delivery.

## Completed Phase 06 — Claude Code CLI provider API

- Opt-in `createClaudeCodeProvider` implements the existing AIProvider interface plus detailed citations/usage and executable/auth/non-interactive readiness diagnostics. Retains `@devanalyst/*` identity.
- Native CLI 2.1.323 runs with argument arrays, isolated cwd, environment allowlist, no-tools permissions, strict empty MCP, disabled customizations and validated runtime metadata. POSIX process-group cancellation/deadlines, bounded queues/concurrency/context/usage and transient-only retries are implemented.
- Deterministic findings and exact source hashes/ranges form the primary context. Shared workspace guards intersect AI consent; sensitive paths/content are excluded. Output IDs resolve to real evidence, Vietnamese prose is schema-validated, model certainty is capped at INFERRED, and original source/UI text is preserved.
- Actual installed CLI detection and structured auth-error invocation were verified. Both sandboxed and authorized outside-sandbox readiness checks report no available authentication; successful live inference remains unverified. Mocked subprocess integrations exercise structured success/failure behavior without presenting it as live model success.
- See [Phase 06 validation](phase-06-validation.md), [usage](claude-code.md) and [ADR 0008](adr/0008-claude-code-provider.md). Browser result/translation/follow-up UI, persistent cache and editor opening remain pending; Phase 07 below adds background scheduling.

## Completed Phase 07 — Predictive page pre-analysis

- Automatic viewport structural collection, route/hash-path identity, committed lazy component discovery and authenticated server-manifest validation. No DOM text/values or arbitrary file/source/AI requests are transported.
- Shared-module priority queue, cancellable AST worker threads, selected/hovered/interactive ordering, cross-page deduplication, obsolete subscriber cancellation, resource bounds, progressive states and inspector status.
- Dependency-hash-validated in-memory reuse, root/dependency invalidation and conservative topology invalidation. Separate opt-in background Claude consent; only AST uncertainty is eligible and provider failure preserves static results.
- See [usage](preanalysis.md), [ADR 0009](adr/0009-predictive-page-preanalysis.md) and [validation](phase-07-validation.md). Persistent SQLite/layered caches, behavioral/AI result UI and full product acceptance remain pending.

## Completed Phase 08 — Persistent analysis cache

- Worker-owned SQLite in `@devanalyst/cache`, page/component/element scopes, separate code/translation namespaces, provider/model/schema/context keys and generation-checked writes.
- Source/config/hash/missing-import/alias validation across restart, watcher invalidation, explicitly stale UNKNOWN history, bounded eviction/queues and Node inspection/clearing controls. Invalid databases are preserved with memory fallback diagnostics.
- The composition reuses valid AST and AI results without another provider invocation. Source privacy is allowlisted; cache HTTP access/public-output placement is denied.
- See [cache usage](persistent-cache.md), [ADR 0010](adr/0010-persistent-analysis-cache.md) and [validation](phase-08-validation.md). Rich analysis/translation/follow-up UI, editor navigation and release gates remain pending; no authenticated live AI success is claimed.

## Completed Phase 09 — Translation and AI inspector UI

- Compact hover and explicit expanded inspection with original Japanese, independent source-matched Vietnamese translation, scoped deterministic facts and opt-in Claude explanations. Hover never starts inference.
- Component/source provenance, visibility/disabled guards, selected handler/call paths, API/navigation/state/effect evidence and explicit VERIFIED/INFERRED/UNKNOWN semantics. Clickable evidence opens an inline excerpt.
- Per-lane loading/partial/stale/failure/cache indicators, bounded progressive rendering, late-response rejection, HMR/cancellation and persistent translation/selected-explanation reuse.
- Independent copies, call search/confidence filtering, responsive positioning, native keyboard/focus behavior, English/Vietnamese/Japanese chrome and persistent theme/language preferences. Private/runtime text is excluded from provider requests.
- See [usage](inspector-ui.md), [ADR 0011](adr/0011-translation-and-inspector-ui.md) and [validation](phase-09-validation.md). Editor navigation, conversational follow-ups, authenticated model quality and release gates remain pending.

## Phase 10 — Developer experience and configuration

- Owner-authorized Phase 10 retains DevAnalyst identity and React + Vite scope. Trusted typed configuration loads at Vite root with per-mode overrides, inline precedence, strict defaults/validation and actionable safe diagnostics.
- CLI setup/doctor/status/cache/analyze/open reuse existing Node services; normal Vite development automatically manages the bridge. Doctor distinguishes Claude installation/capability/auth status from live inference. Cache administration is offline.
- Configurable physical-key shortcuts, deterministic/AI depth, route/file exclusions, fixed VS Code/Cursor editor launch with shared workspace/position/revision guards and opt-in structured debug events.
- See [reference](configuration.md), [ADR 0012](adr/0012-developer-configuration-cli-editor.md) and [validation](phase-10-validation.md). Native executable fixtures validate exact editor arguments; interactive GUI/Windows behavior and live authenticated inference remain unverified. No commit, publication or later phase is implied.

## Phase 11 — Framework adapters

- Eleven active packages and four apps; shared Node services extracted into `@devanalyst/server`, preserving Vite public compatibility reexports and existing Phase 10 changes.
- Concrete source adapter contract, framework-neutral browser registry/UI, separate React-ref and Vue-template/public-directive mapping. Original SFC hashes/ranges, template conditions/events and explicit Composition API evidence feed shared workers, guarded Claude and SQLite.
- Next public custom dev server, Webpack/Turbopack compiler hooks, owner-only compiler IPC and explicit client-only mapping; server component/action execution remains unavailable. Nuxt public module/Vite/listen/page hooks reuse the shared services.
- Native browser tests cover exact source/navigation/pre-analysis/HMR/state/hydration/keyed instances and native production builds check exclusion. See [guide](frameworks.md), [ADR](adr/0013-framework-adapters.md) and [validation](phase-11-validation.md) for actual results, commands and unsupported configurations.
- No commit, push, publication, external service change or later phase is authorized. Live authenticated AI, interactive editor GUI and full product/release completion remain pending.

## Owner follow-up — Interactive hover and commerce playgrounds

- All four active apps now offer realistic synthetic commerce workflows with real process-local APIs, filters/pagination, guarded edits/approval, error/retry, CSV and responsive layout. Existing mapping/HMR/route lab controls remain.
- Hover panels can be entered, scrolled and used without retargeting while pointer/focus stays inside. Short dwell/transfer protection, viewport-constrained height and corrected descendant `pointerleave` handling preserve native actions; AI remains explicitly opt-in and is not dispatched by panel entry.
- See [usage](playgrounds.md), [ADR 0014](adr/0014-interactive-hover-and-commerce-playgrounds.md) and [executed validation](hover-playground-validation.md). This follow-up does not authorize another phase or release.

## Current product status

| Area                             | Status                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts/errors/logging  | Implemented, including local bridge settings/bootstrap/events                                                                                                                                                                            |
| Vite integration/local transport | Implemented for standalone HTTP loopback Vite 8.3.5+; HTTPS/middleware mode explicitly unsupported                                                                                                                                       |
| Browser inspector                | Compact/expanded Shadow DOM UI, original/translation, progressive source/AI evidence, copies/search/filter, locales/themes, route/keyboard interactions and accessibility tests                                                          |
| React source analysis            | Safe JSX mapping plus bounded source analysis for components/props/conditions/handlers/hooks/state/API/navigation; runtime outcomes remain unverified                                                                                    |
| Claude, translation, follow-ups  | Node provider plus progressive source-backed translation/analysis UI implemented; explicit opt-in, digest-only browser requests and separate translation cache; follow-ups/live authenticated quality pending                            |
| Pre-analysis/persistent cache    | Phase 07 scheduling, AST workers, progressive status and hash-validated memory reuse implemented; worker-owned SQLite layers, watcher invalidation and inspection/clearing added by Phase 08; whole-project latency benchmarking pending |
| CLI/configuration/editor         | Typed file/mode/inline configuration, setup/doctor/status/cache/analyze/open, Claude/bridge diagnostics, shortcuts/depth/exclusions/debug and guarded VS Code/Cursor source navigation implemented                                       |
| Complete testing/release         | Phase 02–11 infrastructure/browser/mapping/static/provider/pre-analysis/cache/inspector/config/editor gates implemented; live authenticated AI, later feature journeys and release preparation pending                                   |

Runtime guards and passing infrastructure tests do not establish complete source mapping, provider security, source-backed inspector explanations, or product readiness.

## Retained historical work and usage

Phase 11 reactivates `packages/next-plugin`, `packages/vue-plugin` and the Next/Vue/Nuxt apps with real implementation and verification. Their prior counters/source remain extended rather than deleted. New packages are `server` and `nuxt-module`. Lockfile importers and workspace targets include only the eleven libraries and four apps.

Historical `tests/unit/boundaries.test.ts` and `tests/e2e/playgrounds.spec.ts` remain preserved and excluded; the active boundary checker and `frameworks.spec.ts` cover current behavior. Further frameworks remain unauthorized. Deleting unrelated or completed source still requires explicit owner approval.

## Remaining delivery gates

Deliver conversational follow-ups, authenticated model quality verification, whole-project cache/performance hardening, wider accessibility/failure coverage and release preparation. Phase 10 delivers configuration/diagnostics and source editor navigation within its documented native local envelope. Resolve NPM scope ownership/licensing/release policy before release. Keep all F01–F18 acceptance criteria; no publication or later phase is authorized by this status update.

## Future Roadmap

Angular, Svelte and further integrations require separate owner authorization. Phase 11 does not automatically begin subsequent work.
