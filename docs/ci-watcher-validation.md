# CI follow-up — watcher synchronization and dynamic frames

The owner reported both pushed Phase 03–06 commits failing CI. Commit aa76d23 fixes test fixture synchronization without changing production Vite behavior, mapping policy, permissions, the workflow matrix, retries or exclusions. Its next hosted run exposed an additional runtime race in dynamic iframe listener attachment, addressed in the subsequent fix below.

## Hosted failure evidence

- [Run 43353974447](https://github.com/sonht113/dev-analyst/actions/runs/43353974447), implementation commit `59caac4`: both Linux Node 22.23.2 and Node 24 jobs passed lint, typecheck, unit/integration, independent builds, production build and package checks, then failed the mapping E2E syntax-error recovery assertion. The heading remained `Mapping fixture` rather than `Corrected mapping`.
- [Run 43354344601](https://github.com/sonht113/dev-analyst/actions/runs/43354344601), handoff commit `f84d6da`: Node 24 reached the same E2E failure. Node 22 failed earlier while awaiting a `source.changed` message in the real bridge integration test (244/245 other tests passed).

These are actual hosted failures. The earlier macOS validation results in the phase reports remain historical local observations, not evidence that those commits had passed hosted CI.

## Diagnosis

The mapping fixture used macOS's default watcher path locally; Linux CI uses Chokidar's native `fs.watch` handler. Explicitly selecting `useFsEvents:false` and `usePolling:false` reproduced the same heading failure **3/3 times on macOS** before the synchronization fix. This exercises the native handler, not a Linux kernel/container.

A temporary metadata-only timeline from the failing case showed:

| Observation                                 | Elapsed from edit start |
| ------------------------------------------- | ----------------------- |
| Native `change`                             | 0.92 ms                 |
| Invalid source write completed              | 1.80 ms                 |
| Mapping became stale/UNKNOWN                | 4.64 ms                 |
| Corrected source write completed            | 4.94 ms                 |
| Vite returned failed compilation (HTTP 500) | 11.93 ms                |

The correction occurred before the failed transform had completed, within the native handler's 50 ms same-file change suppression window. Only the first `change` was emitted. This is confirmed by the pinned Vite 8.3.5 bundle's Chokidar handler (`_throttle(EV_CHANGE, path, 50)`), and explains why increasing the heading timeout would not recover the missing notification. Temporary instrumentation was removed; no raw HMR/network payloads or bridge credentials are retained.

The separate bridge failure is consistent with an initial watcher-crawl race: HTTP listening and bridge readiness did not establish that the target source file was already watched. The test previously edited immediately after connecting and allowed only the default one-second poll window.

## Changes

- Run the mapping fixture with the native watcher backend on macOS as well, so local checks cover the previously missed handler.
- Pace distinct simulated editor saves, including restoration, outside that handler's coalescing window. The fixture waits only the remaining part of a 100 ms minimum save interval; this does not alter host Vite configuration or add whole-test retries.
- Wait for an actual HTTP 500 compilation response before testing recovery, while still asserting UNKNOWN/STALE_SOURCE and null source evidence. After correction, assert the updated DOM, VERIFIED mapping, preserved React counter state and unchanged page time origin.
- Wait for `main.js` in the public `watcher.getWatched()` result before mutating the bridge fixture. Allow up to five seconds for watcher readiness and source-message delivery while retaining the exact file/event assertion.

No manual watcher emits, forced reload, mocked HMR, assertion removal, workflow bypass or production polling/stabilization option is introduced.

## Executed verification

Local environment: Darwin arm64, Node 22.23.2, pinned pnpm 10.33.0/Vite 8.3.5 and Playwright Chromium.

- Before fix: native-watcher syntax-error E2E failed 3/3 repetitions.
- After fix: the same targeted E2E passed **10/10 repetitions**, with zero retries configured.
- Targeted real bridge integration passed. A sandbox invocation initially hit loopback `EPERM`; the authorized outside-sandbox invocation passed.
- `pnpm check` passed: lint/boundaries/formatting, strict typecheck, **245 unit/integration tests**, production build and all package checks.
- `pnpm test:e2e` passed all **26 Chromium E2E tests**, including the native-watcher fixture. The new commit's hosted Node 22/24 outcome is visible in its Actions run; local results alone do not assert hosted success.

## Dynamic iframe follow-up

[Run 43361696098](https://github.com/sonht113/dev-analyst/actions/runs/43361696098) for `aa76d23` confirms the watcher fixes: the Node 24 job passed every step, while Node 22 passed all earlier checks and the mapping case but failed first selection of `Frame button` in a dynamically inserted iframe.

The runtime deferred root/frame discovery by 200 ms. A same-origin frame could complete loading and receive its first inspection click before delegated listeners were attached. That click was lost; discovering the document later could not replay it. A deterministic browser regression inserts an about:blank frame and immediately dispatches an Alt inspection click from its load handler; it failed **3/3 repetitions** with the previous runtime. This supplements the existing real Playwright-click/frame-geometry test.

The inspector now captures iframe load events in each observed parent document and runs the existing bounded discovery immediately, before the target's load handler can inspect its child. It does not cancel load, patch application code or scan on hover; document cleanup removes this listener with the existing delegates. Cross-origin/closed-root boundaries and discovery caps remain unchanged.

After rebuilding the runtime, the deterministic first-click regression and existing nested-frame/Shadow DOM case passed **20/20 executions** (ten repetitions of each), without retries. The full local `pnpm check` passed again (245 unit/integration tests, lint, typecheck, build and package checks), followed by all **27 Chromium E2E tests**. The next hosted matrix must independently validate both Node versions before CI recovery is reported.

## Phase 11 bridge fixture follow-up

[Run 44477675408](https://github.com/sonht113/dev-analyst/actions/runs/44477675408) for `ab1b958` passed the complete Node 24 job. Node 22.23.2 passed lint/typecheck, then failed two bridge integration waits: page analysis had not completed within the default one-second poll, and the selected-inspection fixture missed the `src/Save.tsx` source-add notification within three seconds. The remaining 357 tests passed. These are hosted observations, not failures of the Japanese UI assertions.

The fixture returned after HTTP/bridge readiness, independently of native watcher source discovery. Its new-file writes could overlap the initial crawl, and one case transformed/queued analysis before the add notification finished source invalidation. The bridge fixture now selects the native watcher backend on macOS too, waits for the existing `main.js` entry using Vite's normalized root, and observes the genuine `Visible.tsx` add message before registering/requesting analysis. The selected-inspection case shares the readiness barrier. Source-add waits remain bounded at five seconds; AST completion uses the ten-second bound already used by the real worker integration tests. This keeps worker startup under concurrent native builds separate from a one-second assertion deadline.

The exact registration, forged-source rejection, scoped findings, source-change delivery and disconnected-page assertions remain in place. The fix changes test synchronization only; runtime limits, workflow matrix and retry policy are unchanged. Hosted Node 22/24 results for the corrective commit must be checked before declaring CI recovery.

Local corrective validation on Darwin arm64 / Node 22.23.2: all 29 bridge integration tests passed; the two reported cases passed ten consecutive runs each (20 executions, no retries). `pnpm check` passed lint/boundaries/formatting, typecheck, all 359 unit/integration tests, all application builds and all eleven package checks. `pnpm test:e2e tests/e2e/bridge.spec.ts` passed all six Chromium bridge journeys. These local results do not establish the new hosted matrix outcome.

## Frame highlight sampling follow-up

[Run 44480227660](https://github.com/sonht113/dev-analyst/actions/runs/44480227660) for `b262062` passed the formerly failing unit/integration stage on both Node versions; Node 22 completed its entire job successfully. Node 24 reported one failure among 57 E2E tests: the scaled same-origin iframe geometry assertion received a null bounding-box sample after the expected iframe metadata had already been selected. Its uploaded screenshot shows the pinned frame button and its highlight.

Inspector renders replace highlight DOM nodes on progress/resize updates. A one-shot Playwright `boundingBox()` sample can therefore lose its node between selection and geometry measurement. The iframe assertion now reacquires both target and highlight geometry through bounded `expect.poll`, as the existing SVG/scroll/resize geometry test already does. Missing geometry cannot pass; the assertion retains the two-pixel bound and now includes width/height as well as position. Native iframe clicks, nested-frame selection, shadow/opaque boundary checks and runtime rendering are preserved.

The corrected iframe case passed 20/20 local Chromium repetitions with zero retries, followed by all 57 E2E tests. Lint/boundaries/formatting and strict workspace typecheck passed again. The earlier 359-test, build and package validation applies to the unchanged runtime; this follow-up changes only the browser assertion and this report.
