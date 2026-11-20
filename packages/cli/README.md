# @sonht113/cli

DevAnalyst command-line diagnostics, configuration setup, Vite development, source analysis, cache administration and editor navigation.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

```sh
pnpm add -D @sonht113/cli@beta
pnpm exec devanalyst --version
pnpm exec devanalyst --help
```

For a React/Vite app with its DevAnalyst plugin already registered:

```sh
pnpm exec devanalyst doctor .
pnpm exec devanalyst status . --url http://127.0.0.1:5173/
```

Project `dev` and `doctor` are Vite-specific. `setup` creates configuration without overwriting files or enabling AI. Stop the development server before offline cache clearing. See the CLI/configuration guide for source analysis and guarded editor commands.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
