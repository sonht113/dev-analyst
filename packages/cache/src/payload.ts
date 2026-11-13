import { z } from 'zod';
import {
  findingSchema,
  evidenceSchema,
  sourceReferenceSchema,
  pageElementSchema,
  type StaticAnalysisResult,
} from '@devanalyst/core';
const text = z.string().max(16384),
  name = z.string().max(1024);
const confidence = z.enum(['VERIFIED', 'INFERRED', 'UNKNOWN']);
const branch = z.enum(['truthy', 'falsy', 'nullish', 'non-nullish', 'iteration', 'unknown']);
const detail = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('component'),
    name,
    exports: z.array(z.strictObject({ file: name, name })).max(128),
    props: z.array(name).max(128),
  }),
  z.strictObject({ kind: z.literal('prop'), name, expression: text, spread: z.boolean() }),
  z.strictObject({
    kind: z.literal('relationship'),
    parent: name.nullable(),
    child: name.nullable(),
    tag: name,
  }),
  z.strictObject({ kind: z.literal('condition'), expression: text, branch }),
  z.strictObject({ kind: z.enum(['visibility', 'disabled']), attribute: name, expression: text }),
  z.strictObject({
    kind: z.literal('handler'),
    event: name,
    expression: text,
    targetId: name.nullable(),
  }),
  z.strictObject({
    kind: z.literal('call'),
    expression: text,
    targetId: name.nullable(),
    resolution: z.enum(['symbol', 'candidate', 'unresolved']),
  }),
  z.strictObject({
    kind: z.literal('hook'),
    name,
    dependencies: z.array(text).max(128).nullable(),
  }),
  z.strictObject({
    kind: z.literal('state'),
    operation: z.enum(['declaration', 'update']),
    names: z.array(name).max(128),
    expression: text,
  }),
  z.strictObject({
    kind: z.literal('navigation'),
    mechanism: name,
    destination: text.nullable(),
    expression: text,
  }),
  z.strictObject({
    kind: z.literal('api'),
    client: z.enum(['fetch', 'axios']),
    method: name.nullable(),
    endpoint: text.nullable(),
    expression: text,
    baseURL: text.nullable(),
  }),
  z.strictObject({ kind: z.literal('side-effect'), operation: name, expression: text }),
]);
const hashes = z
  .record(z.string().max(1024), z.string().regex(/^[a-f0-9]{64}$/))
  .refine((v) => Object.keys(v).length <= 128);
export const staticResultSchema = z
  .strictObject({
    requestId: z.string().min(1).max(128),
    completion: z.enum(['complete', 'partial', 'cancelled']),
    findings: z
      .array(
        findingSchema.safeExtend({
          subjectId: name,
          detail,
          conditions: z
            .array(z.strictObject({ expression: text, branch, evidence: evidenceSchema }))
            .max(128),
          execution: z.literal('not-evaluated'),
          traces: z
            .array(z.strictObject({ confidence, path: z.array(sourceReferenceSchema).max(128) }))
            .max(128),
        }),
      )
      .max(2000),
    graph: z.strictObject({
      nodes: z
        .array(
          z.strictObject({
            id: name,
            kind: z.enum(['module', 'component', 'function', 'element', 'call', 'external']),
            name,
            source: sourceReferenceSchema.nullable(),
          }),
        )
        .max(4096),
      edges: z
        .array(
          z.strictObject({
            from: name,
            to: name,
            kind: z.enum(['imports', 'renders', 'handler', 'calls', 'callback', 'contains']),
            confidence,
            evidence: evidenceSchema,
          }),
        )
        .max(8192),
    }),
    diagnostics: z
      .array(
        z.strictObject({ code: name, message: text, source: sourceReferenceSchema.nullable() }),
      )
      .max(100),
    selectedSubjects: z.array(name).max(64),
    sourceHashes: hashes,
    dependencyHashes: hashes.optional(),
    sourceAliases: z
      .record(z.string().max(1024), z.string().max(1024))
      .refine((v) => Object.keys(v).length <= 4096)
      .optional(),
    missingDependencies: z.array(z.string().max(1024)).max(4096).optional(),
    metrics: z.strictObject({
      files: z.number().nonnegative(),
      bytes: z.number().nonnegative(),
      astNodes: z.number().nonnegative(),
      resolutionAttempts: z.number().nonnegative(),
      durationMs: z.number().nonnegative(),
    }),
  })
  .transform(({ dependencyHashes, missingDependencies, sourceAliases, ...rest }) => ({
    ...rest,
    ...(dependencyHashes ? { dependencyHashes } : {}),
    ...(missingDependencies ? { missingDependencies } : {}),
    ...(sourceAliases ? { sourceAliases } : {}),
  })) satisfies z.ZodType<StaticAnalysisResult>;
export const payloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('static'), result: staticResultSchema }),
  z.strictObject({
    type: z.literal('explanation'),
    findings: z.array(findingSchema.refine((finding) => finding.type !== 'translation')).max(64),
  }),
  z.strictObject({
    type: z.literal('translation'),
    findings: z.array(findingSchema.refine((v) => v.type === 'translation')).max(64),
  }),
  z.strictObject({
    type: z.literal('index'),
    entries: z
      .array(pageElementSchema.safeExtend({ target: z.string().regex(/^[a-f0-9]{64}$/) }))
      .max(128),
  }),
]);
export type CachePayload =
  | Exclude<z.output<typeof payloadSchema>, { type: 'static' }>
  | { readonly type: 'static'; readonly result: StaticAnalysisResult };
/** Stale evidence is historical only. Recursively downgrade all confidence-bearing source facts. */
export function labelPayload(payload: CachePayload, stale: boolean): CachePayload {
  const copy = structuredClone(payload);
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'confidence' && stale && 'confidence' in value) value.confidence = 'UNKNOWN';
      else if (key === 'cacheStatus' && 'cacheStatus' in value)
        value.cacheStatus = stale ? 'stale' : 'fresh';
      else visit(item);
    }
  }
  visit(copy);
  return copy;
}
