import { z } from 'zod';
import { configSchema, sourceReferenceSchema } from '@devanalyst/core';
export const analysisLimitsSchema = z.strictObject({
  maxFiles: z.number().int().min(1).max(128).default(64),
  maxBytes: z
    .number()
    .int()
    .min(128)
    .max(4 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  maxAstNodes: z.number().int().min(1).max(200000).default(100000),
  maxGraphNodes: z.number().int().min(2).max(4096).default(2048),
  maxGraphEdges: z.number().int().min(1).max(8192).default(4096),
  maxFindings: z.number().int().min(1).max(2000).default(1000),
  maxDepth: z.number().int().min(1).max(32).default(12),
  maxResolutionAttempts: z.number().int().min(1).max(4096).default(1024),
  timeoutMs: z.number().int().min(1).max(10000).default(2500),
});
export const analyzerOptionsSchema = z.strictObject({
  workspaceRoot: z.string().min(1).max(4096),
  source: configSchema.shape.source,
  aliases: z
    .record(z.string().min(1).max(256), z.string().min(1).max(1024))
    .refine((value) => Object.keys(value).length <= 64)
    .default({}),
  tsconfig: z.string().min(1).max(1024).optional(),
  compilerOptions: z
    .strictObject({
      baseUrl: z.string().max(1024).optional(),
      paths: z
        .record(z.string().max(256), z.array(z.string().max(1024)).max(8))
        .refine((value) => Object.keys(value).length <= 64)
        .default({}),
    })
    .prefault({}),
  limits: analysisLimitsSchema.prefault({}),
});
export type StaticAnalyzerOptions = z.input<typeof analyzerOptionsSchema>;
export type AnalysisLimits = z.output<typeof analysisLimitsSchema>;
export type ResolvedAnalyzerOptions = z.output<typeof analyzerOptionsSchema>;
export const analysisSourcesSchema = z.array(sourceReferenceSchema).min(1).max(64);
export class AnalysisStop extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export class AnalysisBudget {
  readonly started = performance.now();
  readonly timestamp = new Date().toISOString();
  astNodes = 0;
  bytes = 0;
  files = 0;
  resolutionAttempts = 0;
  constructor(
    readonly limits: AnalysisLimits,
    readonly signal?: AbortSignal,
  ) {}
  check(): void {
    if (this.signal?.aborted) throw new AnalysisStop('CANCELLED');
    if (performance.now() - this.started > this.limits.timeoutMs)
      throw new AnalysisStop('TIME_LIMIT');
  }
  node(): void {
    this.check();
    if (++this.astNodes > this.limits.maxAstNodes) throw new AnalysisStop('AST_LIMIT');
  }
}
