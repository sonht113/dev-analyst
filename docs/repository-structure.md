# Repository structure

**React + Vite + TypeScript is the only currently supported framework combination.** The active product boundaries below follow [ADR 0003](adr/0003-react-vite-scope.md). The complete on-disk inventory also retains completed historical work; its presence does not authorize additional framework development.

## Active product layout

```text
apps/
└── playground-react/
packages/
├── core/
├── vite-plugin/
├── inspector/
├── analyzer/
├── ai/
├── cache/
└── cli/
```

See [architecture](architecture.md) for responsibilities and [the implementation plan](implementation-plan.md) for all required features. No additional framework package, adapter, or playground is planned in active phases.

## Physical source inventory

The active workspace consists of seven libraries and the React playground. Historical framework directories/tests remain on disk, excluded from active workspace installation, lockfile importers, build/typecheck/lint/test/package targets, and CI. They are retained code, not current support or future commitments; see [progress](progress.md#retained-historical-work-and-usage).

Generated outputs, dependencies, Git internals, private local files, owned temporary fixtures, and test reports are omitted. Each active library build emits ESM, declarations, and source maps into `dist/`.

```text
.
├── .github/
│   └── workflows/
│       └── ci.yml
├── apps/
│   ├── playground-next/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── AGENTS.md
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.build.json
│   │   └── tsconfig.json
│   ├── playground-nuxt/
│   │   ├── app/
│   │   │   └── app.vue
│   │   ├── nuxt.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── playground-react/
│   │   ├── src/
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   └── playground-vue/
│       ├── src/
│       │   ├── App.vue
│       │   └── main.ts
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── docs/
│   ├── adr/
│   │   ├── 0001-initial-architecture.md
│   │   ├── 0002-monorepo-foundation.md
│   │   ├── 0003-react-vite-scope.md
│   │   └── 0004-vite-local-bridge.md
│   ├── architecture.md
│   ├── implementation-plan.md
│   ├── phase-01-validation.md
│   ├── phase-02-validation.md
│   ├── progress.md
│   ├── project-constitution.md
│   ├── repository-structure.md
│   └── testing.md
├── packages/
│   ├── ai/
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── analyzer/
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cache/
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli/
│   │   ├── src/
│   │   │   ├── bin.ts
│   │   │   ├── index.test.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core/
│   │   ├── src/
│   │   │   ├── bridge.test.ts
│   │   │   ├── config.test.ts
│   │   │   ├── config.ts
│   │   │   ├── errors.ts
│   │   │   ├── events.test.ts
│   │   │   ├── events.ts
│   │   │   ├── findings.test.ts
│   │   │   ├── findings.ts
│   │   │   ├── index.ts
│   │   │   ├── logger.test.ts
│   │   │   └── logger.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── inspector/
│   │   ├── src/
│   │   │   ├── bridge-runtime.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── next-plugin/
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── vite-plugin/
│   │   ├── src/
│   │   │   ├── bridge.ts
│   │   │   ├── index.ts
│   │   │   ├── security.test.ts
│   │   │   ├── workspace.test.ts
│   │   │   └── workspace.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── vue-plugin/
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── scripts/
│   ├── check-boundaries.mjs
│   ├── verify-independent-builds.mjs
│   └── verify-packages.mjs
├── tests/
│   ├── active/
│   │   ├── integration/
│   │   │   ├── bridge.test.ts
│   │   │   ├── cli.test.ts
│   │   │   └── production-react.test.ts
│   │   └── boundaries.test.ts
│   ├── e2e/
│   │   ├── bridge.spec.ts
│   │   └── playgrounds.spec.ts
│   └── unit/
│       └── boundaries.test.ts
├── .editorconfig
├── .gitignore
├── .npmrc
├── .nvmrc
├── .prettierignore
├── .prettierrc.json
├── AGENTS.md
├── README.md
├── devanalyst.config.ts
├── eslint.config.mjs
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── tsconfig.package.json
├── tsconfig.packages.json
├── tsconfig.tools.json
└── vitest.config.ts
```

## Future Roadmap

Other framework support requires an explicit owner scope change after complete React + Vite delivery. No additional framework work is authorized by this inventory.
