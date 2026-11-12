import { z } from 'zod';
import { workspacePathSchema } from './config.js';

/** Source coordinates are one-based. Unavailable positions must be null. */
export const sourcePositionSchema = z.strictObject({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const sourceReferenceSchema = z
  .strictObject({
    file: workspacePathSchema,
    start: sourcePositionSchema.nullable(),
    end: sourcePositionSchema.nullable(),
  })
  .superRefine((source, context) => {
    if (source.end !== null && source.start === null) {
      context.addIssue({ code: 'custom', message: 'An end position requires a start position' });
    }
    if (
      source.start !== null &&
      source.end !== null &&
      (source.end.line < source.start.line ||
        (source.end.line === source.start.line && source.end.column < source.start.column))
    ) {
      context.addIssue({ code: 'custom', message: 'Source range ends before it starts' });
    }
  });

export const evidenceSchema = z.strictObject({
  source: sourceReferenceSchema,
  code: z.string().trim().min(1).max(16_384),
});

export const findingSchema = z
  .strictObject({
    id: z.uuid(),
    type: z.enum([
      'component',
      'event-handler',
      'render-condition',
      'state-change',
      'api-call',
      'navigation',
      'translation',
      'explanation',
    ]),
    explanation: z.string().trim().min(1).max(16_384),
    confidence: z.enum(['VERIFIED', 'INFERRED', 'UNKNOWN']),
    evidence: evidenceSchema.nullable(),
    analyzedAt: z.iso.datetime({ offset: true }),
    cacheStatus: z.enum(['miss', 'fresh', 'stale']),
  })
  .superRefine((finding, context) => {
    if (finding.confidence !== 'UNKNOWN' && finding.evidence === null) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Findings without source evidence must be UNKNOWN',
      });
    }
    if (finding.confidence === 'VERIFIED' && finding.cacheStatus === 'stale') {
      context.addIssue({
        code: 'custom',
        path: ['confidence'],
        message: 'Stale findings cannot claim verified current behavior',
      });
    }
  });

export type SourcePosition = z.infer<typeof sourcePositionSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Finding = z.infer<typeof findingSchema>;
