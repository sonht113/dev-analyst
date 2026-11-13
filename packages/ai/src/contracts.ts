import { z } from 'zod';
import type { DevAnalystConfig, Finding, SerializedError } from '@devanalyst/core';

export interface ExplanationRequest {
  readonly requestId: string;
  /** Deterministic AST findings, not model-authored source claims. */
  readonly evidence: readonly Finding[];
  readonly sourceHashes?: Readonly<Record<string, string>>;
  readonly depth: DevAnalystConfig['ai']['depth'];
  /** Explicitly selected public UI text; never pass form values or private DOM contents. */
  readonly uiText?: readonly { readonly id: string; readonly text: string }[];
  readonly question?: string;
  readonly signal?: AbortSignal;
}
export interface AIProvider {
  readonly id: string;
  explain(request: ExplanationRequest): Promise<readonly Finding[]>;
}
export interface ClaudeReadiness {
  readonly available: boolean;
  readonly version: string | null;
  readonly compatible: boolean;
  readonly authenticated: boolean | null;
  readonly nonInteractive: 'unverified' | 'ready' | 'unavailable';
  readonly error: SerializedError | null;
}
export interface ExplanationResult {
  readonly requestId: string;
  readonly provider: 'claude-code';
  readonly language: 'vi';
  readonly findings: readonly Finding[];
  readonly citations: readonly {
    readonly findingId: string;
    readonly evidenceIds: readonly string[];
    readonly uiTextId: string | null;
  }[];
  readonly usage: {
    readonly attempts: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly suppliedTokenUpperBound: number;
    readonly durationMs: number;
  };
}
export interface ClaudeCodeProvider extends AIProvider {
  /** Version/capabilities/auth status by default; probe sends only a synthetic greeting. */
  checkReadiness(options?: {
    readonly probe?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<ClaudeReadiness>;
  explainDetailed(request: ExplanationRequest): Promise<ExplanationResult>;
}

export const modelResponseSchema = z.strictObject({
  language: z.literal('vi'),
  explanations: z
    .array(
      z.strictObject({
        kind: z.enum(['behavior', 'business-logic', 'translation', 'limitation']),
        text: z.string().trim().min(1).max(3000),
        confidence: z.enum(['VERIFIED', 'INFERRED', 'UNKNOWN']),
        evidenceIds: z.array(z.uuid()).max(8),
        uiTextId: z.string().min(1).max(64).nullable(),
      }),
    )
    .min(1)
    .max(20),
});
export type ModelResponse = z.infer<typeof modelResponseSchema>;
