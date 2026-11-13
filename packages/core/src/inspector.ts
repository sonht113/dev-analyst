import { z } from 'zod';
import { evidenceSchema, sourceReferenceSchema } from './findings.js';
import { analysisStateSchema } from './preanalysis.js';
export const inspectorItemSchema = z
  .strictObject({
    id: z.uuid(),
    group: z.enum([
      'translation',
      'purpose',
      'visibility',
      'disabled',
      'handler',
      'call',
      'api',
      'navigation',
      'state',
      'effect',
      'limitation',
    ]),
    title: z.string().max(160),
    description: z.string().max(2000),
    confidence: z.enum(['VERIFIED', 'INFERRED', 'UNKNOWN']),
    evidence: evidenceSchema.nullable(),
    trace: z.array(sourceReferenceSchema).max(8),
    analyzedAt: z.iso.datetime(),
    cacheStatus: z.enum(['miss', 'fresh', 'stale']),
  })
  .superRefine((item, context) => {
    if (item.confidence !== 'UNKNOWN' && (!item.evidence || item.cacheStatus === 'stale'))
      context.addIssue({
        code: 'custom',
        message: 'Current source evidence is required for confident inspector facts.',
      });
  });
export type InspectorItem = z.infer<typeof inspectorItemSchema>;
export const inspectorUpdateSchema = z.strictObject({
  requestId: z.uuid(),
  elementId: z.string().regex(/^[a-f0-9]{64}$/),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  lane: z.enum(['translation', 'analysis', 'ai']),
  state: analysisStateSchema,
  cache: z.enum(['miss', 'fresh', 'stale']),
  completion: z.enum(['complete', 'partial']),
  error: z
    .string()
    .regex(/^[A-Z_]{1,64}$/)
    .nullable(),
  reset: z.boolean(),
  limited: z.boolean(),
  items: z.array(inspectorItemSchema).max(4),
  observedAt: z.iso.datetime(),
});
export type InspectorUpdate = z.infer<typeof inspectorUpdateSchema>;
