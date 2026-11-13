import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { DevAnalystError, errorCodeSchema } from '@devanalyst/core';
import {
  cacheOptionsSchema,
  cacheIdentitySchema,
  commandSchema,
  digestSchema,
  lookupSchema,
  inspectionSchema,
  recordSchema,
  type PersistentCacheOptions,
  type CacheIdentityInput,
  type CacheWrite,
  type CacheInspection,
} from './contracts.js';
const responseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ id: z.number().int(), ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ id: z.number().int(), ok: z.literal(false), code: errorCodeSchema }),
]);
export async function openPersistentCache(input: PersistentCacheOptions) {
  const options = cacheOptionsSchema.parse(input);
  if (process.env['NODE_ENV'] === 'production')
    throw new DevAnalystError('DEVELOPMENT_ONLY', 'Persistent analysis cache is development-only.');
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  let id = 0,
    closed = false,
    closing: Promise<void> | undefined;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function fail(code: 'CACHE_UNAVAILABLE' | 'CACHE_TIMEOUT'): void {
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        new DevAnalystError(code, 'Cache worker unavailable; continue without persistent reuse.'),
      );
    }
    pending.clear();
    void worker.terminate();
  }
  worker.on('error', () => fail('CACHE_UNAVAILABLE'));
  worker.on('exit', () => {
    if (!closed) fail('CACHE_UNAVAILABLE');
  });
  worker.on('message', (input: unknown) => {
    const parsed = responseSchema.safeParse(input);
    if (!parsed.success) {
      fail('CACHE_UNAVAILABLE');
      return;
    }
    if (parsed.data.id === 0) {
      fail('CACHE_UNAVAILABLE');
      return;
    }
    const response = parsed.data,
      request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.ok) request.resolve(response.value);
    else
      request.reject(
        new DevAnalystError(
          response.code,
          'Cache operation failed; inspect cache diagnostics or continue with fresh analysis.',
        ),
      );
  });
  function call(command: unknown, control = false): Promise<unknown> {
    if (closed || (closing && !control))
      return Promise.reject(new DevAnalystError('CACHE_CLOSED', 'The persistent cache is closed.'));
    if (!control && pending.size >= options.maxPending)
      return Promise.reject(
        new DevAnalystError(
          'CACHE_QUEUE_FULL',
          'Cache queue is full; continue without persistent reuse.',
        ),
      );
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail('CACHE_TIMEOUT'), options.timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ id: requestId, command });
    });
  }
  let opened: { project: string; inspection: CacheInspection };
  try {
    opened = z
      .strictObject({ project: digestSchema, inspection: inspectionSchema })
      .parse(await call(options));
  } catch (error: unknown) {
    closed = true;
    await worker.terminate();
    throw error;
  }
  return {
    project: opened.project,
    initialInspection: opened.inspection,
    async get(identity: CacheIdentityInput, options: { allowStale?: boolean } = {}) {
      return lookupSchema.parse(
        await call(
          commandSchema.parse({
            type: 'get',
            identity: cacheIdentitySchema.parse(identity),
            allowStale: options.allowStale ?? false,
          }),
        ),
      );
    },
    async put(record: CacheWrite) {
      return z
        .strictObject({ stored: z.boolean(), key: digestSchema })
        .parse(await call({ type: 'put', record: recordSchema.parse(record) }));
    },
    async invalidateSource(
      file: string,
      revision: string | null = null,
      topology = false,
    ): Promise<number> {
      return z
        .number()
        .int()
        .parse(await call(commandSchema.parse({ type: 'invalidate', file, revision, topology })));
    },
    async inspect() {
      return inspectionSchema.parse(await call({ type: 'inspect' }));
    },
    async clear(
      filter: { scope?: 'page' | 'component' | 'element'; kind?: 'analysis' | 'translation' } = {},
    ): Promise<number> {
      return z
        .number()
        .int()
        .parse(
          await call(
            commandSchema.parse({
              type: 'clear',
              scope: filter.scope ?? null,
              kind: filter.kind ?? null,
            }),
          ),
        );
    },
    async delete(key: string): Promise<number> {
      return z
        .number()
        .int()
        .parse(await call(commandSchema.parse({ type: 'delete', key })));
    },
    close(): Promise<void> {
      closing ??= (async () => {
        if (!closed) {
          try {
            await call({ type: 'close' }, true);
          } finally {
            closed = true;
            await worker.terminate();
          }
        } else await worker.terminate();
      })();
      return closing;
    },
  };
}
export type PersistentAnalysisCache = Awaited<ReturnType<typeof openPersistentCache>>;
