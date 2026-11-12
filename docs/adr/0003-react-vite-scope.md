# ADR 0003: React + Vite is the exclusive current framework scope

Status: accepted by explicit project-owner instruction. Supersedes framework-expansion portions of ADR 0001, ADR 0002, and earlier multi-framework prompts. Other completed work and applicable architectural decisions are preserved.

## Context

DevAnalyst must deliver a complete, production-quality developer tool for React + Vite + TypeScript, including Claude Code CLI integration, browser inspection, and React component/source analysis. Earlier foundation work introduced extra framework contracts, playgrounds, dependencies, and aggregate tooling. The owner now requests a documentation/rules/roadmap update and prohibits deleting user code or completed work without explicit approval.

## Decision

Make React + Vite the only current supported framework combination. Retain all 18 product capabilities and require complete implementation, testing, documentation, and release preparation within this ecosystem. Add the permanent scope rule to root `AGENTS.md`; it overrides older roadmap documents and prompts.

Use seven active packages: core, vite-plugin, inspector, analyzer, ai, cache, and cli. Use only the React + Vite playground as an active fixture. Separate browser, Node.js, React AST/source analysis, Claude execution, and caching. Prefer development instrumentation and stable public APIs; create no generic framework adapter layer or speculative compatibility infrastructure.

Preserve historical framework code and configuration in this documentation task after inspecting usage. Mark it unsupported and outside active architecture, phases, acceptance, and release gates. Record aggregate tooling coupling honestly; documentation does not silently change workspace installation, scripts, CI, or test execution. Any operational alignment is a separate authorized task, with explicit approval required before deleting user code or completed work.

No new product feature, dependency, framework test, or subsequent development phase is authorized by this decision.

## Consequences

Future implementation and verification focus on the complete React + Vite feature matrix. Historical test results and decision records remain available with clear supersession notices. Existing broad commands cannot be presented as React-only gates until their executable targets are separately aligned and verified.

The [implementation plan](../implementation-plan.md), [testing policy](../testing.md), and [progress inventory](../progress.md) define the current roadmap, acceptance, and remaining work. Product completion requires the full Definition of Done, not a foundation-only milestone.

## Future Roadmap

Next.js, Vue, Nuxt, Angular, Svelte, and other frameworks are deferred possibilities only. Do not implement, configure, test, install dependencies for, or create packages/playgrounds/adapters for them under the current scope. Expansion requires explicit owner authorization and a new architectural decision after complete React + Vite delivery; it does not follow automatically from retaining historical artifacts.
