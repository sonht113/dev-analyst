import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createClaudeCodeProvider } from '@devanalyst/ai';
import { createWorkerAnalyzer, createWorkspaceAccess } from '@devanalyst/analyzer';
import { openPersistentCache } from '@devanalyst/cache';
import { DevAnalystError } from '@devanalyst/core';
import { loadConfiguration, analysisLimits } from './configuration.js';

export async function inspectClaude(root: string, mode: string) {
  const config = await loadConfiguration(root, mode);
  return createClaudeCodeProvider({
    workspaceRoot: resolve(root, config.workspaceRoot),
    source: config.source,
    ai: config.ai,
  }).checkReadiness();
}
/** Offline administration uses the same worker/path guards as Vite; no database deletion. */
export async function manageCache(root: string, mode: string, clear: boolean) {
  const config = await loadConfiguration(root, mode);
  if (!config.cache.enabled) return { enabled: false, cleared: 0 };
  const cache = await openPersistentCache({
    workspaceRoot: resolve(root, config.workspaceRoot),
    source: config.source,
    directory: config.cache.directory,
    maxBytes: config.cache.maxSizeMb * 1024 * 1024,
  });
  try {
    return {
      enabled: true,
      cleared: clear ? await cache.clear() : 0,
      inspection: await cache.inspect(),
    };
  } finally {
    await cache.close();
  }
}
/** Explicit, deterministic analysis of one allowed source; never starts Claude. */
export async function analyzeSource(root: string, mode: string, file: string) {
  const config = await loadConfiguration(root, mode);
  if (process.env['NODE_ENV'] === 'production')
    throw new DevAnalystError('DEVELOPMENT_ONLY', 'Run source analysis in development mode.');
  await (
    await createWorkspaceAccess(resolve(root, config.workspaceRoot), config.source)
  ).readSource(file);
  return createWorkerAnalyzer({
    workspaceRoot: resolve(root, config.workspaceRoot),
    source: config.source,
    limits: analysisLimits(config),
  }).analyzeDetailed({ requestId: randomUUID(), sources: [{ file, start: null, end: null }] });
}
