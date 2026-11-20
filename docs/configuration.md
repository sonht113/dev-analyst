# Configuration, CLI and editor navigation

The project identity is DevAnalyst, configuration is `devanalyst.config.ts`, and the binary is `devanalyst`. The MIT beta uses `@sonht113/*`; see [release status](releasing.md). File/mode configuration is shared by the supported integrations; project CLI `dev`/`doctor` remain Vite-specific. No legacy-name binary or configuration alias is installed.

Register `devanalyst()` from `@sonht113/vite-plugin` alongside the React plugin in `vite.config.ts` once. Run the application's usual Vite dev script: browser injection, bootstrap credentials, bridge ports, worker startup and teardown are automatic. Never manually copy bridge tokens or put them in URLs.

## Typed configuration and environments

Place this file at the **Vite application root**, which may differ from the configured source workspace root:

```ts
// devanalyst.config.ts
import { defineConfig } from '@sonht113/vite-plugin';

export default defineConfig({
  source: { include: ['src/**'], exclude: ['src/generated/**'] },
  routes: { exclude: ['/admin/**', '/private/*'] },
  analysis: { depth: 'standard' },
  editor: { command: 'code', enabled: true }, // 'cursor' for Cursor
  inspector: {
    shortcuts: {
      toggle: 'Alt+Shift+KeyI',
      pin: 'Alt+KeyP',
      copy: 'Alt+KeyC',
    },
  },
  ai: { enabled: false },
  environments: {
    testing: { cache: { enabled: false }, analysis: { depth: 'shallow' } },
    development: { logLevel: 'debug' }, // opt-in, metadata-only local logging
  },
});
```

Resolution order: safe defaults → file base → `environments[Vite mode]` → inline `devanalyst({ config })`. Objects merge by section; arrays replace. Mandatory sensitive-file exclusions are always added back. Inline `bridge` settings override `config.bridge`. Explicit `preanalysis.analyzer.limits` override the depth profile. Environments use the Vite mode (`--mode testing`), not an implicit `.env`/`NODE_ENV` overlay. `NODE_ENV=production`, Vite production mode and builds disable runtime injection regardless of environment overrides. Every declared environment is validated; nested environments are invalid.

The helper exported by `@sonht113/vite-plugin` types the **file input** including environments. `defineConfig` in `@sonht113/core` remains the browser-safe immediate schema/default validator; it does not load files or accept environments.

Configuration is **trusted executable project code**, loaded through Vite's public TypeScript loader, just like `vite.config.ts`. Do not run CLI/configuration commands in an untrusted checkout. Application sources used for analysis remain parse-only. The entry file must be a regular non-symlink file up to 64 KiB. Missing files use defaults; syntax/import/schema errors report safe option names and recovery without printing supplied values. Imported configuration modules share the trusted-code boundary. Restart Vite after changing configuration or imported configuration helpers. Invalid plugin configuration leaves the host application usable and disables DevAnalyst; `doctor` and CLI `dev` fail with actionable errors.

## Options

All sections are optional; unknown keys and invalid types/bounds fail validation.

| Option                       | Default                        | Behavior / limits                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceRoot`              | `'.'`                          | Source workspace relative to Vite root; source/cache/editor paths resolve within this workspace                                                                                                                       |
| `source.include`             | `['src/**']`                   | 1–100 workspace-relative file globs                                                                                                                                                                                   |
| `source.exclude`             | `[]` plus mandatory exclusions | Up to 100 custom file globs; shared mapping, source reads, analysis, cache validation and editor access policy                                                                                                        |
| `routes.exclude`             | `[]`                           | Up to 100 pathname patterns, each up to 512 characters; `*` stays within a segment, `**` crosses segments; literal other characters. Matches pathname or hash-route pathname; no queries/fragments/control characters |
| `analysis.depth`             | `'standard'`                   | `shallow`, `standard`, `deep`: deterministic maximum graph depth 4, 12, 24; other bounded analyzer budgets remain in force                                                                                            |
| `ai.enabled`                 | `false`                        | Explicit consent; enabling requires nonempty `ai.permittedPaths`                                                                                                                                                      |
| `ai.provider`                | `'claude-code'`                | Only supported provider                                                                                                                                                                                               |
| `ai.permittedPaths`          | `[]`                           | Up to 100 workspace-relative patterns intersected with source policy; source may be transmitted to provider                                                                                                           |
| `ai.depth`                   | `'standard'`                   | Independent AI context depth: `shallow`, `standard`, `deep`                                                                                                                                                           |
| `ai.concurrency`             | `1`                            | 1–4; selected inspector/provider lanes retain their narrower concurrency controls                                                                                                                                     |
| `ai.timeoutMs`               | `60000`                        | 1000–300000 ms                                                                                                                                                                                                        |
| `cache.enabled`              | `true`                         | SQLite persistence; disabled leaves bounded in-memory analysis                                                                                                                                                        |
| `cache.directory`            | `'.cache/devanalyst'`          | Dedicated normalized workspace-relative directory, no traversal; keep outside public/build outputs                                                                                                                    |
| `cache.maxSizeMb`            | `256`                          | 1–4096 MiB logical cache budget; physical SQLite bytes differ                                                                                                                                                         |
| `inspector.enabled`          | `true`                         | Disable inspector and its bridge                                                                                                                                                                                      |
| `inspector.theme`            | `'system'`                     | `system`, `light`, `dark`; browser's explicit saved display preference wins                                                                                                                                           |
| `inspector.language`         | `'en'`                         | `en`, `vi`, `ja` chrome; browser's saved display preference wins                                                                                                                                                      |
| `inspector.shortcuts.toggle` | `'Alt+Shift+KeyI'`             | Toggle explicit inspection outside editable controls                                                                                                                                                                  |
| `inspector.shortcuts.pin`    | `'Alt+KeyP'`                   | Pin/unpin while focus is in inspector, outside editable controls                                                                                                                                                      |
| `inspector.shortcuts.copy`   | `'Alt+KeyC'`                   | Copy metadata while focus is in inspector, outside editable controls                                                                                                                                                  |
| `editor.enabled`             | `true`                         | Allow explicit validated local source navigation                                                                                                                                                                      |
| `editor.command`             | `'code'`                       | Fixed `code` or `cursor` CLI from trusted local PATH                                                                                                                                                                  |
| `logLevel`                   | `'info'`                       | `debug`, `info`, `warn`, `error`, `silent` for structured event logging. Only `debug` opts into bridge event records; operational warnings remain visible through Vite                                                |
| `bridge.host`                | `'127.0.0.1'`                  | Loopback only                                                                                                                                                                                                         |
| `bridge.port`                | `0`                            | 0–65535; zero automatically selects a free port                                                                                                                                                                       |
| `bridge.strictPort`          | `true`                         | Occupied fixed port fails DevAnalyst without stopping Vite                                                                                                                                                            |
| `bridge.maxPortAttempts`     | `10`                           | 1–20, used with `strictPort: false`                                                                                                                                                                                   |
| `bridge.maxConnections`      | `32`                           | 1–128                                                                                                                                                                                                                 |
| `bridge.maxMessageBytes`     | `16384`                        | 1024–65536 bytes                                                                                                                                                                                                      |
| `bridge.reconnectAttempts`   | `12`                           | 0–20 bounded retries                                                                                                                                                                                                  |

Shortcuts use one or more distinct `Alt`, `Control`, `Meta`, `Shift` modifiers plus a physical `KeyboardEvent.code`: `KeyA`–`KeyZ` or `F1`–`F12`. All three shortcuts must be distinct regardless of modifier order; repeats are ignored. Avoid OS/browser-reserved combinations. Alt mouse inspection and Escape/Enter/menu navigation keep their existing meanings. Normal host inputs are preserved.

Route exclusions suppress automatic and explicitly selected source/AI analysis, including translation dispatch; selected lanes report `ROUTE_EXCLUDED`. Local DOM inspection and source mapping remain available. File exclusions also deny source/editor access. Queries, DOM values and private text are never sent to match routes.

Low-level Node integration options remain in `devanalyst({...})`: `enabled`, `preanalysis.enabled`, `preanalysis.backgroundAI`, `preanalysis.limits`, `preanalysis.analyzer`, `preanalysis.claude`, and `onEvent`. Callback functions/executable overrides are not part of the shared browser-safe file schema. Automatic AI still needs separate `preanalysis.backgroundAI: true`; hover never starts inference. See [pre-analysis](preanalysis.md), [Claude controls](claude-code.md) and [cache recovery](persistent-cache.md).

## Commands and diagnostics

When `@sonht113/cli` is installed/linked in a consumer, run `devanalyst`. In this repository after `pnpm build:packages`, use `node packages/cli/dist/bin.js` in place of the binary.

```sh
devanalyst --help
devanalyst setup .
devanalyst doctor . --mode development
devanalyst dev . --port 5173 --strict-port
devanalyst status . --url http://127.0.0.1:5173/
devanalyst analyze src/App.tsx .
devanalyst open src/App.tsx . --line 10 --column 3
devanalyst cache inspect .
# Stop Vite first, then clear persisted entries; restart Vite afterwards.
devanalyst cache clear .
```

- `setup` exclusively creates a safe typed file with AI disabled. It never overwrites a file or rewrites Vite configuration; add the plugin once if missing.
- `doctor` validates file/inline configuration, reports Node/Vite versions and plugin registration, and checks the effective configured native Claude CLI version/capabilities/auth status using inline AI consent and executable overrides without starting bridge or inference. Missing/incompatible Claude is advisory when AI is disabled; when enabled, failed compatibility/authentication makes doctor fail. The provider currently requires native CLI **2.1.323**. Auth/compatibility do not prove live model entitlement or successful inference. Follow the returned recovery messages.
- `status` uses a bounded, read-only same-origin diagnostic endpoint on the exact local HTTP Vite base URL. Default is `http://127.0.0.1:5173/`; supply a different port/base when needed. It reports bridge state and browser count, with no credentials, routes, local paths or source text. Redirects/remote URLs are rejected. Failure suggests starting Vite, using its correct base, and checking CSP `connect-src`. No bridge port/token setup is needed.
- `cache inspect/clear` uses the real SQLite worker and guarded directory with guaranteed close, never deletes database files. **Offline administration:** stop Vite first; restart after clear so in-memory layers are reset. Clear removes all scopes/namespaces. Corrupt/incompatible databases remain preserved and expose a diagnostic with memory fallback; use the [recovery guide](persistent-cache.md).
- `analyze` reads one explicit allowed workspace-relative source and its bounded deterministic dependencies in a worker, returning source findings/diagnostics/metrics as JSON. It never invokes AI or executes application source.
- `open` uses the same path/position guards as browser editor navigation.

Exit codes: 0 success/help, 1 operational or readiness failure, 2 invalid configuration/usage or unsupported command. Commands do not echo arbitrary input values in errors. Configuration execution can still perform its own user-authored logging/side effects, as Vite configuration can.

Debug records are local structured JSON through the Vite logger with stable event names (`bridge.connected`, `bridge.route`, etc.), timestamp/scope and allowlisted metadata only. No source text, paths, routes, credentials, DOM values, user text or raw exceptions are logged. Failed sinks surface `LOG_WRITE_FAILED`; no disk log/telemetry is enabled.

## VS Code and Cursor

Install the editor's `code` or `cursor` shell command in PATH from its command palette, then restart Vite. Set `editor.command` accordingly. Click **Open source in editor** for a current mapped JSX origin or **Open in editor** beside evidence; excerpts still expand independently without changing the application URL. Launch success means the editor CLI exited successfully; automated tests use owned executable fixtures, not a claim of manually verified GUI behavior.

The authenticated bridge accepts bounded structural source references only. Node validates relative syntax, source include/exclude policy, mandatory sensitive exclusions, canonical containment, symlinks, regular-file size/inode identity, one-based line/column bounds and immediate source stability. It invokes a fixed executable with an argument array: `--reuse-window --goto /absolute/file:line:column`; no shell interpolation, arbitrary command, URI handler or file-read response. Editor requests are limited to one in flight per connection and at most one per second, with a launch timeout and browser recovery message.

Missing/disabled editors, excluded/missing files, invalid positions and source changes fail with recovery. Refresh stale inspection after saving. Local filesystem administrators, trusted editor executables and executable configuration remain a trust boundary; path checks cannot provide an OS sandbox or eliminate a privileged filesystem replacement after the final check. Native macOS/Linux launch is covered; Windows executable/drive conventions and interactive GUI confirmation are not established by this phase.

## Phase 11 framework integrations

The same configuration contract is shared by React/Vite, Vue/Vite, Next/React and Nuxt. Import `defineConfig` from the installed integration package. Vue uses the Vite mode; Next and Nuxt select `development`. New source defaults, startup, client/server boundaries and the CLI's Vite-specific dev/doctor limits are documented in the [framework guide](frameworks.md). The shared Node implementation now lives in `@sonht113/server`; existing Vite exports remain compatible.
