# Phase 09 validation — Translation and AI inspector UI

Date: 2026-11-13. Scope: React + Vite + TypeScript, seven active packages and the confirmed DevAnalyst identity. Initial Git status contained uncommitted Phase 07/08 work; it is preserved. No commit, push, package publication or external-service mutation is authorized or performed.

## Implemented and observed

- Native Shadow DOM compact/expanded inspection, original Japanese text, independent Vietnamese translation and deeper deterministic/optional AI presentation. Local glossary and validated cache reuse do not wait for business analysis. Hover does not call Claude; explicit expanded inspection retains enabled/path consent and Phase 06 runtime controls.
- Scoped handlers/call paths, source visibility/disabled guards, API/navigation/state declarations, UNKNOWN boundaries and VERIFIED/INFERRED distinctions. Inline relative-file/range evidence is keyboard accessible and does not change host navigation. All content uses text rendering.
- Per-lane loading/partial/stale/failure/cache status, bounded progressive chunks, late-result rejection, source-change demotion, selection/route/disconnect cancellation and nonblocking AST/SQLite/provider work.
- Independent copy actions, call search/confidence filters, localized English/Vietnamese/Japanese chrome, persistent display preferences, dark/light/system themes, mobile positioning, keyboard access, focus and text-selection preservation.
- Matching static-literal provenance/digest instead of raw DOM transmission; private/dynamic/control content is excluded from provider translation. Translation and selected explanation caches use distinct identities with source/model/policy/schema dependencies and survive actual dev server restart without repeat inference.

## Executed checks

Local environment: Darwin arm64, Node 22.23.2, pnpm 10.33.0, TypeScript 6.0.3, Vite 8.3.5, React 19.3.1 and Playwright Chromium. Loopback/browser/subprocess suites require the approved outside-sandbox runner. Node's experimental SQLite warning remains visible.

| Check                             | Observed result                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm lint`                       | ESLint zero warnings, package/browser boundaries, cycles and formatting passed                    |
| `pnpm typecheck`                  | Seven packages, root tooling/tests and React fixture passed                                       |
| `pnpm test:smoke`                 | **307 unit/integration tests in 28 files + 39 Chromium E2E tests passed**                         |
| HMR regression, `--repeat-each=5` | 5/5 consecutive targeted runs passed                                                              |
| `pnpm test:independent`           | All seven libraries built from cleared prerequisite outputs                                       |
| `pnpm build`                      | Libraries and real React production build passed; build restored after independent checks         |
| `pnpm test:packages`              | Public exports, private import rejection, declarations/maps, local packaging and CLI smoke passed |
| Deferred-validation regression    | Analyzer queue suite passed 18/18 after final test typing cleanup                                 |
| Documentation / whitespace        | Local links checked in nine changed guides/rules; `git diff --check` passed                       |

The final aggregate log is the local temporary artifact `/private/tmp/devanalyst-phase09-smoke.log`. Screenshots and measurements are ignored generated outputs, not committed product assets. All aggregate tests passed without retries or skips. No authenticated Claude success is claimed.

## Regressions found and corrected

- A growing panel could change the mouse-up target after an inspection pointer-down, causing its subsequent click to select an ancestor. The paired click is now consumed. Existing SVG/frame/lazy/metadata/selection regressions verify original targeting and host behavior.
- Wide DOM sibling lists exhausted the extraction budget before visiting any text. Extraction now reserves bounded descendant visits; the existing 2,000-sibling case verifies nonempty Japanese text and retained user selection through geometry updates.
- Source invalidation previously left a window in which a late old request could restore current confidence. Invalidation now rejects that request before another selection is sent. Browser transition observations require stale facts to be UNKNOWN; HMR retains React state and replaces the translation from the new source.
- Source mapping disposal now emits a data-free local invalidation immediately, so old analysis is demoted before the next paint rather than racing the deferred Node watcher notice. The HMR regression passed 5/5 consecutive targeted runs and the final aggregate.
- Persisted AI could report READY while its static source validation was still awaiting I/O. Readiness now follows successful validation; a deferred-validation unit regression proves no explanation is exposed early.
- Invalid selected analyzer/provider configuration now reports FAILED lanes and safe diagnostics while the host Vite server and DOM inspector remain available. An authenticated bridge regression verifies the host still responds and all three lanes terminate explicitly.
- Source paths now originate at the selected element rather than taking an arbitrary global trace. Bounded breadth-first reachability excludes sibling handlers, respects depth and propagates uncertain edge confidence. Provider/persistence failures preserve current deterministic facts; persistence diagnostics are surfaced explicitly.

## Performance observations

The final small-fixture provider-failure UI case recorded 30 animation frames while results progressed: maximum 16.80 ms and mean 16.19 ms. The retained hover-burst case dispatched 1,000 pointer events in 3.30 ms with two geometry reads. Numeric artifacts are `analysis-ui-frame-observations.json` and `hover-measurement.json` under the corresponding ignored Playwright test result folders.

These are single local observations, not benchmark distributions, a universal no-jank guarantee or the product-wide cache latency target. The cold/warm mock-provider tests prove ordering and absence of extra inference, not live provider speed or translation accuracy. Mobile light/dark screenshots were visually inspected; the light capture also shows retained history labeled UNKNOWN/stale during revalidation.

## Coverage and limits

New source-literal tests exercise nested/entity text, server-only provenance, dynamic/private descendants, ancestor controls and bounds. Client tests cover wire confidence validation, digest-only requests, private exclusion, stale/late selection results, partial chunks and bounded session reuse. Real analyzer projection verifies selected handler → imported service → API evidence, source paths, unrelated sibling exclusion and UNKNOWN unsupported scope.

Authenticated bridge integration exercises selected inspection with automatic pre-analysis disabled, a forged source identity and rejection of injected raw runtime text. Actual React/Vite/Chromium tests exercise fast hover, progressive translation/analysis, source links, call search/filter, copies, AI-disabled/provider-error states, locales/themes/mobile/keyboard, runtime privacy, HMR and persistent translation/analysis reuse after server restart. The owned mock executable simulates Claude's CLI protocol with controlled independent delays and malformed output. It is not authenticated model success or a translation-quality evaluation.

Phase 09 adds 17 unit/integration cases and eight browser cases to Phase 08’s 290/31 baseline.

Screenshots and numeric frame observations are generated under ignored `test-results/`. Visual inspection covers mobile dark/light layout. Existing production tests additionally reject Phase 09 module/message/glossary markers in the real host build. No other framework fixtures are installed, extended or tested.

Supported JSX provenance and source analysis retain their documented safe envelope. Unsupported/dynamic runtime text may lack translation; it stays local. Japanese/English UI preference does not change Vietnamese provider prose. Clickable evidence expands a source excerpt; VS Code/Cursor launching and conversational follow-ups remain later phases. Other browsers/OS versions, authenticated provider quality and whole-project latency remain unverified. These results do not claim product completion.
