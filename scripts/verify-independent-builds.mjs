import assert from 'node:assert/strict';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { readWorkspaces } from './check-boundaries.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = (await readWorkspaces(root)).filter(({ manifest }) =>
  manifest.name.startsWith('@devanalyst/'),
);

for (const target of packages) {
  for (const workspace of packages) {
    await rm(resolve(workspace.directory, 'dist'), { recursive: true, force: true });
  }
  const result = spawnSync('pnpm', ['--filter', target.manifest.name, 'build'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    `${target.manifest.name}: isolated build failed\n${result.stdout}\n${result.stderr}`,
  );
  await access(resolve(target.directory, 'dist/index.js'));
  await access(resolve(target.directory, 'dist/index.d.ts'));
  console.log(`${target.manifest.name}: independently builds from clean package outputs`);
}

const restore = spawnSync('pnpm', ['build:packages'], {
  cwd: root,
  encoding: 'utf8',
  shell: false,
});
assert.equal(restore.status, 0, restore.stderr);
