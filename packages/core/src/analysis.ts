import type { Evidence, Finding, SourceReference } from './findings.js';

export type AnalysisConfidence = Finding['confidence'];
export interface StaticCondition {
  readonly expression: string;
  readonly branch: 'truthy' | 'falsy' | 'nullish' | 'non-nullish' | 'iteration' | 'unknown';
  readonly evidence: Evidence;
}
export type StaticAnalysisDetail =
  | {
      readonly kind: 'component';
      readonly name: string;
      readonly exports: readonly { readonly file: string; readonly name: string }[];
      readonly props: readonly string[];
    }
  | {
      readonly kind: 'prop';
      readonly name: string;
      readonly expression: string;
      readonly spread: boolean;
    }
  | {
      readonly kind: 'relationship';
      readonly parent: string | null;
      readonly child: string | null;
      readonly tag: string;
    }
  | {
      readonly kind: 'condition';
      readonly expression: string;
      readonly branch: StaticCondition['branch'];
    }
  | {
      readonly kind: 'visibility' | 'disabled';
      readonly attribute: string;
      readonly expression: string;
    }
  | {
      readonly kind: 'handler';
      readonly event: string;
      readonly expression: string;
      readonly targetId: string | null;
    }
  | {
      readonly kind: 'call';
      readonly expression: string;
      readonly targetId: string | null;
      readonly resolution: 'symbol' | 'candidate' | 'unresolved';
    }
  | {
      readonly kind: 'hook';
      readonly name: string;
      readonly dependencies: readonly string[] | null;
    }
  | {
      readonly kind: 'state';
      readonly operation: 'declaration' | 'update';
      readonly names: readonly string[];
      readonly expression: string;
    }
  | {
      readonly kind: 'navigation';
      readonly mechanism: string;
      readonly destination: string | null;
      readonly expression: string;
    }
  | {
      readonly kind: 'api';
      readonly client: 'fetch' | 'axios';
      readonly method: string | null;
      readonly endpoint: string | null;
      readonly expression: string;
      readonly baseURL: string | null;
    }
  | { readonly kind: 'side-effect'; readonly operation: string; readonly expression: string };
export interface StaticAnalysisFinding extends Finding {
  readonly subjectId: string;
  readonly detail: StaticAnalysisDetail;
  readonly conditions: readonly StaticCondition[];
  readonly execution: 'not-evaluated';
  readonly traces: readonly {
    readonly confidence: AnalysisConfidence;
    readonly path: readonly SourceReference[];
  }[];
}
export interface AnalysisGraphNode {
  readonly id: string;
  readonly kind: 'module' | 'component' | 'function' | 'element' | 'call' | 'external';
  readonly name: string;
  readonly source: SourceReference | null;
}
export interface AnalysisGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'imports' | 'renders' | 'handler' | 'calls' | 'callback' | 'contains';
  readonly confidence: AnalysisConfidence;
  readonly evidence: Evidence;
}
export interface AnalysisDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly source: SourceReference | null;
}
export interface StaticAnalysisResult {
  readonly requestId: string;
  readonly completion: 'complete' | 'partial' | 'cancelled';
  readonly findings: readonly StaticAnalysisFinding[];
  readonly graph: {
    readonly nodes: readonly AnalysisGraphNode[];
    readonly edges: readonly AnalysisGraphEdge[];
  };
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly selectedSubjects: readonly string[];
  readonly sourceHashes: Readonly<Record<string, string>>;
  /** All authorized snapshots affecting analysis, including JSON config and malformed dependencies. */
  readonly dependencyHashes?: Readonly<Record<string, string>>;
  /** Authorized unresolved candidates whose later appearance changes module resolution. */
  readonly missingDependencies?: readonly string[];
  readonly sourceAliases?: Readonly<Record<string, string>>;
  readonly metrics: {
    readonly files: number;
    readonly bytes: number;
    readonly astNodes: number;
    readonly resolutionAttempts: number;
    readonly durationMs: number;
  };
}
