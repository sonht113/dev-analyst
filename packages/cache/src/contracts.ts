import { z } from 'zod';
import { configSchema, workspacePathSchema, cacheDirectorySchema } from '@devanalyst/core';
import { payloadSchema, type CachePayload } from './payload.js';
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const cacheIdentitySchema = z
  .strictObject({
    scope: z.enum(['page', 'component', 'element']),
    kind: z.enum(['analysis', 'translation']),
    subject: digestSchema,
    revision: digestSchema,
    policy: digestSchema,
    route: digestSchema.nullable().default(null),
    runtime: digestSchema.nullable().default(null),
    provider: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
    model: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/),
    schemaVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
    language: z.enum(['vi', 'ja', 'en']).nullable().default(null),
  })
  .superRefine((identity, context) => {
    if (identity.kind === 'translation' && identity.language === null)
      context.addIssue({ code: 'custom', message: 'Translation keys require a target language.' });
    if (identity.scope === 'page' && (identity.route === null || identity.runtime === null))
      context.addIssue({
        code: 'custom',
        message: 'Page keys require route and structural runtime fingerprints.',
      });
  });
export type CacheIdentity = z.output<typeof cacheIdentitySchema>;
export type CacheIdentityInput = z.input<typeof cacheIdentitySchema>;
export const hashesSchema = z
  .record(workspacePathSchema, digestSchema)
  .refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 128);
export const aliasesSchema = z
  .record(workspacePathSchema, workspacePathSchema)
  .refine((v) => Object.keys(v).length <= 4096)
  .default({});
export const missingSchema = z.array(workspacePathSchema).max(4096).default([]);
export const cacheOptionsSchema = z.strictObject({
  workspaceRoot: z.string().min(1).max(4096),
  source: configSchema.shape.source,
  directory: cacheDirectorySchema.default('.cache/devanalyst'),
  maxBytes: z
    .number()
    .int()
    .min(65536)
    .max(4096 * 1024 * 1024)
    .default(256 * 1024 * 1024),
  maxEntries: z.number().int().min(1).max(10000).default(2000),
  ttlMs: z
    .number()
    .int()
    .min(1)
    .max(30 * 86400000)
    .default(86400000),
  staleMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 86400000)
    .default(7 * 86400000),
  maxPending: z.number().int().min(1).max(128).default(64),
  timeoutMs: z.number().int().min(1000).max(30000).default(15000),
});
export type PersistentCacheOptions = z.input<typeof cacheOptionsSchema>;
export const recordSchema = z.strictObject({
  identity: cacheIdentitySchema,
  payload: payloadSchema,
  hashes: hashesSchema,
  missing: missingSchema,
  aliases: aliasesSchema,
  /** Generation returned by get; prevents writes racing invalidation or clear in another process. */
  generation: z.number().int().nonnegative(),
});
export interface CacheWrite {
  readonly identity: CacheIdentityInput;
  readonly payload: CachePayload;
  readonly hashes: Readonly<Record<string, string>>;
  readonly missing?: readonly string[];
  readonly aliases?: Readonly<Record<string, string>>;
  readonly generation: number;
}
export const lookupSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('miss'), generation: z.number().int().nonnegative() }),
  z.strictObject({
    status: z.enum(['fresh', 'stale']),
    generation: z.number().int().nonnegative(),
    key: digestSchema,
    payload: payloadSchema,
    cachedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    fingerprint: digestSchema,
  }),
]);
export type PersistentLookup =
  | { readonly status: 'miss'; readonly generation: number }
  | {
      readonly status: 'fresh' | 'stale';
      readonly generation: number;
      readonly key: string;
      readonly payload: CachePayload;
      readonly cachedAt: string;
      readonly expiresAt: string;
      readonly fingerprint: string;
    };
export const inspectionSchema = z.strictObject({
  persistent: z.boolean(),
  schemaVersion: z.number().int(),
  generation: z.number().int(),
  entries: z.number().int(),
  bytes: z.number().int(),
  databaseBytes: z.number().int(),
  journalBytes: z.number().int(),
  diagnostic: z.enum(['CACHE_CORRUPT', 'CACHE_INCOMPATIBLE', 'CACHE_UNAVAILABLE']).nullable(),
  scopes: z.record(z.string(), z.number().int()),
  kinds: z.record(z.string(), z.number().int()),
  records: z
    .array(
      z.strictObject({
        key: digestSchema,
        scope: z.string(),
        kind: z.string(),
        provider: z.string(),
        model: z.string(),
        analysisSchema: z.string(),
        stale: z.boolean(),
        bytes: z.number().int(),
        cachedAt: z.iso.datetime(),
      }),
    )
    .max(100),
});
export type CacheInspection = z.output<typeof inspectionSchema>;
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('get'),
    identity: cacheIdentitySchema,
    allowStale: z.boolean().default(false),
  }),
  z.strictObject({ type: z.literal('put'), record: recordSchema }),
  z.strictObject({
    type: z.literal('invalidate'),
    file: workspacePathSchema,
    revision: digestSchema.nullable(),
    topology: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('clear'),
    scope: z.enum(['page', 'component', 'element']).nullable().default(null),
    kind: z.enum(['analysis', 'translation']).nullable().default(null),
  }),
  z.strictObject({ type: z.literal('delete'), key: digestSchema }),
  z.strictObject({ type: z.literal('inspect') }),
  z.strictObject({ type: z.literal('close') }),
]);
