# DevAnalyst implementation plan

**React + Vite + TypeScript is the only currently supported framework combination.** This plan retains the complete product feature set, including Claude Code CLI integration, browser inspection, and React source analysis. It schedules no other framework work. The [permanent scope rule](../AGENTS.md) and [ADR 0003](adr/0003-react-vite-scope.md) take precedence over historical prompts.

This document is a roadmap, not authorization to begin a development phase. Phase 02 was explicitly authorized for Vite integration and the local bridge; see [progress](progress.md) and the [Phase 02 report](phase-02-validation.md) for actual status. The owner separately authorized **Phase 03 — Browser Element Inspector**, delivered before React mapping; see [ADR 0005](adr/0005-browser-element-inspector.md). The owner then authorized **Phase 04 — Reliable DOM-to-Source Mapping**; see [ADR 0006](adr/0006-react-source-mapping.md). The owner then authorized **Phase 05 — Static Code Analysis Engine**; see [ADR 0007](adr/0007-static-analysis-engine.md). The owner then authorized **Phase 06 — Claude Code CLI AI Integration**; see [ADR 0008](adr/0008-claude-code-provider.md). Later work does not begin automatically.

## Required feature coverage

| ID  | Required React + Vite capability                                     | Required acceptance evidence                                                                                             |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F01 | Automatic development-only Vite Plugin API integration               | Real Vite lifecycle, teardown, host failure isolation, and production exclusion tests                                    |
| F02 | Hover, Alt+Hover, Alt+Click, and custom right-click actions          | Browser interaction and keyboard tests; normal browser/app behavior remains available                                    |
| F03 | Japanese-to-Vietnamese UI text translation                           | Validated translation output, uncertainty/error states, cache reuse, original text preserved                             |
| F04 | Reliable DOM-to-JSX source mapping                                   | Realistic nested/conditional/list/lazy/HMR fixtures, source maps preserved, ambiguity reported                           |
| F05 | React component identification                                       | Evidence-backed component/file references across wrappers and nested components; unsupported patterns explicit           |
| F06 | Props and conditional rendering analysis                             | AST/source evidence for props and conditions; runtime assumptions labeled                                                |
| F07 | Event handler and callback tracing                                   | Verified source call relationships across supported callbacks/files, uncertainty for dynamic behavior                    |
| F08 | State management and hook analysis                                   | React hook/state dependencies and state-change evidence; unsupported state patterns explicit                             |
| F09 | API call detection and tracing                                       | Source-backed call chains and endpoint expressions; no invented endpoints or runtime execution claims                    |
| F10 | Navigation/routing analysis, including React Router where applicable | SPA route changes and source-backed destinations, dynamic destinations labeled                                           |
| F11 | Claude Code CLI integration                                          | Installation/auth/quota handling, validated output, cancellation/timeouts, bounded work, enforced read-only execution    |
| F12 | Automatic page pre-analysis                                          | Relevant React file selection, priority/deduplication, accurate incremental progress, cancellation on obsolete routes    |
| F13 | Persistent caching and source-change invalidation                    | SQLite persistence, relevant cache keys, targeted invalidation, stale labels, migration/corruption/size tests            |
| F14 | Floating inspector with source evidence                              | Isolated accessible UI, themes, viewport changes, loading/error states, confidence/evidence display                      |
| F15 | Source navigation to VS Code or Cursor                               | Validated workspace file/position, safe editor invocation, actionable unavailable-editor errors                          |
| F16 | AI follow-up questions about selected elements                       | Selected-element evidence context, opt-in/path restrictions, validated responses, cancellation/error tests               |
| F17 | Configuration, diagnostics, and CLI utilities                        | Validated config loading/defaults, consent controls, useful diagnostics, documented executable commands                  |
| F18 | Automated testing, documentation, and NPM release preparation        | Complete test matrix, executable docs, package/export checks, scope/license/release checks; publication remains explicit |

All rows are mandatory before product completion. Evidence-first findings, privacy, development-only operation, security, performance, accessibility, and host failure isolation apply across the entire matrix.

## Active implementation sequence

The phases below are planned work, with execution requiring a separate owner request. They all target React + Vite.

| Phase                                                       | Deliverables                                                                                                                             | Exit criteria                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 01 — Foundation and scope alignment                         | Reuse completed strict TypeScript tooling/contracts; align active workspace/CI targets without deleting completed work without approval  | Seven active packages and one React fixture identified; scoped tooling is verified before it is described as isolated                      |
| 02 — Vite lifecycle and local services                      | Development-only integration, validated bridge protocol, workspace source access, configuration/diagnostics foundation                   | F01 and relevant F17 checks; production exclusion, origin/authorization/path protections, teardown, graceful failures                      |
| 03 — Browser Element Inspector (explicit owner prompt)      | Local DOM selection/metadata, isolated overlay, context actions, pin/copy/keyboard, accessible frames/shadow roots, SPA/HMR recovery     | Browser/privacy/accessibility/interaction tests; source mapping and editor actions remain pending                                          |
| 04 — Reliable DOM-to-Source Mapping (explicit owner prompt) | JSX/TSX source metadata, component identification, source maps, HMR and ambiguous mapping handling                                       | F04–F05 against realistic React fixtures, including conditional/list/lazy patterns                                                         |
| 05 — Static Code Analysis Engine (explicit owner prompt)    | Props/conditions, callbacks, handlers, state/hooks, API/navigation and React Router evidence                                             | F06–F10 with source-backed findings and explicit unsupported/dynamic cases                                                                 |
| Pending — Analysis evidence UI and editor navigation        | Connect source evidence/editor actions to the Phase 03 UI; complete evidence-specific keyboard/accessibility/themes                      | F02, F14–F15; event preservation, isolation, scrolling/resizing, SPA/HMR/error recovery                                                    |
| 06 — Claude Code CLI AI Integration (explicit owner prompt) | Enforced no-tools Node provider API, opt-in source context, Vietnamese explanations/translation, readiness, bounded subprocess lifecycle | F03/F11/F16 provider foundation; source preservation, auth/quota/timeout/cancellation/schema/privacy tests; UI composition remains pending |
| 07 — Predictive analysis and persistence                    | Route-aware queue, prioritization, incremental updates, layered SQLite caches and invalidation                                           | F12–F13; bounded resource usage, relevant cache identity, stale/corruption/migration handling, measured responsiveness                     |
| 08 — Complete product verification and release preparation  | Finish diagnostics/CLI, full user journeys, performance/security/accessibility hardening, package/docs/release preparation               | F17–F18 and every Definition of Done item; no unfinished capability is deferred to claim completion                                        |

Dependencies between these phases may justify scoped sequencing adjustments documented in an ADR. They do not authorize dropping features or creating generic framework compatibility infrastructure. Disposition of preserved historical code requires explicit owner approval; it is not a deletion step implied by this plan.

## Definition of Done

DevAnalyst is complete only when all of the following hold for React + Vite:

- F01–F18 are implemented, documented, and verified through relevant unit, integration, and real browser tests. Foundation builds and a counter fixture are insufficient.
- DOM-to-JSX mapping preserves behavior/source maps and passes realistic nested, conditional, repeated, lazy-loaded, SPA, and HMR cases. Ambiguous and unsupported patterns are reported explicitly.
- Component, props/conditions, handler/callback, state/hook, API, and routing explanations distinguish verified static relationships from runtime execution and include actual source evidence. Missing evidence yields `UNKNOWN`.
- Inspector interaction, translation, follow-ups, source evidence, and VS Code/Cursor navigation work together without altering application text, normal browser behavior, or sensitive input handling.
- AI is explicitly enabled by the user, limited to permitted sources, enforced read-only at runtime, protected against secret disclosure, and resilient to missing CLI, authentication/quota failures, invalid output, cancellation, and timeouts. Provider transmission is disclosed.
- Page pre-analysis and caches deduplicate/bound work, invalidate affected results on source/dependency changes, label stale results, and recover from corruption/migration issues without persisting sensitive runtime values.
- Production builds contain no inspector injection, running AI bridge, development endpoints, or leaked local source paths, with automated proof. DevAnalyst failures do not block the host app or HMR.
- Accessibility, themes, keyboard/mouse operation, scrolling/resizing, SPA navigation, lazy loading, loading/error states, disconnects, source changes during analysis, and recovery are covered.
- Performance is measured under documented conditions, including the cached response target below 100 ms and bounded depth, queues, concurrency, and memory; limitations and regressions are recorded honestly.
- React-only lint, typecheck, unit/integration tests, builds, E2E journeys, package/export/dependency-boundary checks, and CI pass. Historical framework checks are not release gates for the current product.
- Configuration, diagnostics, CLI, executable documentation, install/build/package workflows, security/privacy guidance, and release artifacts are ready. NPM scope ownership, licensing, versioning, and release policy are resolved before release; package publication requires explicit authorization.

## Future Roadmap

Next.js, Vue, Nuxt, Angular, Svelte, and other frameworks are deferred possibilities with no active phase, deliverable, dependency, package, playground, adapter, or test allocation. Finish complete React + Vite support before considering them. Any expansion requires an explicit project-owner scope change and an ADR; completing this roadmap does not automatically authorize another framework.
