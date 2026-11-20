# @sonht113/nuxt-module

Development-only DevAnalyst module for Nuxt 4 with the Vite builder.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

```sh
pnpm add -D @sonht113/nuxt-module@beta
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@sonht113/nuxt-module'],
});
```

Run the normal Nuxt development command. The verified baseline is Nuxt 4.6.4 with Vue 3.5.45 and the Vite builder over local HTTP. Browser mapping does not establish Nitro/server execution. See the framework guide for supported SFC syntax and limitations.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
