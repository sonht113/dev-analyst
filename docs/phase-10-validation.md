# Phase 10 validation — Developer experience and configuration

Date: 2026-11-16. Scope: the seven active packages and React + Vite only. The owner authorized Phase 10 implementation, retaining DevAnalyst naming. No commit, push, publication, external-service modification or later phase is authorized by this report.

## Delivered behavior

- Typed `devanalyst.config.ts` through the public Vite loader; file base, Vite-mode environment and inline precedence; shared bounded schema/defaults, mandatory source exclusions and safe actionable errors. Invalid integration configuration preserves the host application.
- Existing `devanalyst` CLI extended with exclusive setup, file/inline/Claude doctor diagnostics, live credential-free bridge status, offline SQLite inspection/clear, deterministic source analysis and guarded editor opening. Normal Vite development automatically manages bootstrap/bridge lifecycle.
- Configurable physical-key shortcuts, independent deterministic/AI depth, file/route exclusions and opt-in structured debug records. Debug privacy and sink-failure recovery have real bridge coverage.
- Authenticated bounded editor request/reply; fixed VS Code/Cursor executable names, argument arrays, workspace/sensitive/canonical/inode/size/coordinate/revision/stability guards, deadline and launch-frequency controls. Separate inline evidence expansion and normal host URL/interaction behavior remain intact.
- Public reference, README, architecture, roadmap/progress/testing, handoff and ADR 0012 updated. Historical framework code/configuration and lockfile preserved.

## Executed verification

Environment: Darwin arm64, Node **22.23.2**, pnpm **10.33.0**, TypeScript **6.0.3**, Vite **8.3.5**, React **19.3.1**, Playwright Chromium. No new dependencies were required.

| Check                                                   | Result                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                        | Passed: packages, root tools/tests and React fixture                                                        |
| `pnpm test`                                             | **336 tests in 30 files passed** on the sequential final aggregate                                          |
| Editor/config guards after final source-stability check | **20/20 passed**                                                                                            |
| `pnpm test:e2e`                                         | **42/42 Chromium tests passed**, including exact mapped Cursor launch through the real authenticated bridge |
| `pnpm build`                                            | Passed: all seven packages and real React production output                                                 |
| `pnpm lint`                                             | Passed: ESLint, package boundaries/cycles and formatting                                                    |
| `pnpm test:independent`                                 | Passed: all seven packages build from clean prerequisite outputs                                            |
| `pnpm test:packages`                                    | Passed: public/private exports, declarations/maps, local packaging and CLI smoke                            |
| Documentation and whitespace                            | All relative document targets exist; `git diff --check` passed                                              |

Core editor protocol tests reject commands/traversal/invalid revisions/positions. Actual TypeScript config loading covers defaults, mode/inline precedence, strict validation, private error values, config symlinks/size, duplicate shortcuts and bounded route matching. Owned native `code`/`cursor` subprocesses verify exact argument arrays and failures. CLI subprocess tests exercise no-overwrite setup, doctor errors/effective inline consent/configured native Claude reporting, missing workspace recovery, actual running/stopped status and unsafe URLs, parse-only React analysis and clearing a populated real SQLite cache. A real restart regression proves changing analysis depth invalidates selected AI persistence. Existing real production tests reject editor/configuration/runtime markers; controlled production builds also prove the separate executable configuration is never evaluated.

Initial sandbox runs could not bind loopback (`EPERM`); required integration/Chromium runs were repeated with authorization outside the sandbox. A concurrent unit/integration + Chromium run had one existing worker completion poll timeout; the sequential full unit/integration rerun passed without changing or removing that assertion. A lint run raced an integration fixture cleanup (`ENOENT`); lint was rerun after transient suites finished. New browser tests were corrected to use the dedicated editor status region and wait for the actual `VERIFIED` mapping render before reading source coordinates. No assertions were weakened.

## Limits and remaining product work

- Tests use owned editor executable fixtures; installed VS Code/Cursor GUI behavior and Windows launch are not claimed. The source-stability checks narrow filesystem races but are not an OS sandbox against trusted filesystem administrators.
- Configuration/Vite files and editor PATH executables are trusted local code. The source analyzer still executes no application code; Claude permissions/transmission controls remain unchanged. No authenticated live inference or translation quality claim is made.
- Cache CLI administration is explicitly offline. Stop Vite before clearing and restart it to discard process-local memory. Corrupt/incompatible database files are preserved, with diagnostics/fallback and the existing recovery guide.
- Standalone local HTTP remains the integration envelope. Configuration edits require restarting Vite. Debug records contain only stable identifiers and allowlisted metadata, not source/paths/routes/credentials/runtime values.
- All 18 product requirements remain mandatory. Conversational follow-ups, wider measured performance/accessibility/failure validation, authenticated model quality and release policy/preparation remain outstanding; Phase 10 is not overall product completion.

See [configuration and recovery](configuration.md), [ADR 0012](adr/0012-developer-configuration-cli-editor.md), [testing policy](testing.md) and [progress](progress.md).
