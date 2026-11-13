# Phase 06 — Claude Code CLI integration validation

The owner explicitly authorized Phase 06 in the existing `@devanalyst/ai` package. [ADR 0008](adr/0008-claude-code-provider.md) documents compatibility, runtime controls, privacy, confidence and work limits. [Usage](claude-code.md) provides installation/readiness and source-context examples. Earlier Phase 03–05/editor work remains preserved and uncommitted.

## Acceptance coverage

| Requirement                  | Evidence                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed CLI detection      | Actual native Claude 2.1.323 version/help; adapter discovers canonical executable and checks required capabilities                                         |
| Readiness versus login       | Separate auth status and opt-in synthetic model probe; mocked successful status followed by failed inference stays unavailable                             |
| Safe invocation              | Real POSIX subprocesses with argument arrays, stdin context, isolated cwd, environment allowlist, fixed no-tools permissions and process-group termination |
| Structured Vietnamese output | Strict schema, ID-only citations resolved to actual source, source-grounded explanation plus Japanese-label translation fixtures                           |
| AST-first context            | Real Phase 05 analyzer output and hashes feed the public provider API through a mock CLI executable                                                        |
| Source/evidence safety       | Exact source/range/hash checks, consent intersection, canonical sensitive-path exclusions, secret detection and post-inference snapshot checks             |
| Confidence                   | AI-authored VERIFIED prose becomes INFERRED; UI-only translations have UNKNOWN source evidence                                                             |
| Failure recovery             | Auth/quota/rate/overload/CLI/schema/unsafe tool failures, output/context/token bounds, deadline, cancellation, child termination and queue limits          |
| Unchanged source             | Successful/error/unsafe-tool/cancel tests retain fixture source bytes; a descendant-write canary never appears after group cancellation                    |
| Production exclusion         | Actual React production builds check additional provider implementation/argument markers                                                                   |

## Actual CLI observation

Native `claude --version` reports **2.1.323 (Claude Code)**. Version/help and the adapter's public readiness example execute successfully as diagnostic calls. Both sandboxed and authorized outside-sandbox checks report `available:true`, `compatible:true`, `authenticated:false`, `nonInteractive:unavailable` with `AI_AUTH_UNAVAILABLE`. No account details or credentials were printed.

A separate synthetic non-interactive invocation (no project source) emits the expected init: dontAsk mode, no MCP/skills, StructuredOutput as the sole tool, and three recognized built-in plugins. It exits with the expected structured authentication error. This verifies the installed invocation surface and failure path, **not a successful authenticated translation or inference**. No login or credential changes were performed. A successful live model response, linguistic/business accuracy and account/model entitlement remain unverified until separate CLI authentication is available.

## Executed checks

Local environment: 2026-11-13, Darwin 24.1.0 arm64, Node.js 22.23.2, pnpm 10.33.0, Vite 8.3.5, React 19.3.1, Playwright Chromium, native Claude Code 2.1.323.

| Check                                             | Executed result                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --frozen-lockfile`        | Passed for all nine active workspace projects                                                     |
| `pnpm lint`                                       | Passed ESLint with zero warnings, package boundaries/cycle checks and formatting                  |
| `pnpm typecheck`                                  | Passed strict package/root-tooling/test/React checks                                              |
| TypeScript server semantic/suggestion diagnostics | No diagnostics in changed TypeScript files; intended package/root projects selected               |
| `pnpm test:smoke`                                 | Passed 245 unit/integration tests in 20 files, followed by 26 Chromium E2E tests                  |
| `pnpm test:independent`                           | All seven packages independently build after prerequisite outputs are removed                     |
| `pnpm build`                                      | Passed packages and real React production build                                                   |
| `pnpm test:packages`                              | Passed exports, private import rejection, declarations/maps, local packaging and CLI smoke checks |
| Documented readiness API                          | Executed both status and opt-in probe paths; sanitized unavailable-auth state reported accurately |
| Local Markdown links / `git diff --check`         | Passed; no historical framework paths changed                                                     |

Phase 06 adds 53 AI unit cases and one public-package integration, all included in the final full suite. A focused 53-case run also passed after child-PATH hardening, before the last generic-token regression was added.

The final local status-only readiness request took **621.26 ms**, including version/help/auth subprocesses, and returned unavailable authentication. This is one observation of the diagnostic path, not model latency, a performance target or a statistical benchmark. Explanation results expose measured request duration and available input/cache/output token totals; transient failed-attempt usage is included when reported. Mocked provider tests use an actual OS executable implementing the CLI protocol; no SDK or live model is substituted and represented as a real authenticated success.

An initial declaration build exposed an inferred Node AbortSignal declaration issue; explicitly typing the signal fixed it. ESLint caught unnecessary regex escapes, which were removed. Secret-pattern regressions cover quoted credential keys, numeric passwords and JWT-like values. The final focused run confirms the tightened system-only child PATH and excludes inherited source/package-manager binary directories. Native CLI authentication remained unavailable even in an authorized outside-sandbox check. No failing assertions were deleted, account login performed, package published or commit created.

## Limits and remaining work

Runtime no-tools permissions contain model-directed behavior; they are not an OS sandbox against hostile installed native code or administrator-managed commands. Secret detection is heuristic. Work/spend controls do not guarantee exact provider billing; deadlines may require up to 1.5 seconds for process cleanup. Partial/aborted requests may have unreported usage. Only native POSIX CLI 2.1.323 is supported by this adapter; local execution was on macOS, with Linux not run here. Other CLI versions, browser engines, Node 24 and hosted CI are not claimed.

No browser AI RPC, result presentation, automatic source upload, background pre-analysis, persistent cache, editor integration or release was added. Original application text is preserved. Full product completion is not claimed.
