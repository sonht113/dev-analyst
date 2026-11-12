import type { Finding, SourceReference } from '@devanalyst/core';

/** Inputs for deterministic source analysis. No analyzer implementation exists yet. */
export interface AnalysisRequest {
  readonly requestId: string;
  readonly sources: readonly SourceReference[];
  readonly signal?: AbortSignal;
}

export interface StaticAnalyzer {
  analyze(request: AnalysisRequest): Promise<readonly Finding[]>;
}
