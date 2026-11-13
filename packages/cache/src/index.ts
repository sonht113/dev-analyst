import type { Finding } from '@devanalyst/core';

export type CacheLookup =
  | { readonly status: 'miss' }
  | { readonly status: 'fresh' | 'stale'; readonly findings: readonly Finding[] };

/** Legacy finding-only contract. Use openPersistentCache for validated persistent records. */
export interface AnalysisCache {
  get(key: string): Promise<CacheLookup>;
  set(key: string, findings: readonly Finding[]): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}
export { openPersistentCache } from './persistent.js';
export type { PersistentAnalysisCache } from './persistent.js';
export { cacheFingerprint, createCacheKey } from './key.js';
export type {
  CacheIdentity,
  CacheIdentityInput,
  CacheWrite,
  PersistentLookup,
  PersistentCacheOptions,
  CacheInspection,
} from './contracts.js';
export type { CachePayload } from './payload.js';

export { safePersistence as isSafeCacheContent } from './privacy.js';
