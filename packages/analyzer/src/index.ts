import type { Finding, SourceReference } from '@devanalyst/core';

/** Requested source snapshots for bounded deterministic analysis; source coordinates can identify an inspected JSX element. */
export interface AnalysisRequest {
  readonly requestId: string;
  readonly sources: readonly SourceReference[];
  readonly signal?: AbortSignal;
}

export interface StaticAnalyzer {
  analyze(request: AnalysisRequest): Promise<readonly Finding[]>;
}
export { instrumentReactSource } from './instrumentation.js';
export type { InstrumentationResult, MappingDiagnostic } from './instrumentation.js';
export { createWorkspaceAccess } from './workspace.js';
export type { WorkspaceAccess } from './workspace.js';
export { createStaticAnalyzer } from './engine.js';
export type { StaticCodeAnalyzer } from './engine.js';
export type { StaticAnalyzerOptions, AnalysisLimits } from './analysis-options.js';
export type {
  StaticAnalysisResult,
  StaticAnalysisFinding,
  StaticAnalysisDetail,
} from '@devanalyst/core';
