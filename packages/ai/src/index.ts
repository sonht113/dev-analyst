import type { DevAnalystConfig, Finding } from '@devanalyst/core';

/** Evidence-only provider input. Runtime access controls remain a future implementation. */
export interface ExplanationRequest {
  readonly requestId: string;
  readonly evidence: readonly Finding[];
  readonly depth: DevAnalystConfig['ai']['depth'];
  readonly signal?: AbortSignal;
}

/** Contract only: importing this package does not start Claude or read files. */
export interface AIProvider {
  readonly id: string;
  explain(request: ExplanationRequest): Promise<readonly Finding[]>;
}
