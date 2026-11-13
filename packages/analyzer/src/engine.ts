import type { AnalysisDiagnostic, Finding, StaticAnalysisResult } from '@devanalyst/core';
import { DevAnalystError, findingSchema } from '@devanalyst/core';
import type { AnalysisRequest, StaticAnalyzer } from './index.js';
import {
  analyzerOptionsSchema,
  analysisSourcesSchema,
  AnalysisBudget,
  AnalysisStop,
  type StaticAnalyzerOptions,
} from './analysis-options.js';
import { loadProject } from './project.js';
import { SemanticModel } from './semantic.js';
import { extractCalls, extractStructure, traceRoots } from './extract.js';
export interface StaticCodeAnalyzer extends StaticAnalyzer {
  analyzeDetailed(request: AnalysisRequest): Promise<StaticAnalysisResult>;
}
/** Read authorized snapshots, bind symbols in a closed in-memory program, and never execute application code. */
export function createStaticAnalyzer(input: StaticAnalyzerOptions): StaticCodeAnalyzer {
  const parsed = analyzerOptionsSchema.safeParse(input);
  if (!parsed.success)
    throw new DevAnalystError(
      'INVALID_CONFIG',
      'Check static analysis paths, aliases and bounded limits.',
    );
  const options = parsed.data;
  async function analyzeDetailed(request: AnalysisRequest): Promise<StaticAnalysisResult> {
    if (typeof request !== 'object' || request === null)
      throw new DevAnalystError('INVALID_MESSAGE', 'Provide a static analysis request object.');
    const parsedSources = analysisSourcesSchema.safeParse(request.sources);
    if (
      !parsedSources.success ||
      typeof request.requestId !== 'string' ||
      !request.requestId ||
      request.requestId.length > 128
    )
      throw new DevAnalystError(
        'INVALID_MESSAGE',
        'Provide bounded workspace-relative source references and a request identifier.',
      );
    const budget = new AnalysisBudget(options.limits, request.signal),
      diagnostics: AnalysisDiagnostic[] = [];
    const diagnostic = (value: AnalysisDiagnostic) => {
      if (diagnostics.length < 100) diagnostics.push(value);
    };
    let canonicalPaths: ReadonlyMap<string, string> = new Map();
    let model: SemanticModel | undefined,
      hashes: Readonly<Record<string, string>> = {},
      completion: StaticAnalysisResult['completion'] = 'complete';
    try {
      budget.check();
      const project = await loadProject(options, parsedSources.data, budget, diagnostic);
      hashes = project.hashes;
      canonicalPaths = project.canonicalPaths;
      model = new SemanticModel(project, budget, diagnostics);
      model.index();
      const handlers = extractStructure(model),
        effects = extractCalls(model);
      traceRoots(model, [...handlers, ...effects]);
      for (const node of [...model.nodes.values()]) {
        if (node.kind === 'module' || !node.source) continue;
        const file = project.files.get(node.source.file);
        if (file)
          model.edge(model.graphNode('module', file, node.source.file), node.id, 'contains', file);
      }
      budget.check();
    } catch (error: unknown) {
      if (error instanceof AnalysisStop) {
        completion = error.code === 'CANCELLED' ? 'cancelled' : 'partial';
        diagnostic({
          code: error.code,
          message:
            'Static analysis stopped at an explicit cancellation or resource limit; omitted results are unknown.',
          source: null,
        });
      } else if (error instanceof DevAnalystError) {
        completion = 'partial';
        diagnostic({
          code: error.code,
          message: 'Workspace source access failed; no application code was executed.',
          source: null,
        });
      } else {
        throw new DevAnalystError(
          'INTERNAL_ERROR',
          'Static analysis failed without executing application code.',
          { cause: error },
        );
      }
    }
    if (diagnostics.length && completion === 'complete') completion = 'partial';
    const nodes = [...(model?.nodes.values() ?? [])];
    const selected = [
      ...new Set(
        parsedSources.data.flatMap((source) => {
          const file = canonicalPaths.get(source.file) ?? source.file;
          const candidates = nodes.filter((node) => {
            if (!node.source || node.source.file !== file) return false;
            if (!source.start) return node.kind === 'module';
            const start = node.source.start,
              end = node.source.end;
            return (
              !!start &&
              !!end &&
              (start.line < source.start.line ||
                (start.line === source.start.line && start.column <= source.start.column)) &&
              (end.line > source.start.line ||
                (end.line === source.start.line && end.column > source.start.column))
            );
          });
          candidates.sort((a, b) => {
            const x = a.source,
              y = b.source;
            const size = (value: typeof x) =>
              value?.start && value.end
                ? (value.end.line - value.start.line) * 1000000 +
                  value.end.column -
                  value.start.column
                : Number.MAX_SAFE_INTEGER;
            return size(x) - size(y);
          });
          return candidates[0] ? [candidates[0].id] : [];
        }),
      ),
    ];
    return {
      requestId: request.requestId,
      completion,
      findings: [...(model?.findings.values() ?? [])],
      graph: { nodes, edges: [...(model?.edges.values() ?? [])] },
      diagnostics,
      selectedSubjects: selected,
      sourceHashes: hashes,
      metrics: {
        files: budget.files,
        bytes: budget.bytes,
        astNodes: budget.astNodes,
        resolutionAttempts: budget.resolutionAttempts,
        durationMs: performance.now() - budget.started,
      },
    };
  }
  return {
    analyzeDetailed,
    async analyze(request): Promise<readonly Finding[]> {
      const result = await analyzeDetailed(request);
      return result.findings.map((finding) =>
        findingSchema.parse({
          id: finding.id,
          type: finding.type,
          confidence: finding.confidence,
          explanation: finding.explanation,
          evidence: finding.evidence,
          analyzedAt: finding.analyzedAt,
          cacheStatus: finding.cacheStatus,
        }),
      );
    },
  };
}
