# @sonht113/next-plugin

Development-only DevAnalyst integration for Next.js App Router client JSX, using a public custom development server and compiler loader.

Beta release `0.1.0-beta.1`; APIs and the verified compatibility envelope may change. Requires ESM and Node.js `^22.22.3 || ^24.15.0`.

```sh
pnpm add -D @sonht113/next-plugin@beta
```

```ts
// next.config.ts
import { withDevAnalyst } from '@sonht113/next-plugin';
export default withDevAnalyst({ reactStrictMode: true });
```

Add `<DevAnalystClient />` from `@sonht113/next-plugin/client` once inside the root layout body. Start development through the required public wrapper:

```js
// dev.mjs
import { startNextDevelopment } from '@sonht113/next-plugin';

const server = await startNextDevelopment({
  root: process.cwd(),
  port: 3000,
  bundler: 'turbopack',
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

Set the application `dev` script to `node dev.mjs`. Keep native `next build` and `next start` for production. Plain `next dev` does not start this instrumentation.

The verified baseline is Next 16.4.6 with React 19.3.1, App Router and Webpack/Turbopack on local HTTP. Mapping applies to explicit `'use client'` JSX/TSX; Server Components and Server Actions remain UNKNOWN. Read the complete framework guide before adopting a custom Next configuration.

DevAnalyst is development-only. AI is opt-in, source access is bounded by explicit policy, and source-backed findings distinguish VERIFIED, INFERRED and UNKNOWN. Static code references do not prove runtime execution.

Documentation: [setup](https://github.com/sonht113/dev-analyst#readme), [framework support](https://github.com/sonht113/dev-analyst/blob/master/docs/frameworks.md), [configuration](https://github.com/sonht113/dev-analyst/blob/master/docs/configuration.md), [Claude provider](https://github.com/sonht113/dev-analyst/blob/master/docs/claude-code.md).

License: MIT.
