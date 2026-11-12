import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { defineConfig } from '@devanalyst/core';
import { createWorkspaceAccess } from './workspace.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ base: string; root: string }> {
  const base = await mkdtemp(join(tmpdir(), 'devanalyst-access-'));
  roots.push(base);
  const root = join(base, 'workspace');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.tsx'), 'export const source = true;');
  return { base, root };
}

describe('workspace access', () => {
  it('reads allowed source and maps allowed watcher paths to relative paths', async () => {
    const { root } = await fixture();
    const access = await createWorkspaceAccess(root, defineConfig({}).source);
    expect(await access.readSource('src/main.tsx')).toBe('export const source = true;');
    expect(await access.sourcePath(join(root, 'src/main.tsx'))).toBe('src/main.tsx');
    expect(await access.sourcePath(join(root, 'src/deleted.tsx'), true)).toBe('src/deleted.tsx');
  });

  it('rejects traversal, absolute paths, and source outside the allowlist', async () => {
    const { base, root } = await fixture();
    await writeFile(join(base, 'outside.tsx'), 'private');
    await writeFile(join(root, 'private.tsx'), 'private');
    const access = await createWorkspaceAccess(root, defineConfig({}).source);
    for (const file of [
      '../outside.tsx',
      join(base, 'outside.tsx'),
      'C:\\secret.tsx',
      'private.tsx',
      'src/../../outside.tsx',
    ]) {
      await expect(access.readSource(file)).rejects.toMatchObject({
        code: 'WORKSPACE_ACCESS_DENIED',
      });
    }
  });

  it('rejects sensitive paths even with broad user include patterns', async () => {
    const { root } = await fixture();
    const access = await createWorkspaceAccess(
      root,
      defineConfig({ source: { include: ['**'] } }).source,
    );
    for (const file of [
      'src/.env',
      'src/.env.production.json',
      '.aws/credentials.json',
      '.git/config.json',
      'src/certificate.pem',
    ]) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), 'private');
      await expect(access.readSource(file)).rejects.toMatchObject({
        code: 'WORKSPACE_ACCESS_DENIED',
      });
      expect(await access.sourcePath(join(root, file))).toBeNull();
    }
  });

  it('rejects file and directory symlink escapes and excluded canonical targets', async () => {
    const { base, root } = await fixture();
    await mkdir(join(base, 'outside'));
    await writeFile(join(base, 'outside/secret.tsx'), 'private');
    await writeFile(join(root, 'src/.env.private.tsx'), 'private');
    await symlink(join(base, 'outside/secret.tsx'), join(root, 'src/linked.tsx'));
    await symlink(join(base, 'outside'), join(root, 'src/directory'));
    await symlink(join(root, 'src/.env.private.tsx'), join(root, 'src/hidden.tsx'));
    const access = await createWorkspaceAccess(root, defineConfig({}).source);
    for (const file of ['src/linked.tsx', 'src/directory/secret.tsx', 'src/hidden.tsx']) {
      await expect(access.readSource(file)).rejects.toMatchObject({
        code: 'WORKSPACE_ACCESS_DENIED',
      });
      expect(await access.sourcePath(join(root, file))).toBeNull();
    }
    expect(await access.sourcePath(join(root, 'src/directory/deleted.tsx'), true)).toBeNull();
  });

  it('bounds read size before allocating source data', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'src/large.tsx'), Buffer.alloc(256 * 1024 + 1));
    const access = await createWorkspaceAccess(root, defineConfig({}).source);
    await expect(access.readSource('src/large.tsx')).rejects.toMatchObject({
      code: 'SOURCE_TOO_LARGE',
    });
  });

  it('accepts canonical and alias watcher paths for an explicitly symlinked workspace root', async () => {
    const { base, root } = await fixture();
    const alias = join(base, 'alias');
    await symlink(root, alias);
    const access = await createWorkspaceAccess(alias, defineConfig({}).source);
    expect(await access.sourcePath(join(root, 'src/main.tsx'))).toBe('src/main.tsx');
    expect(await access.sourcePath(join(alias, 'src/main.tsx'))).toBe('src/main.tsx');
    expect(await access.readSource('src/main.tsx')).toBe('export const source = true;');
  });

  it('authorizes unlink notices after the containing directory has already been removed', async () => {
    const { root } = await fixture();
    const directory = join(root, 'src/nested/deep');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'removed.tsx'), 'export {};');
    const access = await createWorkspaceAccess(root, defineConfig({}).source);
    await rm(join(root, 'src/nested'), { recursive: true });
    expect(await access.sourcePath(join(directory, 'removed.tsx'), true)).toBe(
      'src/nested/deep/removed.tsx',
    );
    await expect(access.readSource('src/nested/deep/removed.tsx')).rejects.toMatchObject({
      code: 'WORKSPACE_ACCESS_DENIED',
    });
  });
});
