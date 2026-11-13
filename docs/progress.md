# DevAnalyst progress

**React + Vite + TypeScript is the only currently supported framework combination.** The full [18-feature plan and Definition of Done](implementation-plan.md) remain required. Phase 03 Browser Element Inspector was separately authorized by the owner and delivered ahead of React mapping; [ADR 0005](adr/0005-browser-element-inspector.md) records the sequencing. Phase 04 source mapping was separately authorized and implemented within the documented safe JSX envelope; see [ADR 0006](adr/0006-react-source-mapping.md). Phase 05 now adds the bounded static analysis API; [ADR 0007](adr/0007-static-analysis-engine.md) defines its source-only confidence semantics. Phase 06 adds the opt-in Claude Code provider API; [ADR 0008](adr/0008-claude-code-provider.md) records its runtime controls and compatibility. No later work starts automatically.

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
- See [Phase 06 validation](phase-06-validation.md), [usage](claude-code.md) and [ADR 0008](adr/0008-claude-code-provider.md). Browser result/translation/follow-up UI, background scheduling, persistent cache and editor opening remain pending.

## Current product status

| Area                             | Status                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts/errors/logging  | Implemented, including local bridge settings/bootstrap/events                                                                                                                       |
| Vite integration/local transport | Implemented for standalone HTTP loopback Vite 8.3.5+; HTTPS/middleware mode explicitly unsupported                                                                                  |
| Browser inspector                | Route/connection runtime plus local DOM selection, Shadow DOM UI, metadata, hover/modifier/context actions, themes and keyboard/accessibility tests                                 |
| React source analysis            | Safe JSX mapping plus bounded source analysis for components/props/conditions/handlers/hooks/state/API/navigation; runtime outcomes remain unverified                               |
| Claude, translation, follow-ups  | Node CLI provider, guarded context, permissions and structured Vietnamese explanation/translation API implemented; browser composition and live authenticated model success pending |
| Pre-analysis/persistent cache    | Interfaces only; scheduling, SQLite, invalidation and performance verification pending                                                                                              |
| CLI/configuration/editor         | Help/version/dev/doctor and schema validation implemented; config-file loader, operational utilities/editor opening pending                                                         |
| Complete testing/release         | Phase 02–06 infrastructure/browser/mapping/static/provider gates implemented; live authenticated AI, complete UI journeys and release preparation pending                           |

Runtime guards and passing infrastructure tests do not establish complete source mapping, provider security, source-backed inspector explanations, or product readiness.

## Retained historical work and usage

| Historical artifact                                                   | Current disposition                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/next-plugin`, `packages/vue-plugin`                         | Original configuration interfaces/manifests retained; excluded from active workspace, references, checks, and release scope      |
| `apps/playground-next`, `apps/playground-vue`, `apps/playground-nuxt` | Source/configuration retained; excluded from active installation, startup, lint/type/build, browser tests, and CI                |
| `tests/unit/boundaries.test.ts`, `tests/e2e/playgrounds.spec.ts`      | Preserved historical tests; active React-only boundary and bridge suites have separate targets                                   |
| Previous dependency/importer entries                                  | Removed from the active lockfile through pnpm regeneration; retained historical manifests are not workspace installation targets |

These are preserved files, not current support or future implementation commitments. Do not develop, configure, install dependencies for, or execute unsupported framework work. Deleting completed source still requires explicit owner approval.

## Remaining delivery gates

Deliver inspector analysis presentation and richer source evidence/editor integration, opt-in read-only Claude explanations/translation/follow-ups, pre-analysis, persistent caches/invalidation, editor navigation, configuration/diagnostics completion, measured performance, accessibility/failure hardening, and release preparation. Resolve NPM scope ownership/licensing/release policy before release. Keep all F01–F18 acceptance criteria; no publication or later phase is authorized by this status update.

## Future Roadmap

Next.js, Vue, Nuxt, Angular, Svelte, and other frameworks have no active milestones or tests. Expansion requires explicit owner authorization after complete React + Vite delivery.
