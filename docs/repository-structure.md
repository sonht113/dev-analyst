# Repository structure

Phase 11 explicitly authorizes four framework targets. [ADR 0013](adr/0013-framework-adapters.md) supersedes the previous React-only layout for Next/React, Vue/Vite and Nuxt. The active workspace contains eleven libraries, four applications and the root (sixteen projects).

```text
apps/
├── playground-react/       # React + Vite
├── playground-next/        # Next App Router, dev.mjs wrapper
├── playground-vue/         # Vue SFC + Vite + Router
└── playground-nuxt/        # Nuxt 4, default Vite builder
packages/
├── core/                   # Browser-safe contracts
├── inspector/              # Shared browser UI/runtime and origin registry
├── analyzer/               # JSX/SFC mapping, guarded source/worker analysis
├── ai/                     # Enforced opt-in Claude Code CLI
├── cache/                  # Worker-owned SQLite
├── server/                 # Shared development Node services/config/editor
├── vite-plugin/            # React Vite host, compatibility exports
├── vue-plugin/             # Vue strategy on the Vite host
├── next-plugin/            # Public Next dev server/loaders/client bootstrap
├── nuxt-module/            # Public Nuxt lifecycle/module
└── cli/                    # Operational commands
scripts/
├── check-boundaries.mjs
├── verify-independent-builds.mjs
└── verify-packages.mjs
tests/
├── active/integration/     # Guarded Node/native framework/production journeys
├── active/boundaries.test.ts
├── e2e/                    # Active Chromium suites, including frameworks.spec.ts
└── unit/                   # Preserved historical tests, excluded
```

Source unit tests live beside implementation. Each library emits ESM, declarations and source/declaration maps into ignored `dist/`. Explicit package exports and TypeScript project references enforce boundaries; package verification checks local archives without publishing.

Dependencies, generated framework output, private configuration, owned temporary fixtures and test artifacts are omitted. Historical `tests/e2e/playgrounds.spec.ts` remains excluded in favor of current native framework suites. Further frameworks and deletion of unrelated completed source remain unauthorized.

See [architecture](architecture.md), [framework installation/limits](frameworks.md), [testing](testing.md) and [progress](progress.md).
