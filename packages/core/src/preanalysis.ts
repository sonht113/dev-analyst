import { z } from 'zod';
import { workspacePathSchema } from './config.js';

export const analysisStateSchema = z.enum([
  'NOT_ANALYZED',
  'QUEUED',
  'ANALYZING',
  'READY',
  'STALE',
  'FAILED',
]);
export type AnalysisState = z.infer<typeof analysisStateSchema>;
export const pageElementSchema = z.strictObject({
  elementId: z.string().regex(/^[a-f0-9]{64}$/),
  file: workspacePathSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  tag: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  kind: z.enum(['button', 'link', 'form', 'menu', 'tab', 'component']),
});
/** Structural metadata only: no text, props, values, URLs or route parameter values. */
export type PageElement = z.infer<typeof pageElementSchema>;
export const pageItemStatusSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  elementId: z.string().regex(/^[a-f0-9]{64}$/),
  state: analysisStateSchema,
  aiState: analysisStateSchema,
  cache: z.enum(['miss', 'fresh', 'stale']),
  error: z
    .string()
    .regex(/^[A-Z_]{1,64}$/)
    .nullable(),
});
export type PageItemStatus = z.infer<typeof pageItemStatusSchema>;
export const pageProgressSchema = z
  .strictObject({
    requestId: z.uuid(),
    items: z.array(pageItemStatusSchema).max(16),
    total: z.number().int().min(0).max(128),
    completed: z.number().int().min(0).max(128),
    limited: z.boolean(),
  })
  .refine((value) => value.completed <= value.total);
export type PageProgress = z.infer<typeof pageProgressSchema>;
