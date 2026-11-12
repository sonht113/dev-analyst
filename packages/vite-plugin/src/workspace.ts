import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep, dirname } from 'node:path';
import picomatch from 'picomatch';
import { DevAnalystError, workspacePathSchema, type DevAnalystConfig } from '@devanalyst/core';

export interface WorkspaceAccess {
  sourcePath(absolute: string, deleted?: boolean): Promise<string | null>;
  readSource(file: string): Promise<string>;
}

/** Authorized workspace reads only. No filesystem operation is exposed over the bridge. */
export async function createWorkspaceAccess(
  root: string,
  source: DevAnalystConfig['source'],
): Promise<WorkspaceAccess> {
  const canonicalRoot = await realpath(root);
  const includes = picomatch(source.include, { dot: true });
  const excludes = picomatch(source.exclude, { dot: true });
  const extensions = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.css',
    '.scss',
    '.html',
    '.json',
  ]);
  const forbidden = new Set([
    '.git',
    '.ssh',
    '.aws',
    'node_modules',
    '.npmrc',
    '.netrc',
    'id_rsa',
    'id_ed25519',
  ]);

  function eligible(file: string): boolean {
    const parsed = workspacePathSchema.safeParse(file);
    if (!parsed.success || parsed.data !== file || file.includes('\\')) return false;
    const parts = file.split('/');
    return (
      parts.every((part) => !forbidden.has(part.toLowerCase()) && !/^\.env(?:\.|$)/i.test(part)) &&
      extensions.has(extname(file).toLowerCase()) &&
      includes(file) &&
      !excludes(file)
    );
  }

  function contained(absolute: string): string | null {
    const file = relative(canonicalRoot, absolute);
    if (!file || isAbsolute(file) || file === '..' || file.startsWith(`..${sep}`)) return null;
    return file.split(sep).join('/');
  }

  async function canonicalTarget(candidate: string, deleted: boolean): Promise<string> {
    if (!deleted) return realpath(candidate);
    let parent = dirname(candidate);
    for (;;) {
      try {
        return resolve(await realpath(parent), relative(parent, candidate));
      } catch (cause: unknown) {
        const missing =
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          (cause.code === 'ENOENT' || cause.code === 'ENOTDIR');
        const next = dirname(parent);
        if (!missing || next === parent) throw cause;
        parent = next;
      }
    }
  }

  async function authorize(file: string, deleted: boolean): Promise<string | null> {
    if (!eligible(file)) return null;
    const candidate = resolve(canonicalRoot, file);
    try {
      const canonicalFile = contained(await canonicalTarget(candidate, deleted));
      return canonicalFile !== null && eligible(canonicalFile) ? candidate : null;
    } catch {
      return null;
    }
  }

  return {
    async sourcePath(absolute, deleted = false) {
      const path = resolve(absolute);
      const canonical = contained(path);
      if (canonical !== null)
        return (await authorize(canonical, deleted)) === null ? null : canonical;
      const alias = relative(resolve(root), path);
      if (alias && !isAbsolute(alias) && alias !== '..' && !alias.startsWith(`..${sep}`)) {
        const file = alias.split(sep).join('/');
        return (await authorize(file, deleted)) === null ? null : file;
      }
      // Kernel/OS aliases (for example /var vs /private/var) can lie outside both
      // lexical roots. Resolve them, then reapply canonical containment and policy.
      try {
        const file = contained(await canonicalTarget(path, deleted));
        return file !== null && (await authorize(file, deleted)) !== null ? file : null;
      } catch {
        return null;
      }
    },
    async readSource(file) {
      try {
        const candidate = await authorize(file, false);
        if (candidate === null)
          throw new DevAnalystError(
            'WORKSPACE_ACCESS_DENIED',
            'Choose an allowed source file inside the configured workspace.',
          );
        const before = await stat(candidate);
        const maximum = 256 * 1024;
        if (!before.isFile() || before.size > maximum)
          throw new DevAnalystError(
            'SOURCE_TOO_LARGE',
            'Source reads are limited to regular files up to 256 KiB.',
          );
        const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const opened = await handle.stat();
          const actual = contained(await realpath(candidate));
          if (
            opened.dev !== before.dev ||
            opened.ino !== before.ino ||
            actual === null ||
            !eligible(actual)
          ) {
            throw new DevAnalystError(
              'WORKSPACE_ACCESS_DENIED',
              'The source path changed during authorization.',
            );
          }
          const buffer = Buffer.alloc(maximum + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const after = await handle.stat();
          if (bytesRead > maximum)
            throw new DevAnalystError('SOURCE_TOO_LARGE', 'Source reads are limited to 256 KiB.');
          if (
            opened.mtimeMs !== after.mtimeMs ||
            opened.size !== after.size ||
            bytesRead !== after.size
          ) {
            throw new DevAnalystError(
              'SOURCE_CHANGED',
              'Source changed while reading. Retry the request.',
            );
          }
          return buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          await handle.close();
        }
      } catch (cause: unknown) {
        if (cause instanceof DevAnalystError) throw cause;
        throw new DevAnalystError(
          'WORKSPACE_ACCESS_DENIED',
          'The allowed source file could not be read safely. Check permissions and retry.',
          { cause },
        );
      }
    },
  };
}
