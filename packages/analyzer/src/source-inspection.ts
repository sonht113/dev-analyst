import type { Evidence } from '@sonht113/core';
export interface SourceInspectionOrigin {
  readonly siteId: string;
  readonly private: boolean;
  readonly literal: { readonly text: string; readonly evidence: Evidence } | null;
}
