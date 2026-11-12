# Phase 01 validation

> Historical validation snapshot from the previous Phase 01 scope. The counts and commands below are preserved as completed work, not current support claims or instructions to rerun unsupported frameworks. React + Vite is the only current supported combination. Use [testing](testing.md) for current acceptance and [progress](progress.md) for remaining work; this documentation update did not rerun the historical suite.

Implemented and checked locally on 2026-11-12 using macOS/Darwin 24.1.0 arm64, Node.js 22.23.2, and pnpm 10.33.0.

## Executed checks

| Command                                    | Result                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                             | PASS; all 14 workspace projects installed and lockfile synchronized                                                                   |
| `pnpm install --frozen-lockfile --offline` | PASS after dependency download; validates the local cached install                                                                    |
| `pnpm typecheck`                           | PASS for nine packages, tools/tests, example config, and four apps; also passed after browser dev servers generated route types       |
| `pnpm test`                                | PASS: 45 tests across six files                                                                                                       |
| `pnpm build`                               | PASS: nine packages and four framework-native production builds                                                                       |
| `pnpm test:independent`                    | PASS: each package built with all library outputs removed first; prerequisites built through project references                       |
| `pnpm test:packages`                       | PASS: nine public ESM entry points, private subpath rejection, declarations/maps, local archives, and CLI help/version/error behavior |
| `pnpm test:smoke`                          | PASS: four Chromium tests start real dev servers, load pages, and increment counters without page errors                              |
| `pnpm lint`                                | PASS: ESLint with zero warnings, package boundaries, and Prettier                                                                     |

Package archive checks verify public runtime/declaration entry points and source files are included, while test files and incremental build metadata are excluded. Archives are created in temporary directories and removed; nothing is published.

The workspace boundary checker ran successfully: no circular workspace dependencies, undeclared package-source imports, forbidden internal deep imports, cross-package relative imports, or Node.js imports/dependencies in browser packages were reported. Its negative tests cover invalid imports and cycles. Third-party browser compatibility and runtime isolation still require feature-specific checks later.

## Integration regressions resolved

- Nuxt SSR exposed its counter before hydration attached the click handler. The counter now remains disabled until mount; the unchanged increment requirement passes in a real browser without sleeps or retries.
- Next.js development and production route declarations generated duplicate global helpers under strict declaration checking. A supported custom build tsconfig selects production-generated validators and excludes stale development output, while the editor follows the active generated environment references. Strict checking and `skipLibCheck: false` remain enabled. CI checks types after E2E to cover this transition.

An initial full build overlapped the independent-build checker, which deliberately deletes generated package outputs. The final independent check and full build ran separately and passed. Do not run the destructive-to-generated-output independence check concurrently with other builds/watchers.

## Environment and scope limits

The initial `pnpm test:e2e` invocation could not bind localhost in the restricted runner (`EPERM`). The same current Playwright test file then ran successfully through `pnpm test:smoke`, with all four actual servers and Chromium. The smoke command intentionally selects the playground file; `test:e2e` selects the complete E2E directory as coverage grows.

Node emitted non-fatal color-environment warnings because the runner sets both `NO_COLOR` and `FORCE_COLOR`. No browser JavaScript errors were observed in the passing tests.

GitHub Actions is configured for Node.js 22/24, frozen installs, lint, typecheck, tests, independent builds, production builds, package checks, Chromium E2E, and post-dev Next.js typechecking. Actions use verified immutable upstream commit references and a read-only repository token. Hosted CI and Node.js 24 were not executed locally; their status is not claimed as passed.

Inspector UI, source instrumentation/analysis, AI execution, transport, persistent caching, framework plugin behavior, production plugin exclusion, and performance targets are outside Phase 01. Passing schema checks does not establish actual source behavior, filesystem isolation, or provider permissions. All packages remain private and NPM scope ownership remains unverified. No Git commits or package publications were performed.
