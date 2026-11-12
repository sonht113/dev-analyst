import type { Finding } from '@devanalyst/core';

export type CacheLookup =
  | { readonly status: 'miss' }
  | { readonly status: 'fresh' | 'stale'; readonly findings: readonly Finding[] };

/** Storage contract only; SQLite persistence and invalidation are not implemented. */
export interface AnalysisCache {
  get(key: string): Promise<CacheLookup>;
  set(key: string, findings: readonly Finding[]): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}
