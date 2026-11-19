import type { Evidence } from '@devanalyst/core';
export interface SourceInspectionOrigin {
  readonly siteId: string;
  readonly private: boolean;
  readonly literal: { readonly text: string; readonly evidence: Evidence } | null;
}
