# DevAnalyst contributor instructions

> CURRENT FRAMEWORK SCOPE: The owner explicitly authorized Phase 11 to add Next.js + React, Vue 3 + Vite and Nuxt 4 alongside React + Vite. This supersedes the previous React-only restriction for these three targets only. See ADR 0013. Framework support is conditional on passing actual integration tests; no server-only runtime access or generic future integrations may be claimed.

Read the constitution, architecture, implementation plan, progress and testing policy before implementation. Current owner instructions take precedence over historical React-only documents. Preserve all uncommitted Phase 10 work.

## Phase discipline

- Inspect Git status before editing; preserve unrelated user changes.
- Implement only the explicitly authorized task or phase. A scope/documentation update does not authorize product features, tooling migration, deletion of completed work, or automatically starting another phase. Read [the implementation plan](docs/implementation-plan.md), [progress](docs/progress.md), and [testing policy](docs/testing.md) before implementation.
- Record major architectural decisions in `docs/adr/` and update architecture and public documentation when behavior changes.
- Do not create commits, publish packages, modify external services, force-push, or rewrite history without explicit authorization.
- Report completed work, executed checks, limitations, and remaining work accurately. Never claim a check passed unless it ran successfully.
- The supplied phase protocol ends during section 16. Do not attribute an invented remainder to the user.

## Engineering requirements

- Use the DevAnalyst identity, TypeScript strict mode, pnpm workspaces, explicit package exports, and stable public contracts.
- Separate the browser runtime, Node.js services, React AST/source analysis, Claude Code CLI integration, and cache infrastructure. Use React-specific instrumentation where needed and stable public APIs. Use the Phase 11 adapter contract only for the four authorized integrations; no placeholders or speculative integrations.
- Prefer deterministic source analysis before AI. Never invent source locations, endpoints, destinations, behavior, or evidence.
- Classify significant findings as `VERIFIED`, `INFERRED`, or `UNKNOWN`, with evidence, timestamps, and cache state. A verified static relationship does not prove runtime execution.
- Exclude inspector injection, AI bridges, development endpoints, and local paths from production output; verify exclusion with automated tests once implemented.
- AI is opt-in. Enforce read-only execution with runtime controls, validate workspace paths, exclude secrets, bound work, and document provider transmission. Prompt instructions alone are insufficient enforcement.
- Validate untrusted input. Avoid `any`, unsafe assertions, shell interpolation, unbounded queues, silent errors, and infinite retries.
- Preserve host application behavior and source maps. Never claim complete source mapping without realistic integration tests.
- Preserve normal browser interactions except during explicitly activated inspection. Do not collect password values or sensitive runtime data.
- Measure performance. Do not present latency targets as benchmark results.
- Add appropriate unit, integration, and browser tests for major features. Run lint, typecheck, unit tests, relevant integration tests, build, and relevant available E2E checks before completing an implementation phase. Document checks unavailable in the environment.

## Workspace conventions

- The user explicitly confirmed DevAnalyst and `@devanalyst/*` for Phase 01.
- Use Node.js `^22.22.3 || ^24.15.0` and the pinned `pnpm@10.33.0`.
- The active packages are `core`, `vite-plugin`, `inspector`, `analyzer`, `ai`, `cache`, `cli`, `server`, `next-plugin`, `vue-plugin`, and `nuxt-module`. Active apps are `playground-react`, `playground-next`, `playground-vue`, and `playground-nuxt`.
- Phase 11 reactivates the existing Next/Vue/Nuxt directories without deleting their prior source. Other historical/out-of-scope work stays excluded. Integration files alone do not establish support.
- Packages are ESM-only. Use `.js` extensions for relative TypeScript imports in library packages, public names for cross-package imports, and `workspace:*` for internal dependencies. Native Next application sources use extensionless TypeScript imports for the tested bundlers; see ADR 0014. Never import another package's source or private subpaths.
- Keep TypeScript project references synchronized with internal dependencies. `pnpm --filter @devanalyst/<name> build` must build its prerequisites automatically.
- `core` and `inspector` are browser-safe: no Node.js builtins, globals, or Node-only workspace dependencies. Public entry points are `src/index.ts` with explicit exports.
- Phase 02 implements the Vite bridge, browser route runtime, and CLI dev/doctor. The separately authorized Phase 03 adds the local browser element inspector (see ADR 0005); Phase 04 adds safe React JSX origin mapping (ADR 0006); Phase 05 adds the Node static analysis engine (ADR 0007); Phase 06 adds the opt-in Claude Code CLI provider API with runtime no-tools permissions (ADR 0008). Phase 07 adds progressive route-aware pre-analysis, cancellable AST workers and hash-validated in-memory reuse (ADR 0009); background Claude additionally requires explicit `preanalysis.backgroundAI` consent. Phase 08 adds worker-owned SQLite persistence and validated page/component/element/translation namespaces (ADR 0010); no raw runtime values are persisted. Phase 09 adds independent source-matched translation and selected behavioral/AI inspector presentation (ADR 0011). Phase 10 adds trusted typed file/mode configuration, operational CLI/Claude/bridge diagnostics, configurable shortcuts/depth/exclusions/debug and guarded VS Code/Cursor navigation (ADR 0012). Conversational follow-ups remain pending. Live authenticated AI success is not claimed when local auth is unavailable. All 18 product capabilities in the [implementation plan](docs/implementation-plan.md) remain required for React + Vite.
- Path schemas validate syntax. Node source reads must use the workspace access policy with containment, mandatory exclusions, canonical-path/inode checks, and size limits. The bridge exposes no file-read RPC. Phase 06's Node AI provider intersects source policy with explicit AI consent and uses fixed no-tools permissions; see ADR 0008 for compatibility and the trusted CLI/admin boundary. Phase 09 authorizes explicit expanded source-backed inspector dispatch with configured AI/path consent. Hover must not start Claude; automatic transmission still needs the separate background consent. Browser requests carry only structural identity and text digests, never raw DOM text or values.
- Use stable log event identifiers and allowed metadata. Do not log source text, runtime values, credentials, user text, or arbitrary errors. Handle failed log writes explicitly.
- Place source unit tests beside code as `*.test.ts`, tool tests in `tests/unit`, and browser tests in `tests/e2e`.
- For implementation changes, run lint, typecheck, unit tests, relevant integration tests, builds, and E2E tests scoped to the eleven active packages and four authorized applications. Follow [testing](docs/testing.md): root aggregate commands target eleven active packages and four authorized applications; unrelated historical tests remain excluded. For documentation-only changes, check formatting, links, scope consistency, and preservation of code/configuration without starting framework servers.
- `test:independent` deletes generated package `dist` outputs. Do not run it concurrently with builds or watchers.
- Do not manually edit generated outputs or lockfile content. Update dependency resolution through pnpm.
- Keep packages private until publication scope, ownership, licensing, and release policy are decided.
- Vite integration is development-only and currently supports standalone local HTTP Vite 8.3.5+ servers. Never put bridge credentials in URLs, logs, public snapshots, or production bundles. Verify Origin/Host and token before WebSocket upgrade.
- Keep configureServer and HMR free of analysis work. Vite can configure a replacement before closing its predecessor: maintain per-server lifecycle state and test restart/token rotation.
- The browser runtime is served from the explicit `@devanalyst/inspector/runtime` export with type-only shared imports. Keep it free of Node.js dependencies and preserve native history methods on teardown.

## Definition of Done

The product is complete only when every required React + Vite feature is implemented and verified, with source evidence, enforced AI read-only access and privacy controls, production exclusion, cache invalidation, measured performance, failure recovery, accessibility, executable documentation, and NPM release preparation. See the [complete acceptance checklist](docs/implementation-plan.md#definition-of-done). Foundation builds and counter smoke tests alone do not establish product completion.

## Future Roadmap

Angular, Svelte and any further integrations remain outside scope. The owner authorized only Phase 11's three additions; no further phase, publication or commit is implied.

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
