# ADR 0011: Translation and AI inspector presentation

Date: 2026-11-13. Status: accepted for the owner-authorized Phase 09. Scope: React + Vite + TypeScript, DevAnalyst and `@devanalyst/*`.

## Decision

Extend the native Shadow DOM inspector accepted in [ADR 0005](0005-browser-element-inspector.md). Separate the browser presentation/client reducer from Node source projection, queue composition, Claude execution and SQLite. Serve explicitly exported browser modules through the existing development-only asset allowlist; do not add a UI framework/bundler migration.

The authenticated bridge adds closed `inspector.request`, `inspector.cancel` and `inspector.update` contracts. Requests contain registered JSX identity/revision, route, mode and an optional normalized text SHA-256 digest. They contain no DOM text, form values, HTML, props, arbitrary questions or file-read commands. Node requires a current registered mapping and current guarded source hashes. Unsupported/private contexts fail closed. Route changes, disconnects, replacement selection, source changes and shutdown cancel obsolete jobs.

Three independent lanes carry translation, deterministic analysis and optional AI explanation, using the existing six analysis states. Updates contain at most four bounded evidence items per frame and at most 80 displayed items per lane. Browser reuse is bounded to 16 selections and visibly stale until checked. Invalidation demotes retained facts to UNKNOWN and rejects late responses before another request is issued. Shared deterministic AST work uses Phase 07 workers and persistent hooks; selected analysis also works when automatic page pre-analysis is disabled.

## Translation and consent

A small exact Japanese-to-Vietnamese glossary provides an immediate local candidate, labeled UNKNOWN until source provenance is confirmed. Node extracts static JSX literals/labels separately from business analysis during the existing JSX instrumentation pass. These descriptors stay on Node; the browser receives the existing structural mapping manifest only. Controls, private/editable ancestors, dynamic/custom children and oversized literals cannot become source-backed translation input. Literal extraction is bounded to 100 nodes, 500 text characters and 2,048 source characters.

Matching static text and digest permit source-backed glossary or persistent translation reuse without waiting for AST graph analysis. Unknown glossary terms may use the existing Claude translator only after an explicit expanded inspection and configured `ai.enabled`/`permittedPaths`. This is separate from optional automatic `preanalysis.backgroundAI` consent. Hover never dispatches a new provider job. Original application text stays unchanged. Dynamic runtime text remains local; unsupported translation is visibly unavailable rather than fabricated.

Translation and business explanation use separate bounded provider instances so a deep job cannot hold the translation queue. Each instance has one active inference and retains Phase 06 queue/context/budget/deadline/process-group/no-tools controls. Active selections are capped at 32. AI remains disabled by default. Source excerpts and source-literal text may be transmitted under explicit configured consent; no browser values are included. [ADR 0008](0008-claude-code-provider.md) remains the execution and trusted administrator boundary.

## Evidence and persistence

Project findings from the selected AST element through bounded handler/call/callback reachability, excluding unrelated sibling handlers. Construct selected source paths with edge confidence and explicit limits; show source facts, lexical visibility/disabled guards, API/navigation/state declarations and unresolved targets. VERIFIED is source evidence, never observed execution. Model prose remains at most INFERRED. Render every string as text, with inline clickable relative-file/range evidence and keyboard-accessible excerpts. Editor launching remains outside this phase.

Translation and selected explanation use distinct element identities/namespaces, source/dependency/missing-file/alias fingerprints, provider/model, source/AI policy, language and presentation-schema versions. Source-only explanations deliberately omit route/runtime values from prose and share across routes. Translation identity additionally includes the matching source-literal digest. Cache operations remain asynchronous in the SQLite worker. Persistence errors surface through existing safe diagnostics without discarding current source facts; explicit cache clear also invalidates inspector memory. Sensitive source/provider content is omitted under the cache disclosure policy.

## UI and consequences

Passive hover stays pointer-transparent. Alt+Click, keyboard inspection or the explicit expand control opens detailed, pinned inspection. Preserve native host interaction, source maps, selection ranges, focus restoration and accessible frame/shadow-root boundaries. Consume the click paired with an inspection pointer-down: opening a larger panel can change the mouse-up target and must not select its common ancestor.

The panel supplies original/translation, progress/partial/stale/cache indicators, confidence filters, call search, source excerpts and separate copy actions. English, Vietnamese and Japanese chrome and system/light/dark themes persist only their two display preferences locally. Vietnamese provider explanations retain an explicit language label; changing chrome language does not pretend to retranslate AI prose. Responsive dimensions and scrolling stay inside the viewport; the panel is nonmodal.

Tests use real React, Vite, Chromium, guarded AST workers and SQLite with an owned mock Claude subprocess for provider behavior. They do not establish authenticated model quality, arbitrary dynamic-language coverage, universal React mapping, other browser/OS coverage or a whole-project latency SLA. See [usage](../inspector-ui.md) and [validation](../phase-09-validation.md).
