# Framework integrations

Phase 11 adds Next.js + React, Vue 3 + Vite and Nuxt 4 to React + Vite, by explicit owner authorization ([ADR 0013](adr/0013-framework-adapters.md)). The MIT beta uses `@sonht113/*` ([ADR 0017](adr/0017-mit-beta-publication.md)); see [release status and installation](releasing.md) before installing from npm. Add the corresponding integration as a development dependency. Workspace consumers use `workspace:*` and build prerequisites with `pnpm build:packages` first.

## Verified envelope

| Target          | Tested versions                                                  | Development startup                            | Source mapping                                     |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| React + Vite    | Vite 8.3.5, React 19.3.1                                         | Existing `devanalyst()` Vite plugin            | Safe intrinsic JSX public refs                     |
| Vue + Vite      | Vue/compiler 3.5.45, plugin-vue 6.0.11, Vite 8.3.5, Router 5.5.1 | `devanalystVue()` Vite plugin                  | Original SFC template + public directive lifecycle |
| Next.js + React | Next 16.4.6, React 19.3.1; Webpack and Turbopack                 | Public custom development server wrapper below | Explicit `'use client'` JSX/TSX only               |
| Nuxt            | Nuxt/Kit 4.6.4, Vue 3.5.45, Vite 8.3.5, Nitro 2.13.6             | Nuxt module below                              | Hydrated client SFC template + directives          |

Verification uses native compilers/servers, Chromium, source evidence, HMR and route-aware workers, plus native production builds and servers. See [executed checks](phase-11-validation.md). Compatibility beyond the tested version envelope is unverified. Current Next/Nuxt peer ranges intentionally stay within their tested minor. No server-only execution or full framework semantic coverage is claimed.

## Vue 3 with Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { devanalystVue } from '@sonht113/vue-plugin';

export default defineConfig({ plugins: [devanalystVue(), vue()] });
```

Keep only one DevAnalyst Vite plugin. The shared bridge starts automatically with normal `vite` startup. The Vue strategy does not use React refs, Fiber or component instance internals. It preserves application refs/directives, uses original SFC ranges and merges repeated template sites into per-DOM provenance. Template-only HMR preserves component state. Vite base paths are handled by the shared host integration.

Supported mapping uses native template elements and inline `<script setup>` in JS/TS, with the normal HTML template compiler. Render functions/JSX, Options-API-only SFCs, external blocks, template preprocessors, TSX setup and upstream-rewritten SFCs are uninstrumented. Custom/component tags do not acquire fabricated native origins. Dynamic HTML, model/control/private/editable text cannot become translation context. Interpolated text remains local.

Static analysis covers explicit `v-if`/`v-else-if`/`v-else`, `v-for`, `v-show`, disabled bindings and event bindings with original evidence. Direct, symbol-resolved local/imported handlers can reach shared TypeScript call/API analysis. Template loop shadowing, dynamic handlers and unsupported expressions stay UNKNOWN. Explicit Vue imports identify ref/reactive/computed/watch/lifecycle source patterns; this does not inspect reactive values or prove execution. Complex destructuring, macro-generated symbols and framework auto-import resolution are not claimed.

## Next.js

Register the compiler configuration helper:

```ts
// next.config.ts
import { withDevAnalyst } from '@sonht113/next-plugin';
export default withDevAnalyst({ reactStrictMode: true });
```

Include the client bootstrap once in the App Router root layout:

```tsx
import { DevAnalystClient } from '@sonht113/next-plugin/client';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <DevAnalystClient />
        {children}
      </body>
    </html>
  );
}
```

Use the public development wrapper in a development-only script:

```js
// dev.mjs
import process from 'node:process';
import { startNextDevelopment } from '@sonht113/next-plugin';
const server = await startNextDevelopment({
  root: process.cwd(),
  port: 3000,
  bundler: 'turbopack', // or 'webpack'
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
```

Set `dev` to `node dev.mjs`; retain native `next build` and `next start` for production. No manual bridge process, token, socket path or port coordination is needed. The wrapper owns and removes its private compiler channel; it uses fixed loopback HTTP and one instance per process. Native `next dev` without the wrapper is deliberately uninstrumented. Never use the development wrapper as a production server.

Only explicit `'use client'` `.tsx`/`.jsx` files receive safe React instrumentation. A Server Component's DOM remains UNKNOWN; putting a client child beneath a server page does not expose the server page. Transitive client modules without an explicit directive remain uninstrumented. `'use server'` and `server-only` modules are excluded from browser-origin behavior tracing; their dependency hashes can invalidate caches without publishing their bodies as client facts. Shared source references still establish only static relationships.

The tested setup uses App Router, root base path, local HTTP, native macOS and the listed bundlers. Compiler IPC targets native macOS/Linux; Linux execution awaits CI. Pages Router, Edge runtime, Windows compiler IPC, HTTPS/proxy/remote hosting, custom `basePath`/`assetPrefix`/`distDir`, static export, standalone output and third-party compiler pipelines are unverified. Existing conflicting Turbopack TSX/JSX rules are preserved with a fixed warning and mapping disabled; use an unmodified loader configuration. Production Webpack and Turbopack builds remain native and exclude instrumentation.

## Nuxt 4

```ts
// nuxt.config.ts
export default defineNuxtConfig({ modules: ['@sonht113/nuxt-module'] });
```

Normal `nuxt dev` automatically attaches the shared development services to the public Nuxt/Vite/server lifecycle and injects the client runtime. The module adds a development-only `page:finish` notification so committed Nuxt navigation triggers new structural pre-analysis even when navigation started before hydration. It never sends page values/query strings.

The tested configuration is the default Vite builder, local HTTP, default app directory and Nitro 2 development runtime. Nitro 3, the Webpack/Rspack builders, layers, customized source directories, external runtime presets, SSR-disabled/static output, proxies/HTTPS and non-default base URLs are unverified. Unsupported builders and HTTPS disable injection with a fixed diagnostic. Production module setup returns before hooks or injection are added. Nitro routes, server plugins, server middleware and server-only composables are not inferred from DOM provenance. Explicit Composition API imports receive evidence; auto-imports are UNKNOWN unless independently resolved by supported source analysis.

## Configuration, diagnosis and recovery

All integrations share [typed configuration, consent, shortcuts, depth, exclusions, debug and editor safeguards](configuration.md). Import `defineConfig` from the installed integration (`@sonht113/vue-plugin`, `@sonht113/next-plugin` or `@sonht113/nuxt-module`). Vue uses the Vite mode; Next/Nuxt select the `development` environment. Config changes require restart. Next source defaults include `app/**`, `src/**`, `pages/**`; Nuxt includes `app/**`, `components/**`, `pages/**`, `composables/**`. Extend includes explicitly for authorized local packages. Mandatory sensitive exclusions still apply.

`devanalyst status --url http://127.0.0.1:<app-port>` reads the same credential-free diagnostics for every target. `devanalyst dev` and its project/plugin `doctor` checks remain Vite-specific; start Next/Nuxt through their documented integrations. Offline `analyze` currently defaults to React; use the public analyzer API with `framework: 'vue-vite' | 'nuxt' | 'next-react'` for explicit framework analysis. Do not interpret a Vite-only doctor result as evidence that a Next/Nuxt integration is broken.

If mapping is UNKNOWN, check the source boundary/SFC envelope, source allowlist, current revision and dev startup first. Invalid configuration leaves the host usable and reports `INVALID_CONFIG` through diagnostics. If the bridge cannot bind, use a free loopback port and restart. If Next compiler IPC is unavailable, check native OS/temp-directory permissions; the host runs with mapping unavailable. Correct syntax and reload after failed compilation. Source links still require a current registry identity, allowed canonical file and exact one-based position before `code` or `cursor` is invoked; no browser file-read RPC is introduced.

Claude remains opt-in, with path consent, source/hash checks, no-tools subprocess enforcement, secret filtering and bounded context. Original `.vue` hashes/ranges are checked directly; generated projections are never presented as original source. Shared SQLite cache policy includes the selected framework so incompatible adapter results cannot be reused. Live authenticated model success remains unverified.

## Repository journeys

Run `pnpm dev:react`, `pnpm dev:vue`, `pnpm dev:next` or `pnpm dev:nuxt`. Each realistic playground includes source-backed interaction; the new apps include services, conditions and dynamic navigation. Vue adds keyed rows/reordering, a genuinely async component and a private/password subtree. Next includes server/client boundary examples; Nuxt exercises SSR hydration and file routes.

`pnpm exec playwright test tests/e2e/frameworks.spec.ts --workers=1` covers new development integrations. `pnpm exec vitest run tests/active/integration/production-frameworks.test.ts` covers native production exclusion. Root aggregate commands include all eleven packages and four apps. Tests create and remove only owned temporary copies. See [testing policy](testing.md) for the complete checks and remaining product gates.
