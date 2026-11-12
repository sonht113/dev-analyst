# ADR 0001: Initial package and runtime boundaries

> Historical decision: framework expansion and multi-framework targets below are superseded by [ADR 0003](0003-react-vite-scope.md) and the permanent rule in [AGENTS.md](../../AGENTS.md). The original decision record is retained for traceability. Runtime separation, evidence-first analysis, and applicable tooling decisions remain in force; only React + Vite is currently supported. Do not execute historical framework work from this record.

Status: accepted as the architectural direction for implementation phases.

## Context

DevAnalyst must connect browser UI inspection with source analysis, optional Claude explanations, and persistent caching while preserving host development behavior and excluding development tooling from production builds.

The constitution specifies a TypeScript pnpm monorepo, React + Vite as the first integration, and later framework adapters. Source evidence and runtime separation are foundational requirements.

## Decision

Use focused packages for browser-safe contracts, inspector UI, deterministic analysis, AI integration, cache storage, framework integration, and the CLI. Implement React + Vite first. Create later framework packages when an authorized phase requires them.

Keep Node.js filesystem, SQLite, and subprocess operations outside the browser dependency graph. Framework plugins compose services through explicit contracts. Analysis remains independent of cache infrastructure and AI explanations. AI provider behavior sits behind an interface justified by the required Claude integration.

Implement packages incrementally with strict TypeScript, explicit exports, boundary checks, and feature-appropriate tests. Enforce development-only operation in runtime integration and verify production exclusion automatically.

## Consequences

Package boundaries make runtime dependencies and public APIs reviewable, at the cost of build and workspace coordination. They do not alone enforce security or prevent cycles; implementation and automated checks must establish those properties.

Bridge ownership remains an implementation decision. A separate shared bridge package needs a demonstrated use case and a follow-up ADR. Provider permissions, source instrumentation, SQLite choices, transport schemas, and dependency versions remain unresolved.

This ADR records direction only. It does not claim packages exist, source mapping is complete, AI execution is read-only, or performance targets have been met.
