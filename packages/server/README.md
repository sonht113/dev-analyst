# @sonht113/server

Shared development-only Node.js bridge, source mapping, analysis workers, cache and selected inspection services.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

This package is a shared dependency of the DevAnalyst integrations. For application setup, install the matching `@sonht113/vite-plugin`, `@sonht113/vue-plugin`, `@sonht113/next-plugin` or `@sonht113/nuxt-module` integration. Use public exports only; private source imports are unsupported.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
