import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { DevAnalystError } from '@devanalyst/core';
import { commandSchema } from './contracts.js';
import { openDatabase } from './database.js';
const requestSchema = z.strictObject({ id: z.number().int().positive(), command: z.unknown() });
let database: Awaited<ReturnType<typeof openDatabase>> | undefined;
let chain = Promise.resolve();
parentPort?.on('message', (input: unknown) => {
  chain = chain
    .then(async () => {
      const request = requestSchema.parse(input);
      try {
        if (!database) {
          database = await openDatabase(request.command);
          parentPort?.postMessage({
            id: request.id,
            ok: true,
            value: { project: database.project, inspection: database.inspect() },
          });
          return;
        }
        const value = await database.execute(commandSchema.parse(request.command));
        parentPort?.postMessage({ id: request.id, ok: true, value });
      } catch (error: unknown) {
        const code =
          error instanceof DevAnalystError
            ? error.code
            : error instanceof z.ZodError
              ? 'INVALID_MESSAGE'
              : typeof error === 'object' &&
                  error !== null &&
                  'errcode' in error &&
                  (error.errcode === 5 || error.errcode === 6)
                ? 'CACHE_BUSY'
                : 'CACHE_UNAVAILABLE';
        parentPort?.postMessage({ id: request.id, ok: false, code });
      }
    })
    .catch(() => {
      parentPort?.postMessage({ id: 0, ok: false, code: 'CACHE_UNAVAILABLE' });
    });
});
