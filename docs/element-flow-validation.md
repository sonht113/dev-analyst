# Element flow inspector follow-up validation

The owner requested a concise panel showing Japanese-to-Vietnamese text translation and source-backed element behavior for testing. See [ADR 0015](adr/0015-element-flow-summary.md) and [UI scope](inspector-ui.md).

Implemented and exercised:

- Collapsed technical findings/filters/metadata, bounded flow summaries and per-entry evidence/cache/timestamp disclosures.
- Direct JSX/Vue display expressions and bounded lexical declarations, with Vue loop shadowing preserved; native anchor literals and uncertain dynamic destinations.
- Rendering guards separated from conditions inside handler outcomes; unrelated sibling handlers remain excluded.
- Public `value` findings validated across cache payloads, shared protocol and browser decoder. Static and selected-AI cache identities changed to reject obsolete projections/prompts.
- Concise optional Vietnamese AI question under the existing source permissions, consent and enforced no-tools provider policy.

Executed locally on 2026-11-19:

- `pnpm lint`: ESLint, workspace boundaries and repository formatting passed.
- `pnpm typecheck`: all eleven active packages and four playgrounds passed.
- `pnpm test`: **39 files, 359/359 unit/integration tests passed**, including production exclusion, cache, bridge, source-policy and provider regressions.
- `pnpm build`: eleven packages and all four playground production builds passed.
- `pnpm test:e2e`: **57/57 passed**, including React/Vue/Nuxt/Next Webpack/Turbopack, source value provenance, progressive translation, collapsed details, copy/filter/source actions, mobile locales/themes, privacy, HMR, cache reuse and ordinary host interaction.
- Dark mobile screenshot visually inspected: bounded viewport, readable translation/flow and working internal scroll.
- Local links in the six touched documentation files and `git diff --check` passed.

Initial browser runs exposed a helper module outside the bridge asset list and a missing `value` group in the browser decoder. Both were fixed before the final successful E2E run; a protocol/decoder compatibility regression now covers every public group. No passing checks were obtained by weakening privacy, evidence or host-behavior assertions.

Limits: declarations are source relationships, not observed values or complete API-to-state dataflow. Source-only event outcomes do not prove actual calls or navigation. No live authenticated Claude result is claimed: provider journeys use the owned subprocess fixture. Existing unrelated uncommitted Phase 10/11 work is preserved; no commit or publication was performed.
