import process from 'node:process';
import { startNextDevelopment } from '@devanalyst/next-plugin';
const server = await startNextDevelopment({
  root: process.cwd(),
  port: Number(process.env.PORT ?? 3000),
  bundler: process.env.DEVANALYST_TEST_BUNDLER === 'webpack' ? 'webpack' : 'turbopack',
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
