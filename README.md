# DevAnalyst

AI-Powered Frontend Code Inspector.

**React + Vite + TypeScript is the only currently supported framework combination.** DevAnalyst must deliver the [complete 18-feature plan](docs/implementation-plan.md) before product completion.

## Phase 09 status

Implemented: automatic development-only browser runtime injection, authenticated loopback WebSocket bridge, connection tracking, browser-reported routes, source-change notifications, reconnection/teardown, configurable bridge ports, workspace access guards, CLI dev/doctor commands, and a local Shadow DOM browser element inspector with hover/modifier/context actions, pin/copy/keyboard controls, bounded DOM metadata and accessible frame/shadow-root handling.

Phase 04 adds compile-time JSX origin mapping, lexical component evidence, runtime instance IDs and HMR invalidation within the [documented safe envelope](docs/adr/0006-react-source-mapping.md). Phase 05 adds a bounded Node static analysis engine for source-level components/props/guards/handlers/hooks/state/API/navigation; see the [API guide](docs/static-analysis.md). Phase 06 adds the opt-in Claude Code provider API for Vietnamese explanations and Japanese UI translation, with guarded source context, no-tools permissions, structured output and bounded work; see [usage and compatibility](docs/claude-code.md). Phase 07 adds progressive page pre-analysis, prioritized/deduplicated AST workers, route cancellation, hash-validated memory reuse and incremental status; see [configuration and limits](docs/preanalysis.md). Background Claude additionally requires explicit `preanalysis.backgroundAI` and AI path consent. Phase 08 adds worker-owned SQLite persistence, page/component/element scopes, separate translation storage, dependency/alias invalidation, safe stale revalidation and Node cache controls; see [cache usage](docs/persistent-cache.md). Phase 09 adds independent translation, scoped source/AI findings, clickable evidence, call search, copy actions, locale/theme preferences and responsive compact/expanded inspection; see [inspector usage](docs/inspector-ui.md). Explicit expanded AI inspection uses configured AI/path consent; hover does not start Claude. Editor navigation and conversational follow-ups remain pending. The bridge does not collect input/history-state values, expose source-read RPCs, or infer routes from terminal logs. All packages remain private; NPM scope ownership is unverified.

## Run this repository

Use Node.js `^22.22.3 || ^24.15.0` and pnpm `10.33.0` (`.nvmrc`: `22.23.2`).

```sh
pnpm install --frozen-lockfile
npm run dev
```

The root dev command builds active library packages, then starts the React + Vite playground at `http://127.0.0.1:5173`. Its Vite config already registers `devanalyst()`, so the runtime and bridge start automatically. The bridge selects a free loopback port independently of Vite.

Historical framework directories are preserved but excluded from workspace installation, active TypeScript references, tests, lint, packaging checks, and CI. Only the seven active packages and React playground participate.

## Vite configuration

For a project with the workspace packages available, register the plugin alongside React:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { devanalyst } from '@devanalyst/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    devanalyst({
      bridge: { port: 0 },
      config: { source: { include: ['src/**'] } },
    }),
  ],
});
```

Options include `enabled: false`, shared `config`, `bridge`, and an optional lightweight `onEvent` observer. Configuration is passed explicitly in Vite config; automatic loading of `devanalyst.config.ts` remains future CLI/configuration work.

| Bridge option       | Default / behavior                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `host`              | `127.0.0.1` only; remote binding is rejected                                                      |
| `port`              | `0`, selecting a free ephemeral port                                                              |
| `strictPort`        | `true`; an occupied chosen port disables the bridge with an actionable error while Vite continues |
| `maxPortAttempts`   | `10`; with `strictPort: false`, try at most this many successive ports                            |
| `maxConnections`    | `32` (configurable up to 128)                                                                     |
| `maxMessageBytes`   | `16384` (configurable from 1024 through 65536)                                                    |
| `reconnectAttempts` | `12` bounded retries, with backoff/jitter; online/pageshow or explicit reconnect can retry again  |

The local browser must access Vite through an HTTP loopback URL (`127.0.0.1`, `localhost`, or `::1`). HTTPS and middleware mode currently report `UNSUPPORTED_FEATURE` and leave the host app running without the runtime. A project CSP must permit its own runtime script/bootstrap and the selected `ws://127.0.0.1:<bridge-port>` connection; choose a fixed port when an exact CSP allowlist is required.

## CLI and diagnostics

After building, use the CLI executable:

```sh
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js doctor apps/playground-react
node packages/cli/dist/bin.js dev apps/playground-react --port 5173 --strict-port
```

The package declares the `devanalyst` binary for installation/linking. `dev` uses the project's Vite configuration and requires `devanalyst()` to be configured; it never rewrites project files. It handles SIGINT/SIGTERM and rejects production execution. `doctor` loads the executable Vite configuration and reports Vite version/plugin presence without starting a bridge or AI. It does not claim full project or AI readiness.

The inspector starts alongside the bridge. Ordinary hover displays a passive tooltip; Alt+Hover expands DOM metadata. Alt+Click pins the deepest element without activating it. Use **DevAnalyst · Inspect** or **Alt+Shift+I** to enter explicit inspection mode; click or focus an element and press Enter to select it. **Alt+right-click** (or right-click in Inspect mode) opens inspection actions. Ordinary right-click keeps the browser/application menu.

**Pin/Unpin**, **Copy**, **Close** and **Escape** control the selection. Inside the inspector, **Alt+P** toggles pinning and **Alt+C** copies metadata. The menu supports arrows, Home/End, Tab/Shift+Tab, Enter and Escape. Explicit selection moves focus into the panel; closing restores prior focus. The `config.inspector.theme` option accepts `system`, `light` or `dark`.

Text stays in the browser. Page pre-analysis sends only bounded structural metadata and verified JSX identifiers to the local Node bridge. No form values or editable/private contents are read; arbitrary data/event/URL attributes and hidden text are omitted. Mark sensitive UI subtrees with `data-devanalyst-private` or `data-private`. Copy writes only the displayed DOM metadata to the local clipboard, with a manual-copy error when permission is unavailable. Source is **VERIFIED** only for currently registered safe JSX origin; unsupported/stale/ambiguous mappings are **UNKNOWN** with no claimed source. Translation and AI analysis remain pending. Japanese-script extraction is a heuristic that also matches Han text.

Open shadow roots and same-origin frames are supported within bounded discovery; cross-origin/sandboxed frame internals and closed roots are opaque. Geometry supports ordinary client rectangles and axis-aligned scaled/nested frames; rotated/skewed frames, pseudo-elements, canvas internals and browser top-layer occlusion have limitations. See [ADR 0005](docs/adr/0005-browser-element-inspector.md) and [Phase 03 validation](docs/phase-03-validation.md).

`window.__DEVANALYST_INSPECTOR__?.getSnapshot()` exposes a cloned local selection snapshot; `setInspecting(boolean)` toggles explicit inspection and `stop()` removes the overlay and its resources. Bridge `stop()` also stops the inspector. These snapshots may contain visible application text and should be treated as local data.

In browser developer tools, `window.__DEVANALYST_BRIDGE__?.getSnapshot()` reports status, acknowledged route, and last source/error metadata without exposing credentials. `reconnect()` restarts the local connection; `stop()` closes it and restores history/listeners where still owned. The runtime also emits `devanalyst:bridge` events. Plugin `api.ready` and `api.getSnapshot()` provide credential-free Node diagnostics.

Routes come directly from initial page state, `pushState`, `replaceState`, `popstate`, and `hashchange`. Query strings, history state, and opaque fragments are omitted. Hash routes beginning `#/` or `#!/` retain only the route pathname; other fragment changes are detected without collecting their values. Path segments themselves may contain application identifiers, so these snapshots stay local and are not automatically sent to AI.

## Source mapping

Selecting an instrumented intrinsic JSX element shows its original workspace-relative file, one-based line/column, lexical component and mapping status. The metadata snapshot includes `mapping.elementId`, `runtimeId` and `revision` for verified results. List instances share a source site and have separate DOM runtime IDs; keyed reorder retains the runtime ID while the same DOM node survives. Source IDs remain stable across whitespace and text-only edits that preserve JSX structure; remounts, reorders of source sites and structural changes have explicit limits.

Instrumentation runs only for authorized original `.tsx`/`.jsx` development client modules. JSX with native refs/spreads, custom elements, opaque factories, transformed/generated input, excluded or outside-workspace files remains unmapped. There is no selector/ancestor/Fiber fallback. `VERIFIED` means committed JSX template origin and lexical ownership, not a complete React runtime owner stack or business behavior. Applications introspecting/cloning React element objects need to observe the limitations and may exclude those files. See [ADR 0006](docs/adr/0006-react-source-mapping.md).

For local workspace packages outside the Vite app root, set an explicit common workspace root and include only the needed source patterns, for example `config: { workspaceRoot: '../..', source: { include: ['apps/my-app/src/**', 'packages/ui/src/**'] } }` when the Vite root is `apps/my-app`. Vite must also resolve/serve those sources normally. Mandatory exclusions and containment checks continue to apply.

Retain the plugin instance (`const inspector = devanalyst(...)`) to inspect `inspector.api.getMappingDiagnostics()` in Node. It reports allowed relative files, mapping/skip codes, counts and measured transform duration. Browser `getSnapshot().metadata.mapping` reports precise unknown reasons. Source-change invalidation uses hashed module/revision identifiers through Vite HMR and no browser DOM values. A syntax-error edit makes visible old source evidence unknown; correction and ref commit restore mapping. No source-reading RPC or AI call is added.

## Translation and analysis UI

Hover for lightweight original/translation and source information. Alt+Click opens detailed source-backed analysis; AI is optional and disabled by default. Translation runs independently of business analysis, with separate cache indicators and explicit stale/UNKNOWN results. Source links expand evidence inside the panel. Select English, Vietnamese or Japanese chrome and system/light/dark themes. See [usage, consent and limitations](docs/inspector-ui.md) and [Phase 09 validation](docs/phase-09-validation.md).

## Static code analysis

Use `createStaticAnalyzer` from `@devanalyst/analyzer` in Node. `analyzeDetailed` returns structured source findings, a bounded dependency/call graph, source hashes, selected subjects, diagnostics and measured metrics. The existing `analyze` method still returns validated `Finding[]`. See the [executable API guide](docs/static-analysis.md).

The engine parses TS/JS/TSX/JSX and binds local/imported/re-exported symbols without executing application/config code. It supports explicit aliases and guarded JSON/JSONC TypeScript path mappings. VERIFIED means a directly evidenced source construct/reference, INFERRED marks candidate interpretation, and UNKNOWN retains unresolved targets. Every detailed finding says `execution: not-evaluated`; a static API/navigation/state reference does not prove runtime execution. Scope/resource limitations are documented in [ADR 0007](docs/adr/0007-static-analysis-engine.md). The standalone API does not start background work; Phase 07 composes it through cancellable workers as described in [page pre-analysis](docs/preanalysis.md).

## Claude Code explanations

Use `createClaudeCodeProvider` from `@devanalyst/ai` in Node with explicit `ai.enabled` and `ai.permittedPaths`. Pass deterministic findings and matching source hashes; source may be transmitted to the Claude provider. The adapter supports native macOS/Linux Claude Code **2.1.323**, separates auth status from an opt-in real inference probe, and validates Vietnamese responses/citations. AI prose is capped at INFERRED and never replaces original VERIFIED source facts. Source-modifying tools, shell tools, MCP, skills and hooks are disabled; no application directory is given to the child. See [API usage](docs/claude-code.md), [runtime controls and limitations](docs/adr/0008-claude-code-provider.md), and [actual verification](docs/phase-06-validation.md). The current local CLI reports unavailable authentication; live authenticated inference has not been verified.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:independent
pnpm test:packages
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:unit` and `pnpm test:integration` select test layers. `pnpm test:smoke` runs all unit/integration tests followed by Chromium E2E. `pnpm dev:packages` watches active library builds; restart Vite after changing DevAnalyst's own served runtime implementation. Do not run `test:independent` concurrently with builds/watchers because it deliberately removes generated library outputs.

Production-exclusion tests build both controlled Vite fixtures and the real React playground, checking for runtime markers, bridge endpoints, credentials, and leaked local paths in host application output. DevAnalyst's own library package necessarily ships its development runtime asset.

## Project documents

- [Contributor/agent rules](AGENTS.md)
- [Architecture](docs/architecture.md)
- [Implementation plan and Definition of Done](docs/implementation-plan.md)
- [Progress](docs/progress.md)
- [Testing](docs/testing.md)
- [Repository structure](docs/repository-structure.md)
- [Project constitution](docs/project-constitution.md)
- [ADR 0004: Vite local bridge](docs/adr/0004-vite-local-bridge.md)
- [Inspector translation and analysis UI](docs/inspector-ui.md)
- [Phase 09 validation](docs/phase-09-validation.md)
- [ADR 0011: Translation and inspector UI](docs/adr/0011-translation-and-inspector-ui.md)
- [Persistent cache](docs/persistent-cache.md)
- [Phase 08 validation](docs/phase-08-validation.md)
- [ADR 0010: Persistent analysis cache](docs/adr/0010-persistent-analysis-cache.md)
- [Page pre-analysis](docs/preanalysis.md)
- [Phase 07 validation](docs/phase-07-validation.md)
- [ADR 0009: Predictive page pre-analysis](docs/adr/0009-predictive-page-preanalysis.md)
- [Phase 06 validation](docs/phase-06-validation.md)
- [ADR 0008: Claude Code provider](docs/adr/0008-claude-code-provider.md)
- [Claude Code API and compatibility](docs/claude-code.md)
- [Phase 05 validation](docs/phase-05-validation.md)
- [ADR 0007: Static analysis engine](docs/adr/0007-static-analysis-engine.md)
- [Static analysis API](docs/static-analysis.md)
- [Phase 04 validation](docs/phase-04-validation.md)
- [ADR 0006: React source mapping](docs/adr/0006-react-source-mapping.md)
- [Phase 03 validation](docs/phase-03-validation.md)
- [ADR 0005: Browser element inspector](docs/adr/0005-browser-element-inspector.md)
- [Phase 02 validation](docs/phase-02-validation.md)
- [Historical Phase 01 validation](docs/phase-01-validation.md)

## Future Roadmap

Next.js, Vue, Nuxt, Angular, Svelte, and other frameworks have no active phases, dependencies, playgrounds, or test targets. Consider expansion only after complete React + Vite delivery and an explicit owner scope change. The full React + Vite feature set remains mandatory.
