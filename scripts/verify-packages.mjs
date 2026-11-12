import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { readWorkspaces } from './check-boundaries.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspaces = await readWorkspaces(root);

for (const { directory, manifest } of workspaces) {
  if (!manifest.name.startsWith('@devanalyst/')) continue;
  /** @type {{exports: Record<string, {types: string, import: string}>, bin?: Record<string, string>}} */
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const entry = metadata.exports['.'];
  assert.ok(entry, `${manifest.name}: missing public export`);
  await access(resolve(directory, entry.types));
  await access(resolve(directory, entry.import));
  await access(resolve(directory, `${entry.types}.map`));
  await access(resolve(directory, `${entry.import}.map`));
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', 'await import(process.argv[1]);', manifest.name],
    { cwd: directory, encoding: 'utf8', shell: false },
  );
  assert.equal(
    imported.status,
    0,
    `${manifest.name}: public ESM import failed\n${imported.stderr}`,
  );
  const privateImport = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `try { await import(process.argv[1]); process.exitCode = 1; }
       catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }`,
      `${manifest.name}/src/index.ts`,
    ],
    { cwd: directory, encoding: 'utf8', shell: false },
  );
  assert.equal(privateImport.status, 0, `${manifest.name}: private source import was not blocked`);
  const destination = await mkdtemp(resolve(tmpdir(), 'devanalyst-pack-'));
  try {
    const packed = spawnSync('pnpm', ['pack', '--pack-destination', destination], {
      cwd: directory,
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(packed.status, 0, `${manifest.name}: package creation failed\n${packed.stderr}`);
    const archive = (await readdir(destination)).find((name) => name.endsWith('.tgz'));
    assert.ok(archive, `${manifest.name}: package archive missing`);
    const contents = spawnSync('tar', ['-tzf', resolve(destination, archive)], {
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(contents.status, 0, contents.stderr);
    const files = contents.stdout.split('\n');
    for (const expected of [
      'package/dist/index.js',
      'package/dist/index.d.ts',
      'package/src/index.ts',
    ]) {
      assert.ok(files.includes(expected), `${manifest.name}: missing ${expected} in archive`);
    }
    assert.ok(
      !files.some((file) => file.includes('.test.') || file.includes('.tsbuildinfo')),
      `${manifest.name}: test or incremental-build artifacts included in archive`,
    );
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
  console.log(`${manifest.name}: exports, declarations, source maps, and local packaging passed`);
}

const cli = resolve(root, 'packages/cli/dist/bin.js');
const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', shell: false });
assert.equal(help.status, 0);
assert.match(help.stdout, /Usage: devanalyst/);
const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', shell: false });
const metadata = JSON.parse(await readFile(resolve(root, 'packages/cli/package.json'), 'utf8'));
assert.equal(version.status, 0);
assert.equal(version.stdout.trim(), metadata.version);
const invalid = spawnSync(process.execPath, [cli, 'inspect'], { encoding: 'utf8', shell: false });
assert.equal(invalid.status, 2);
assert.equal(JSON.parse(invalid.stderr).code, 'UNSUPPORTED_FEATURE');
console.log('CLI executable smoke checks passed.');
