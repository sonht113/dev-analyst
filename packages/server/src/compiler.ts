import { createServer, createConnection, type Socket } from 'node:net';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevAnalystError, workspacePathSchema } from '@sonht113/core';
export interface CompilerResult {
  readonly code: string;
  readonly map: object | null;
}
/** Owner-only Unix socket for compiler workers. Separate from the browser bridge; no TCP/file RPC. */
export async function startCompilerService(
  transform: (file: string, revision: string) => Promise<CompilerResult>,
) {
  if (process.platform === 'win32')
    throw new DevAnalystError(
      'UNSUPPORTED_FEATURE',
      'Next compiler IPC currently supports native macOS/Linux only.',
    );
  const directory = await mkdtemp(join(tmpdir(), 'devanalyst-compiler-'));
  await chmod(directory, 0o700);
  const path = join(directory, 'compiler.sock');
  let pending = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
    let buffer = '',
      started = false;
    socket.on('data', (chunk) => {
      if (started) {
        socket.destroy();
        return;
      }
      buffer += chunk.toString();
      if (buffer.length > 4096) {
        socket.destroy();
        return;
      }
      if (!buffer.endsWith('\n')) return;
      started = true;
      if (pending >= 8) {
        socket.end('{"error":"COMPILER_BUSY"}\n');
        return;
      }
      let file: string, revision: string;
      try {
        const value: unknown = JSON.parse(buffer);
        if (
          typeof value !== 'object' ||
          value === null ||
          !('file' in value) ||
          !('revision' in value) ||
          Object.keys(value).length !== 2 ||
          typeof value.revision !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.revision)
        )
          throw new Error('Invalid');
        file = workspacePathSchema.parse(value.file);
        revision = value.revision;
      } catch {
        socket.end('{"error":"INVALID_COMPILER_REQUEST"}\n');
        return;
      }
      pending++;
      void transform(file, revision)
        .then(
          (result) => {
            const data = JSON.stringify(result);
            if (Buffer.byteLength(data) > 4 * 1024 * 1024)
              socket.end('{"error":"COMPILER_LIMIT"}\n');
            else socket.end(data + '\n');
          },
          () => socket.end('{"error":"SOURCE_MAPPING_UNAVAILABLE"}\n'),
        )
        .finally(() => {
          pending--;
        });
    });
    socket.on('error', () => socket.destroy());
  });
  server.maxConnections = 16;
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(path, () => {
        server.off('error', reject);
        done();
      });
    });
    await chmod(path, 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    path,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export function requestCompiler(
  path: string,
  file: string,
  revision: string,
): Promise<CompilerResult | null> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    let data = '',
      settled = false;
    const finish = (value: CompilerResult | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(5000, () => finish(null));
    socket.once('error', () => finish(null));
    socket.once('connect', () => socket.write(JSON.stringify({ file, revision }) + '\n'));
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 4 * 1024 * 1024) {
        finish(null);
        return;
      }
      if (!data.endsWith('\n')) return;
      try {
        const value: unknown = JSON.parse(data);
        if (
          typeof value !== 'object' ||
          value === null ||
          !('code' in value) ||
          typeof value.code !== 'string' ||
          !('map' in value) ||
          (value.map !== null && typeof value.map !== 'object')
        )
          throw new Error('Invalid');
        finish({ code: value.code, map: value.map });
      } catch {
        finish(null);
      }
    });
    socket.once('end', () => {
      if (!settled) finish(null);
    });
  });
}
