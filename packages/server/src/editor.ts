import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DevAnalystError,
  configSchema,
  sourceReferenceSchema,
  type DevAnalystConfig,
} from '@devanalyst/core';
import { createWorkspaceAccess } from './workspace.js';

/** Fixed executable, no shell/URI handlers. The local CLI/editor remains a trusted boundary. */
export async function openSource(
  root: string,
  configuration: DevAnalystConfig,
  input: unknown,
  revision?: string,
): Promise<void> {
  const settings = configSchema.safeParse(configuration);
  if (!settings.success)
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Check editor.command and source policy in DevAnalyst configuration.',
    );
  const config = settings.data;
  if (!config.editor.enabled || process.env['NODE_ENV'] === 'production')
    throw new DevAnalystError(
      'DEVELOPMENT_ONLY',
      'Editor navigation is disabled. Enable editor.enabled in a development session.',
    );
  const parsed = sourceReferenceSchema.safeParse(input);
  if (!parsed.success || !parsed.data.start)
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Choose an exact source file with a one-based line and column.',
    );
  const reference = parsed.data;
  const workspace = await realpath(resolve(root, config.workspaceRoot));
  const access = await createWorkspaceAccess(workspace, config.source);
  const canonical = await access.canonicalSourcePath(resolve(workspace, reference.file));
  if (
    !canonical ||
    [...canonical].some(
      (character) =>
        character === ':' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new DevAnalystError(
      'WORKSPACE_ACCESS_DENIED',
      'Choose an allowed source file inside the workspace; excluded files and unsafe paths cannot open.',
    );
  const source = await access.readSource(canonical);
  if (
    revision !== undefined &&
    (!/^[a-f0-9]{64}$/.test(revision) ||
      createHash('sha256').update(source).digest('hex') !== revision)
  )
    throw new DevAnalystError(
      'SOURCE_CHANGED',
      'Source revision changed. Save and refresh inspection before opening the editor.',
    );
  const position = parsed.data.start;
  const lines = source.split(/\r?\n/);
  if (position.line > lines.length || position.column > (lines[position.line - 1]?.length ?? 0) + 1)
    throw new DevAnalystError(
      'SOURCE_CHANGED',
      'The source position is no longer valid. Refresh inspection after saving the file.',
    );
  const target = resolve(workspace, canonical);
  const before = await stat(target);
  const rechecked = await access.readSource(canonical);
  const after = await stat(target);
  if (
    rechecked !== source ||
    [...target].some(
      (character) =>
        character === ':' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    (await realpath(target)) !== target ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new DevAnalystError(
      'SOURCE_CHANGED',
      'Source changed during navigation. Refresh and retry.',
    );
  await new Promise<void>((done, reject) => {
    const child = spawn(
      config.editor.command,
      ['--reuse-window', '--goto', `${target}:${position.line}:${position.column}`],
      { shell: false, stdio: 'ignore', windowsHide: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      const force = setTimeout(() => child.kill('SIGKILL'), 250);
      force.unref();
      child.once('exit', () => clearTimeout(force));
      reject(
        new DevAnalystError(
          'INTERNAL_ERROR',
          'Editor launch timed out. Start the editor and retry.',
        ),
      );
    }, 5000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(
        new DevAnalystError(
          'UNSUPPORTED_FEATURE',
          'Editor CLI unavailable. Install code or cursor in PATH from the editor command palette, then restart Vite.',
        ),
      );
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else
        reject(
          new DevAnalystError(
            'UNSUPPORTED_FEATURE',
            'Editor launch failed. Check the code/cursor command in PATH and retry.',
          ),
        );
    });
  });
}
