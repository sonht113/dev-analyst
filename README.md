# DevAnalyst

AI-Powered Frontend Code Inspector.

**React + Vite + TypeScript is the only currently supported framework combination.** DevAnalyst must deliver the [complete 18-feature plan](docs/implementation-plan.md) before product completion.

## Phase 02 status

Implemented: automatic development-only browser runtime injection, authenticated loopback WebSocket bridge, connection tracking, browser-reported routes, source-change notifications, reconnection/teardown, configurable bridge ports, workspace access guards, and CLI dev/doctor commands.

Inspector UI, DOM-to-JSX mapping, React logic analysis, Claude execution, translation, pre-analysis, persistent caching, and editor navigation remain planned. The bridge does not invoke AI, collect input/history-state values, expose source-read RPCs, or infer routes from terminal logs. All packages remain private; NPM scope ownership is unverified.

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

In browser developer tools, `window.__DEVANALYST_BRIDGE__?.getSnapshot()` reports status, acknowledged route, and last source/error metadata without exposing credentials. `reconnect()` restarts the local connection; `stop()` closes it and restores history/listeners where still owned. The runtime also emits `devanalyst:bridge` events. Plugin `api.ready` and `api.getSnapshot()` provide credential-free Node diagnostics.

Routes come directly from initial page state, `pushState`, `replaceState`, `popstate`, and `hashchange`. Query strings, history state, and opaque fragments are omitted. Hash routes beginning `#/` or `#!/` retain only the route pathname; other fragment changes are detected without collecting their values. Path segments themselves may contain application identifiers, so these snapshots stay local and are not automatically sent to AI.

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
- [Phase 02 validation](docs/phase-02-validation.md)
- [Historical Phase 01 validation](docs/phase-01-validation.md)

## Future Roadmap

Next.js, Vue, Nuxt, Angular, Svelte, and other frameworks have no active phases, dependencies, playgrounds, or test targets. Consider expansion only after complete React + Vite delivery and an explicit owner scope change. The full React + Vite feature set remains mandatory.
