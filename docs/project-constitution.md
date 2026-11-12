# DevAnalyst project constitution

Status: foundational requirements supplied in Prompt 00, amended by the owner’s current React + Vite scope restriction. This restriction supersedes earlier multi-framework plans; all product capabilities and engineering standards remain required. Planned capabilities are requirements, not claims of implemented behavior.

## 1. Project identity

- Project name: **DevAnalyst**.
- Product description: **AI-Powered Frontend Code Inspector**.
- Intended repository name: `devanalyst`.
- Proposed NPM scope: `@devanalyst`; availability and ownership must be verified before relying on it.
- CLI command: `devanalyst`.
- Configuration file: `devanalyst.config.ts`.
- Primary AI integration: Claude Code CLI.
- Primary language: TypeScript.
- Only current supported framework combination: React + Vite + TypeScript.
- Other framework integrations are deferred to the Future Roadmap and require an explicit owner scope change.

Use only the current project identity in source, documentation, package metadata, and UI. Build a production-grade, open-source-ready product with correctness, security, developer experience, performance, maintainability, and extensibility as priorities.

## 2. Product vision

Developers should be able to open a local application, detect its current route, pre-analyze relevant page components, hover for lightweight metadata, Alt+Click for detailed implementation inspection, and right-click for inspection actions.

The inspector should translate Japanese UI text into Vietnamese, explain element purpose, locate source components and files, explain rendering conditions, trace click handlers, state changes, API calls and navigation, open source in an editor, answer contextual AI questions, and reuse cached analysis.

Explanations must describe actual code behavior using evidence rather than guessing from visible text.

## 3. Core engineering principles

### Correctness over convenience

Never fabricate source locations, API endpoints, navigation destinations, business behavior, or evidence. Never treat AI-generated explanations as verified facts, hide uncertainty, or silently ignore unsupported patterns.

Every significant finding has one status:

| Status     | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `VERIFIED` | Supported by explicit source-code evidence.          |
| `INFERRED` | Plausible interpretation that is not fully verified. |
| `UNKNOWN`  | Insufficient information to determine behavior.      |

A verified static source relationship does not guarantee runtime execution.

### Deterministic analysis before AI

Prefer deterministic analysis for source mapping, component identification, import resolution, event handlers, rendering conditions, dependency graphs, navigation, API calls, and source references.

Use Claude Code primarily for complex business explanations, cross-file relationships, behavior interpretation, Japanese translation, call-chain summaries, and contextual developer questions. Do not replace reliable static analysis with AI.

### Evidence-first results

Each analysis result includes finding type, explanation, confidence classification, source file, line and column when available, supporting code reference, analysis timestamp, and cache status. Represent absent evidence honestly as unavailable and return `UNKNOWN`; do not fabricate fields to satisfy a schema.

### Development-only behavior

Never inject the inspector, start the AI bridge, expose development endpoints, or include local filesystem paths in production bundles. Verify production exclusion with automated tests.

## 4. Technology stack

| Layer                  | Planned technology                            |
| ---------------------- | --------------------------------------------- |
| Language               | TypeScript, strict mode                       |
| Monorepo               | pnpm workspaces                               |
| Package builds         | tsup or an appropriate maintained alternative |
| Browser inspector      | React                                         |
| Inspector styling      | TailwindCSS                                   |
| Dev server integration | Vite Plugin API                               |
| Code analysis          | TypeScript Compiler API / Babel AST           |
| AI integration         | Claude Code CLI                               |
| Communication          | WebSocket                                     |
| Persistent cache       | SQLite                                        |
| Validation             | Zod                                           |
| Unit testing           | Vitest                                        |
| Browser E2E            | Playwright                                    |
| Linting                | ESLint                                        |
| Formatting             | Prettier                                      |
| CI                     | GitHub Actions                                |

Use this stack unless a documented technical limitation justifies an alternative. Every dependency needs a clear purpose. Prefer maintained libraries and stable public APIs; avoid unnecessary frameworks and infrastructure.

## 5. Monorepo architecture

Active package boundaries:

- `@devanalyst/core`
- `@devanalyst/vite-plugin`
- `@devanalyst/inspector`
- `@devanalyst/analyzer`
- `@devanalyst/ai`
- `@devanalyst/cache`
- `@devanalyst/cli`

The only active playground is React + Vite (`apps/playground-react`). Retained historical framework artifacts are documented in [progress](progress.md); they are excluded from the active product plan and are preserved pending an explicit disposition decision.

Avoid circular dependencies. Separate browser and Node.js runtimes. Keep React-specific source instrumentation and Vite integration focused, AI provider execution behind its existing contract, and cache infrastructure separate from analysis logic. Do not introduce generic framework adapter layers without an immediate technical requirement. Browser packages must not import Node.js modules. Use explicit package exports, avoid exposing internals, maintain stable shared contracts, and create abstractions only for clear use cases. Document technical reasons for structural changes.

## 6. Source mapping

Prefer reliable development-time source instrumentation. Preserve application behavior and source maps. Support nested components, conditional rendering, repeated list items, dynamically loaded components, and HMR updates.

Handle ambiguous mappings explicitly. Do not depend exclusively on private framework internals or assume a CSS selector uniquely identifies a source element. Do not claim complete mapping until realistic application integration tests pass.

## 7. AI integration

### CLI integration

Detect installed Claude Code CLI and use supported non-interactive invocation. Spawn without shell interpolation. Validate structured responses. Support cancellation, timeouts, bounded concurrency, configurable analysis depth, authentication failures, and quota failures. Avoid unnecessary Claude sessions.

### Enforced read-only operation

AI analysis must not modify project files. Do not allow arbitrary shell execution or unrestricted tool permissions. Restrict source access to the configured workspace, exclude sensitive files, validate paths before reading, and apply least privilege. Do not bypass permission prompts or security controls.

Enforce read-only execution with runtime controls; prompts alone are insufficient.

### Privacy

Never intentionally send `.env` files, API keys, access tokens, passwords, private certificates, SSH keys, sensitive application data, or unnecessary user information to AI.

Do not assume CLI inference occurs locally. Disclose that source may be transmitted to the configured provider. Provide explicit controls to enable AI and select permitted project paths. Do not automatically analyze private repositories before AI access is enabled.

## 8. Predictive page analysis

On page entry, detect the route, collect relevant runtime metadata, identify source files, build a component index, run deterministic analysis, prioritize interactive elements, queue eligible AI tasks, cache results, and send incremental inspector updates.

Priority order:

1. Selected elements.
2. Hovered interactive elements.
3. Visible buttons and links.
4. Forms and menus.
5. Other visible components.
6. Background analysis.

Do not invoke Claude on every hover or analyze the entire repository by default. Deduplicate equivalent requests, cancel obsolete work when appropriate, respect concurrency limits, avoid blocking rendering or HMR, support lazy-loaded components, and report progress accurately.

## 9. Cache

Use layered caching for pages, components, elements, translations, and source mappings.

Keys account for relevant project and route identity, source hashes, dependency fingerprints, runtime context when necessary, AI provider and model, schema version, and translation language.

Never return unrelated entries. Invalidate affected entries after source changes without unnecessary full invalidation. Support stale-while-revalidate, label stale results, and never present stale findings as verified current behavior. Support migrations, corruption recovery, and size limits. Do not persist sensitive runtime values.

Target cached inspector responses below 100 ms under normal local development conditions. This is a target, not a measured benchmark.

## 10. Browser inspector

Use Shadow DOM isolation where appropriate and preserve original application text. Support keyboard and mouse input, scrolling, resizing, SPA navigation, HMR, nested elements, accessible shadow roots, loading and error states, light and dark themes, and clear source evidence.

Default interactions:

| Interaction | Intended behavior                    |
| ----------- | ------------------------------------ |
| Hover       | Lightweight translation and metadata |
| Alt+Hover   | Component information                |
| Alt+Click   | Detailed inspection                  |
| Right-click | Custom inspection actions            |

Preserve normal browser behavior unless the developer explicitly activates inspection. Do not interfere with application events outside such interactions, intercept sensitive inputs, or collect password values. Resolve interaction details during implementation consistently with these constraints.

## 11. Performance

Keep event handlers lightweight, delegate events where appropriate, debounce frequent interactions, avoid unnecessary DOM traversal and React rerenders, reuse results, and deduplicate AI requests.

Bound analysis depth, queue size, and memory consumption. Avoid synchronous heavy filesystem operations on hot paths. Measure performance and document benchmark conditions and limitations.

## 12. Error handling

Handle missing Claude CLI, authentication problems, quota exhaustion, timeouts, invalid AI output, unavailable source mapping, AST failures, disconnected WebSockets, cache corruption, unsupported React patterns, missing files, and files changed during analysis.

Never silently swallow errors or crash the host application because DevAnalyst fails. Provide actionable messages and structured error codes, distinguish recoverable and fatal errors, avoid infinite retries, and degrade gracefully. DevAnalyst must not prevent normal application development.

## 13. Testing

Every major feature requires tests.

- Unit: utilities, cache keys, AST extraction, mapping logic, schemas, and queue scheduling.
- Integration: React + Vite lifecycle and instrumentation, local bridge, mocked Claude subprocess adapter, cache invalidation, and React source analysis.
- Browser E2E: selection, tooltips, routes, HMR, mapping, isolation, and error recovery.

Never claim unexecuted tests passed, delete failing tests to make CI green, weaken assertions to hide defects, or mock the feature under test in its primary integration test. Fix root causes and add regression tests. Document checks that cannot run in the environment.

Before completing an implementation phase, run lint, typecheck, unit tests, relevant integration tests, build, and relevant E2E tests for React + Vite and the active shared packages. Follow [testing](testing.md) for the active React-only commands and retained historical exclusions. Product completion requires the full [Definition of Done](implementation-plan.md#definition-of-done).

## 14. Coding standards

Enable TypeScript strict mode. Avoid `any`, use `unknown` for untrusted values, validate external input, declare public API types, prefer discriminated unions for complex states, and avoid unsafe assertions.

Keep modules focused and responsibilities clear. Avoid unnecessary abstractions and circular dependencies. Prefer composition, explicit side effects, and separation of domain logic from infrastructure.

Use descriptive names, PascalCase for types and React components, camelCase for variables and functions, kebab-case for packages and directories, and consistent cross-package naming.

Document public APIs, non-obvious decisions, and security-sensitive behavior. Keep examples executable and documentation synchronized with implementation.

## 15. Git and change management

Inspect repository state before edits and preserve unrelated changes. Scope work to the active phase, avoid unnecessary refactoring, and do not delete important files without justification.

Do not force-push or rewrite history without approval. Do not create commits unless explicitly requested, publish packages automatically, or modify external services without approval. Record major architectural decisions in ADRs.

## 16. Phase execution protocol — incomplete supplied text

Implementation proceeds through separate numbered phase prompts.

The supplied before-coding instructions require reading `AGENTS.md` and begin a second item: “Read the current architecture”. The message ends there. No additional protocol was supplied; this document does not invent the missing text.

## Future Roadmap

Next.js, Vue, Nuxt, Angular, Svelte, and other frameworks are outside the current implementation, configuration, dependency, playground, testing, optimization, and release scope. They are possibilities for later owner-approved scope changes only, after complete React + Vite support is delivered. Do not create packages, empty adapters, or generic compatibility infrastructure for them now. Completion of React + Vite does not itself authorize expansion.
