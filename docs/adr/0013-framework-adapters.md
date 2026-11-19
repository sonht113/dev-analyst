# ADR 0013: Owner-authorized framework adapters

Status: accepted architecture for Phase 11, 2026-11-16. Implementation support remains conditional on framework-specific integration results.

## Scope change

The owner explicitly requested Next.js with React, Vue 3 with Vite, and Nuxt 4 in Phase 11. This supersedes ADR 0003's React-only restriction for these targets, including necessary source, dependencies, playgrounds, CI/test targets and a concrete adapter contract. DevAnalyst identity and all evidence, privacy, opt-in AI and production-exclusion requirements remain. Existing Phase 10 changes are preserved uncommitted. Angular, Svelte and subsequent phases remain unauthorized.

## Decisions

- Separate existing development lifecycle, authenticated bridge, source registry, analysis scheduling, cache, Claude and inspector services into `@devanalyst/server`. Vite supplies its actual host APIs. Framework integrations supply their actual HTTP server, source watcher and lifecycle; no fake Vite server or private framework runtime traversal.
- Define a bounded Node source adapter contract for React/Vite, Next client React, Vue/Vite and Nuxt, and a neutral browser origin registry. Vue commits DOM provenance through public directive lifecycle hooks, with independent template/compiler AST mapping. React retains its public ref strategy. Both feed structural source identities to the same inspector, queue, SQLite cache and opt-in Claude APIs.
- Parse Vue SFC templates independently. Parse script blocks as a position-preserving TypeScript projection solely for shared script/import/call semantics; never apply JSX/ref assumptions to Vue templates. Preserve original SFC hashes, positions and evidence. Unsupported SFC/compiler/semantic patterns are UNKNOWN or uninstrumented.
- Next integration uses the public development custom-server API and documented Webpack/Turbopack loader hooks. Explicit client source boundaries are instrumented; server components are not mapped to browser nodes and server action execution is not inferred. A private, owner-only compiler IPC service registers source transforms before browser delivery; it is distinct from the authenticated browser bridge and exposes no browser source-read RPC. The dev wrapper and client-only bootstrap are excluded from production builds/start.
- Nuxt integration uses public module, Vite and server lifecycle hooks with dev-only client injection. Nitro/server-only logic is never claimed from a DOM element. Vue Router/Nuxt/Next navigation still reports sanitized URL routes, with framework lifecycle notifications where needed for committed pages.
- All source reads, editor paths, model consent, resource bounds, cancellation, cache invalidation, debug privacy and production checks apply to every target. Cache/worker identities include adapter selection. Real framework runtime, navigation, HMR/hydration and production tests determine support claims; fixture declarations alone do not.

## Supported-envelope policy

Exact framework/compiler/bundler versions, installation steps, unsupported combinations, SSR/client boundaries and executed results will be recorded in the Phase 11 framework guide and validation report. A failing or unavailable integration remains explicitly unverified and must not be advertised as supported. No release/publication or commit is authorized.

## Declaration boundary exception

Nuxt Kit references optional unsupported builders and has upstream exact-optional declaration incompatibilities; Next/Vue Router app declarations also require vendor checking exceptions. `skipLibCheck` is scoped to the Nuxt module and affected application configs. All implementation source remains strict and the shared packages retain declaration checks. Public integration signatures avoid leaking vendor internals; no unsupported builder dependency is installed solely for its declarations. Real runtime/build tests remain mandatory.
