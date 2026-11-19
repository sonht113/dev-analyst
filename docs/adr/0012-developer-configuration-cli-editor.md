# ADR 0012: Developer configuration, operational CLI and guarded editor navigation

Status: accepted for the owner's explicitly authorized Phase 10, 2026-11-16.

## Context

The owner requested typed configuration/environment overrides, setup/doctor/status/cache/analyze commands, Claude and bridge diagnostics, configurable shortcuts/depth/exclusions, VS Code/Cursor navigation and debug logging. Earlier prompts used the historical DevLens spelling; the confirmed DevAnalyst identity, seven packages and React + Vite scope remain authoritative. This phase completes configuration/editor journeys without authorizing conversational follow-ups, other frameworks, publication or commits.

## Decision

Keep schema/defaults in browser-safe core and trusted TypeScript file loading in the existing Node Vite package using Vite's public loader. Load only for development serve; CLI uses the same validation. Export a typed file-input helper in Vite; core's existing helper remains an immediate validator. Merge base, Vite-mode environment and inline sections, replacing arrays and preserving mandatory source exclusions. Validate all environments. Trust configuration like executable Vite configuration; it is outside the parse-only analyzer and AI read-only boundary. Limit the regular non-symlink entry file to 64 KiB; report safe field names without arbitrary values. Configuration changes require a restart.

Reuse existing CLI, Claude readiness API, AST workers and SQLite worker rather than adding packages or generic adapters. `setup` creates a new AI-disabled configuration exclusively; it does not rewrite Vite. Registration of `devanalyst()` once is required; normal Vite dev automatically manages the entire bridge. `doctor` inspects configuration and native Claude capability/authentication without inference or service startup. Auth status does not prove inference success. `status` reads a guarded loopback/same-origin endpoint containing state/count/error code only; no token, path or route discovery file is persisted. `cache` is explicitly offline administration and never deletes database files; users stop/restart Vite to reset memory. `analyze` is deterministic and explicit-source only.

Depth profiles feed the existing bounded analyzer and persistence policy identity. File exclusions share the canonical workspace policy across mapping, reads and editor access. Route exclusions gate server dispatch for both automatic and explicit analysis; they retain local DOM inspection/mapping. Shortcut configuration uses modifier sets and physical key codes, preserves editable controls, and keeps Alt mouse/Escape semantics. Debug logging is opt-in through existing structured logger validation, with stable identifiers and no arbitrary payloads; write failures become diagnostics.

Add an authenticated versioned `editor.open` request and bounded `editor.result` reply to the existing bridge. Node checks source policy, canonical containment, sensitive exclusions, regular file/inode/size, one-based coordinates and source stability; matching mapped-file requests also carry a revision hash. Invoke only configured `code`/`cursor` from trusted PATH with fixed argument arrays, no shell/URI handlers. Bound in-flight launches, frequency and time. Opening never returns file text to the browser. CLI `open` uses the same implementation. Source evidence excerpts retain their separate inline-expansion behavior.

## Consequences and limits

No dependency/lockfile migration, framework integration or separate configuration service is needed. Vite startup loads trusted configuration but performs no source analysis/inference. Invalid configuration disables DevAnalyst gracefully; CLI reports a useful failure. Production builds do not load the separate file or inject the runtime. Existing browser/Node/AI boundaries remain intact.

Editor executable, project configuration, CLI administrator and filesystem administrator are trusted. Rechecking inode/canonical state narrows races but cannot provide an OS sandbox or prevent a privileged replacement after the final check. Tests launch owned native executable fixtures and verify exact arguments; actual VS Code/Cursor GUI behavior and Windows launch are not claimed. Cache clearing is offline, not a browser administration RPC. HTTPS/middleware support and live authenticated model quality remain outside established validation. See [configuration reference](../configuration.md) and [Phase 10 validation](../phase-10-validation.md).
