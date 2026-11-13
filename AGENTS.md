# DevAnalyst contributor instructions

> CURRENT FRAMEWORK SCOPE: DevAnalyst supports React + Vite + TypeScript only. Do not implement Next.js, Vue, Nuxt, Angular, Svelte, or other framework integrations unless the project owner explicitly changes this scope. All development, testing, optimization, and release work must prioritize complete React + Vite support.

This permanent scope restriction takes precedence over older roadmap documents, architecture decisions, and prompts that describe multi-framework work. Full product completeness is required within React + Vite; the restriction does not reduce the feature set or Definition of Done.

Read [the project constitution](docs/project-constitution.md) and [the current architecture](docs/architecture.md) before implementation. Apply the current framework restriction above when reading the constitution and all phase documents. If an instruction conflicts with the active user request, follow the user request and document material architectural consequences.

## Phase discipline

- Inspect Git status before editing; preserve unrelated user changes.
- Implement only the explicitly authorized task or phase. A scope/documentation update does not authorize product features, tooling migration, deletion of completed work, or automatically starting another phase. Read [the implementation plan](docs/implementation-plan.md), [progress](docs/progress.md), and [testing policy](docs/testing.md) before implementation.
- Record major architectural decisions in `docs/adr/` and update architecture and public documentation when behavior changes.
- Do not create commits, publish packages, modify external services, force-push, or rewrite history without explicit authorization.
- Report completed work, executed checks, limitations, and remaining work accurately. Never claim a check passed unless it ran successfully.
- The supplied phase protocol ends during section 16. Do not attribute an invented remainder to the user.

## Engineering requirements

- Use the DevAnalyst identity, TypeScript strict mode, pnpm workspaces, explicit package exports, and stable public contracts.
- Separate the browser runtime, Node.js services, React AST/source analysis, Claude Code CLI integration, and cache infrastructure. Use React-specific instrumentation where needed and stable public APIs. Do not introduce generic framework adapter layers, placeholder integrations, or speculative abstractions.
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
- The active packages are `core`, `vite-plugin`, `inspector`, `analyzer`, `ai`, `cache`, and `cli` under `packages/`. The only active application is `apps/playground-react`.
- Existing out-of-scope directories are retained historical work, inventoried in [progress](docs/progress.md), and excluded from active workspace/build/test/CI targets. Their presence does not establish support. Do not extend, configure, test, or install dependencies for them. Do not delete user code or completed work without explicit owner approval.
- Packages are ESM-only. Use `.js` extensions for relative TypeScript imports, public names for cross-package imports, and `workspace:*` for internal dependencies. Never import another package's source or private subpaths.
- Keep TypeScript project references synchronized with internal dependencies. `pnpm --filter @devanalyst/<name> build` must build its prerequisites automatically.
- `core` and `inspector` are browser-safe: no Node.js builtins, globals, or Node-only workspace dependencies. Public entry points are `src/index.ts` with explicit exports.
- Phase 02 implements the Vite bridge, browser route runtime, and CLI dev/doctor. The separately authorized Phase 03 adds the local browser element inspector (see ADR 0005); Phase 04 adds safe React JSX origin mapping (ADR 0006); Phase 05 adds the Node static analysis engine (ADR 0007); Phase 06 adds the opt-in Claude Code CLI provider API with runtime no-tools permissions (ADR 0008). Inspector analysis/AI presentation, editor navigation and persistent cache remain pending. Live authenticated AI success is not claimed when local auth is unavailable. All 18 product capabilities in the [implementation plan](docs/implementation-plan.md) remain required for React + Vite.
- Path schemas validate syntax. Node source reads must use the workspace access policy with containment, mandatory exclusions, canonical-path/inode checks, and size limits. The bridge exposes no file-read RPC. Phase 06's Node AI provider intersects source policy with explicit AI consent and uses fixed no-tools permissions; see ADR 0008 for compatibility and the trusted CLI/admin boundary. Do not enable browser AI dispatch or automatic transmission without separate authorization.
- Use stable log event identifiers and allowed metadata. Do not log source text, runtime values, credentials, user text, or arbitrary errors. Handle failed log writes explicitly.
- Place source unit tests beside code as `*.test.ts`, tool tests in `tests/unit`, and browser tests in `tests/e2e`.
- For implementation changes, run lint, typecheck, unit tests, relevant integration tests, builds, and E2E tests scoped to the seven active packages and React + Vite. Follow [testing](docs/testing.md): root aggregate commands now target only the seven active packages and React fixture; historical fixtures/tests remain excluded. For documentation-only changes, check formatting, links, scope consistency, and preservation of code/configuration without starting framework servers.
- `test:independent` deletes generated package `dist` outputs. Do not run it concurrently with builds or watchers.
- Do not manually edit generated outputs or lockfile content. Update dependency resolution through pnpm.
- Keep packages private until publication scope, ownership, licensing, and release policy are decided.
- Vite integration is development-only and currently supports standalone local HTTP Vite 8.3.5+ servers. Never put bridge credentials in URLs, logs, public snapshots, or production bundles. Verify Origin/Host and token before WebSocket upgrade.
- Keep configureServer and HMR free of analysis work. Vite can configure a replacement before closing its predecessor: maintain per-server lifecycle state and test restart/token rotation.
- The browser runtime is served from the explicit `@devanalyst/inspector/runtime` export with type-only shared imports. Keep it free of Node.js dependencies and preserve native history methods on teardown.

## Definition of Done

The product is complete only when every required React + Vite feature is implemented and verified, with source evidence, enforced AI read-only access and privacy controls, production exclusion, cache invalidation, measured performance, failure recovery, accessibility, executable documentation, and NPM release preparation. See the [complete acceptance checklist](docs/implementation-plan.md#definition-of-done). Foundation builds and counter smoke tests alone do not establish product completion.

## Future Roadmap

Additional frameworks are deferred possibilities only. They have no active phases, packages to create, playgrounds, dependencies, implementation work, or test targets. Complete React + Vite support before considering expansion; a future change still requires explicit owner authorization and an ADR.

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
