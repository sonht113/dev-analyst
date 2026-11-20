# @sonht113/vue-plugin

Development-only DevAnalyst integration for Vue 3 + Vite.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

```sh
pnpm add -D @sonht113/vue-plugin@beta
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { devanalystVue } from '@sonht113/vue-plugin';

export default defineConfig({ plugins: [devanalystVue(), vue()] });
```

Register one DevAnalyst integration only. The verified baseline is Vue/compiler 3.5.45 and Vite 8.3.5. Native template elements with inline `<script setup>` JS/TS are supported; Options-API-only templates, render functions and server execution remain outside the mapping envelope.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
