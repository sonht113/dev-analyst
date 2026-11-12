# ADR 0002: Phase 01 build and workspace foundation

> Historical decision: framework expansion and multi-framework targets below are superseded by [ADR 0003](0003-react-vite-scope.md) and the permanent rule in [AGENTS.md](../../AGENTS.md). The original decision record is retained for traceability. Runtime separation, evidence-first analysis, and applicable tooling decisions remain in force; only React + Vite is currently supported. Do not execute historical framework work from this record.

Status: accepted for Phase 01. Refines ADR 0001's incremental package creation policy in response to the explicitly requested nine-package foundation.

## Context

Phase 01 requires nine independently buildable packages, four runnable playgrounds, shared schemas/types, logging/errors, quality tooling, and CI. Inspector and AI feature implementation are excluded.

The user confirmed DevAnalyst and `@devanalyst` as the identity. Scope availability and ownership remain unverified.

## Decision

Use pnpm workspaces, a pinned package manager, and a checked-in lockfile. Keep packages private pending publication decisions. Use TypeScript 6.0 strict mode and project references for builds. The TypeScript compiler is the maintained build alternative allowed by the constitution: the initial packages need ESM emission, declarations, source maps, and dependency ordering without asset processing or runtime bundling.

Use explicit ESM exports without internal aliases. Each package's `tsc -b` builds referenced dependencies. Use framework-native builds for playgrounds: Vite for React/Vue, Next.js for Next, Nuxt 4 for Nuxt.

Core owns browser-safe Zod schemas, contracts, errors, and injected-sink logging. Other packages expose the small interfaces needed to establish boundaries; the CLI provides help/version. No fake plugin factories, inspector mount functions, AI invocations, or successful placeholder analyses are provided.

Use ESLint, Prettier, Vitest, and Playwright. Check package graphs/imports, independently rebuild each package from clean outputs, exercise built exports/local packaging, and test real playgrounds in a browser. CI checks supported Node.js 22/24 versions.

## Consequences

Project references provide ordering and declarations without a second build engine. Manifest dependencies and references must stay synchronized; Node consumers need generated output, and relative imports must be ESM-compatible.

TypeScript output is not bundled or minified. Add an asset-aware library build when inspector UI or another feature needs one, preserving contracts and documenting the decision.

The nine directories are intentional foundation boundaries authorized by Phase 01. Their existence does not establish feature support. Shared transport/runtime abstractions remain deferred until a concrete use case exists.

Schema validation establishes shape and consistency, not filesystem isolation or evidence truth. Runtime security and production-exclusion tests remain required in the feature phases.

## References

- [pnpm workspaces](https://pnpm.io/workspaces)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [TypeScript declaration generation](https://www.typescriptlang.org/tsconfig/declaration.html)
- [Vite getting started](https://vite.dev/guide/)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Nuxt 4 installation](https://nuxt.com/docs/4.x/getting-started/installation)
- [Playwright-managed web servers](https://playwright.dev/docs/test-webserver)
