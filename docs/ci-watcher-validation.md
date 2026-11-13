# CI follow-up — native file-watcher synchronization

The owner reported both pushed Phase 03–06 commits failing CI. This follow-up fixes test fixture synchronization; it does not change production Vite behavior, mapping policy, permissions, the workflow matrix, retries or test exclusions.

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
