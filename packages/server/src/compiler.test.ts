import { describe, expect, it } from 'vitest';
import { requestCompiler, startCompilerService } from './compiler.js';
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
describe('owner-only compiler channel', () => {
  it('uses private socket permissions, validates compiler identity and closes resources', async () => {
    const calls: string[] = [];
    const service = await startCompilerService(async (file, revision) => {
      calls.push(file);
      expect(revision).toBe('a'.repeat(64));
      return { code: 'export const value=1;', map: null };
    });
    try {
      expect((await stat(dirname(service.path))).mode & 0o777).toBe(0o700);
      expect((await stat(service.path)).mode & 0o777).toBe(0o600);
      expect(await requestCompiler(service.path, 'src/Client.tsx', 'a'.repeat(64))).toEqual({
        code: 'export const value=1;',
        map: null,
      });
      expect(await requestCompiler(service.path, '../private.ts', 'a'.repeat(64))).toBeNull();
      expect(calls).toEqual(['src/Client.tsx']);
      const reply = await new Promise<string>((done, reject) => {
        const socket = createConnection(service.path);
        let text = '';
        socket.once('error', reject);
        socket.once('connect', () =>
          socket.write(
            JSON.stringify({
              file: 'src/App.tsx',
              revision: 'a'.repeat(64),
              command: 'PRIVATE_COMMAND',
            }) + '\n',
          ),
        );
        socket.on('data', (value) => {
          text += String(value);
        });
        socket.once('end', () => done(text));
      });
      expect(reply).toContain('INVALID_COMPILER_REQUEST');
      expect(reply).not.toContain('PRIVATE_COMMAND');
    } finally {
      await service.close();
    }
    await expect(stat(service.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
