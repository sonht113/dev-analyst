# Interactive hover and commerce playground validation

Date: 2026-11-16. Owner follow-up to Phase 11, within the four already authorized apps. See [ADR 0014](adr/0014-interactive-hover-and-commerce-playgrounds.md) and [usage](playgrounds.md). Existing Phase 10/11 changes and setup documentation remain in the working tree; no commit, push, publication or later phase is included.

## Behavior and evidence

The hover panel now has a short target dwell, a narrow trigger-to-panel transfer corridor and pointer/focus hold. Entering enables controls without stealing focus or implicitly pinning; scroll and native text selection work inside the panel. Escape restores prior host focus. Initial previews remain click-through. Available-side height constraints prevent asynchronous content from growing over a pending host click. The original failure included document capture treating descendant `pointerleave` events as viewport exit; only actual document exit now dismisses after a short grace.

`inspector.spec.ts` adds two browser cases for slow gap transfer, identical runtime/source identity, native text selection, panel-only wheel scrolling, pinning, focus hold and Escape restoration. Existing native controls, unpin, editable shortcuts, frames/shadow roots, dynamic DOM/HMR, disconnected/removed nodes, privacy and teardown assertions remain unchanged. `analysis-ui.spec.ts` additionally enters, focuses and scrolls the panel with the mock AI provider enabled and proves no inference was dispatched. Provider tests use owned executable fixtures, not an authenticated live model.

The React, Vue, Next and Nuxt apps now contain a 36-order commerce dashboard with derived KPIs, search/status/sort/pagination, keyed rows, UI role conditions, pending-only bulk approval, quantity/priority/note drawers, CSV and an activity/pipeline view. Each has real same-origin GET/POST endpoints with synthetic process-local data. Next preserves explicit client/server boundary examples; Vue retains keyed/async Composition API fixtures; Nuxt retains native page navigation. The old lab controls remain small regression anchors. A separate read-only lab probe keeps an explicit handler→service→POST reference verifiable; complex guarded business paths retain their actual conservative confidence rather than being promoted.

Five native browser commerce journeys cover React/Vite, Vue/Vite, Nuxt/Vite, Next/Webpack and Next/Turbopack. They assert actual responses, unknown action/invalid quantity (400), oversized request (413), invalid repeated approval (409), role/read-only conditions, edit persistence, bulk state change, actual 503/retry, multiline CSV excluding private form notes, mobile viewport width and no uncaught page errors. Existing exact mapping, HMR and navigation/pre-analysis tests also pass. Native production tests still build/serve all configurations and verify DevAnalyst injection, bridge endpoints and private runtime markers are absent.

## Executed checks

Environment: macOS ARM64, Node.js 22.23.2, pnpm 10.33.0, installed Chromium, pinned repository framework versions. Loopback/native process checks ran with the required sandbox authorization.

- `pnpm test:e2e`: **56 passed**, one worker, 1.3 minutes.
- `pnpm test`: **355 passed in 38 files**, 20.88 seconds, including native production integration checks.
- `pnpm typecheck`: passed for the eleven packages and four apps.
- `pnpm build`: passed for all packages and four native app production builds.
- `pnpm lint`: passed, including ESLint, package boundaries/cycles and repository formatting.
- `pnpm test:packages`: passed for eleven explicit package exports/declarations/maps/archives and CLI executable checks.
- `git diff --check`: passed; 258 local README/AGENTS/docs links resolved without broken paths.

An earlier full E2E run exposed Next lab API confidence and native alert-selector issues, both corrected without relaxing source-confidence assertions. A unit run overlapping full E2E/native servers missed an existing short bridge progress poll; the final full run above was sequential and passed. These observations do not establish wider load reliability.

The existing hover burst probe recorded **1,000 pointer events, 2 target geometry reads, 5.60 ms synchronous dispatch** in the final E2E run. This is a synthetic local observation, not end-to-end panel latency or a benchmark/SLA. Numeric artifacts and dashboard/mobile screenshots are in ignored `test-results/`; the React commerce screenshot was visually inspected.

After rebuilding/restarting all four apps, the existing headed Playwright MCP session was reused for manual verification on the React dashboard. Hover→panel entry reported `interacting: true`, `pinned: false` and the correct `src/App.tsx:359:13` source for 保存. Explicit expansion completed static analysis; a 650 px wheel action scrolled the panel by 650 px while host page scroll stayed unchanged. All four dashboard tabs were reloaded and the servers were left running for owner exploration. These are local observations, not additional automated test cases.

## Limits

- Demo state resets on server restart or explicit reset. Role selection illustrates UI guards; it is not authentication or server authorization. No database, external business service or disk record storage is added.
- Hover/focus/scroll do not enable AI. Source mapping and analysis keep framework-specific exclusions, source evidence, stale labels and UNKNOWN fallbacks. Static relationships do not prove execution.
- Large/overlapping content may need explicit Alt+Click or Inspect mode. Cross-origin/closed roots, unusual transformed frames and top-layer limitations remain. Source invalidation/unmount can demote or close a held panel.
- This does not verify live authenticated Claude, interactive editor GUI, Windows/Linux, unsupported framework configurations, full accessibility or product/release completion. No new dependencies, packages or framework targets are added.
