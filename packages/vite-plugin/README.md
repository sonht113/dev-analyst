# @sonht113/vite-plugin

Development-only DevAnalyst integration for React + Vite.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

```sh
pnpm add -D @sonht113/vite-plugin@beta
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devanalyst } from '@sonht113/vite-plugin';

export default defineConfig({ plugins: [react(), devanalyst()] });
```

Run your normal Vite development command. Use the floating switch to disable or enable all hover/selection and tab-owned analysis. Alt+Click selects an element for expanded source analysis.

The verified baseline is Vite 8.3.5 with React 19.3.1, standalone local HTTP development. HTTPS and middleware-mode hosts are outside the verified envelope.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
