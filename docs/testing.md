# React + Vite testing and acceptance

**React + Vite + TypeScript is the only currently supported framework combination.** All gates now target the seven active packages and `apps/playground-react`. Historical directories and their tests remain preserved and excluded. See [ADR 0004](adr/0004-vite-local-bridge.md) and the [Phase 02 validation report](phase-02-validation.md).

## Commands

| Command                          | Purpose                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install the nine active workspace projects, including the root                              |
| `pnpm lint`                      | ESLint on active code, dependency boundaries, and formatting                                |
| `pnpm typecheck`                 | Build declaration prerequisites and check active libraries, tooling/tests, and React        |
| `pnpm test`                      | Build packages and run all active Vitest unit/integration tests                             |
| `pnpm test:unit`                 | Unit tests, excluding active integration files                                              |
| `pnpm test:integration`          | Real Vite/bridge, CLI/consumer startup, and production builds                               |
| `pnpm build`                     | Build seven libraries and the React playground                                              |
| `pnpm test:independent`          | Build each active library with generated outputs removed first                              |
| `pnpm test:packages`             | Public exports, private path rejection, declarations/maps, local archives, CLI smoke checks |
| `pnpm test:e2e`                  | Chromium route, React HMR, lifecycle, retry, restart, and teardown tests                    |
| `pnpm test:smoke`                | All unit/integration tests followed by Chromium E2E                                         |

Install Chromium with `pnpm exec playwright install chromium`. Integration/E2E need permission to bind local loopback ports and launch browser/subprocesses. Use the environment's authorized test runner; document unavailable checks rather than substituting mocks or weakening assertions. Do not run the independence checker concurrently with builds/watchers.

## Phase 02 coverage

- Core contracts: loopback-only settings, bounded ports/resources/retries, bootstrap endpoint/credential validation, route metadata, existing finding/error/logger rules.
- Real workspace files: allowlists, mandatory sensitive-file exclusion, traversal/absolute paths, file/directory symlink escape, canonical excluded targets, bounded reads.
- Real Vite/WebSocket integration: runtime injection, credential-free HTML/module/snapshots, authenticated Origin/token checks, unsupported RPC/invalid JSON/version/route rejection, binary/rate/payload/connection limits, connection/disconnection, file changes, observer isolation, base paths, disabled config, port conflicts/fallback, restart/token rotation, and shutdown.
- Actual consumer and CLI subprocesses: `npm run dev` starts the configured bridge, CLI dev lifecycle and port release, doctor without services, missing config, production refusal, and safe errors.
- Production: real React application build and controlled Vite builds, including a custom development build mode, exclude DevAnalyst runtime markers/endpoints/local paths.
- Chromium against real React + Vite: server-acknowledged routes for all navigation APIs without document reload, sanitized metadata and preserved history state, React Fast Refresh preserving counter state, source notices, reconnect/stop, page lifecycle suspension, native navigation errors, bootstrap outage retries, and actual Vite restart.

Network tracing is disabled to avoid persisting bootstrap credentials; failures can retain fixture screenshots. Browser fixtures are owned temporary copies under the React app, allowing dependency resolution without changing user source. Tests remove only those fixtures. The outage test injects bootstrap failures specifically for error recovery; successful integration, routes, HMR, restart, and production tests use the real feature.

## Complete product acceptance

Phase 02 is infrastructure, not completion of the entire product. Every [F01–F18 capability and Definition of Done](implementation-plan.md#definition-of-done) remains required. Later tests must cover actual mapping, React props/conditions/callbacks/hooks/state/API/routing analysis, inspector interactions/accessibility/isolation, translations/follow-ups, enforced provider permissions, scheduling, persistent caches/invalidation, editor navigation, failure recovery, and measured performance.

Current local HTTP support does not establish HTTPS/middleware-mode support. Path guards are not an OS sandbox for future AI subprocesses. Runtime source mapping and provider security must be verified in their own phases. Do not infer product readiness from foundation or route-counter tests.

Never delete failing tests to make CI green, weaken assertions, fabricate evidence, mock the feature under test in its primary integration check, or claim unexecuted tests passed. Run appropriate scoped checks before a phase completes and record commands, environment, results, limitations, and remaining work. Documentation-only changes need formatting/link/scope checks rather than launching runtime suites.

## Future Roadmap

Other framework verification has no active allocation. Expansion requires explicit owner authorization after complete React + Vite support.
