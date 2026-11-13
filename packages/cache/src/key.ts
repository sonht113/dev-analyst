import { createHash } from 'node:crypto';
import { DevAnalystError } from '@devanalyst/core';
import { cacheIdentitySchema, type CacheIdentityInput } from './contracts.js';
export function cacheFingerprint(value: unknown): string {
  function stable(input: unknown, depth: number): unknown {
    if (depth > 32)
      throw new DevAnalystError('INVALID_MESSAGE', 'Cache fingerprint nesting exceeds its limit.');
    if (Array.isArray(input)) return input.map((item) => stable(item, depth + 1));
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, stable(item, depth + 1)]),
      );
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean' ||
      (typeof input === 'number' && Number.isFinite(input))
    )
      return input;
    throw new DevAnalystError('INVALID_MESSAGE', 'Use finite JSON values for cache fingerprints.');
  }
  const encoded = JSON.stringify(stable(value, 0));
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024)
    throw new DevAnalystError('INVALID_MESSAGE', 'Cache fingerprint input exceeds its limit.');
  return createHash('sha256').update(encoded).digest('hex');
}
export function createCacheKey(
  project: string,
  input: CacheIdentityInput,
  hashes: Readonly<Record<string, string>>,
  missing: readonly string[] = [],
  aliases: Readonly<Record<string, string>> = {},
): { key: string; base: string; fingerprint: string } {
  const identity = cacheIdentitySchema.parse(input);
  const { revision, ...stable } = identity;
  const fingerprint = cacheFingerprint({ hashes, missing: [...new Set(missing)].sort(), aliases });
  return {
    base: cacheFingerprint({ project, identity: stable }),
    key: cacheFingerprint({ project, identity: { ...stable, revision }, fingerprint }),
    fingerprint,
  };
}
