import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createStaticAnalyzer } from '@devanalyst/analyzer';
import {
  openPersistentCache,
  cacheFingerprint,
  createCacheKey,
  type PersistentAnalysisCache,
  type CacheIdentityInput,
  type CachePayload,
} from '@devanalyst/cache';
import { payloadSchema } from './payload.js';

const roots: string[] = [],
  caches: PersistentAnalysisCache[] = [];
afterEach(async () => {
  for (const cache of caches.splice(0)) await cache.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(options: Partial<Parameters<typeof openPersistentCache>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-cache-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  const code = 'export function App(){return <button onClick={()=>fetch("/orders")}>Save</button>}';
  await writeFile(join(root, 'src/App.tsx'), code);
  const result = await createStaticAnalyzer({ workspaceRoot: root }).analyzeDetailed({
    requestId: 'cache-test',
    sources: [{ file: 'src/App.tsx', start: null, end: null }],
  });
  const identity: CacheIdentityInput = {
    scope: 'component',
    kind: 'analysis',
    subject: cacheFingerprint('src/App.tsx'),
    revision: result.sourceHashes['src/App.tsx'] ?? '',
    policy: cacheFingerprint('test-policy'),
    runtime: cacheFingerprint('static-only'),
    provider: 'deterministic',
    model: 'typescript-6.0.3',
    schemaVersion: 'static-2',
  };
  const cache = await openPersistentCache({ workspaceRoot: root, ...options });
  caches.push(cache);
  const payload: CachePayload = { type: 'static', result };
  const hashes = result.dependencyHashes ?? result.sourceHashes;
  async function put(context: CacheIdentityInput = identity, value: CachePayload = payload) {
    const previous = await cache.get(context);
    return cache.put({
      identity: context,
      payload: value,
      hashes,
      generation: previous.generation,
    });
  }
  return { root, cache, result, identity, payload, hashes, code, put };
}
describe('SQLite persistent cache', () => {
  it('survives worker/server restart, preserves source evidence and labels fresh findings', async () => {
    const f = await fixture();
    expect((await f.cache.get(f.identity)).status).toBe('miss');
    expect((await f.put()).stored).toBe(true);
    await f.cache.close();
    const reopened = await openPersistentCache({ workspaceRoot: f.root });
    caches.push(reopened);
    const hit = await reopened.get(f.identity);
    expect(hit.status).toBe('fresh');
    if (hit.status === 'miss' || hit.payload.type !== 'static')
      throw new Error('Missing cached analysis');
    expect(
      hit.payload.result.findings.some(
        (finding) => finding.confidence === 'VERIFIED' && finding.cacheStatus === 'fresh',
      ),
    ).toBe(true);
    expect((await stat(join(f.root, '.cache/devanalyst/analysis.sqlite'))).mode & 0o777).toBe(
      0o600,
    );
  });
  it('stores page/component/element scopes and translation separately with context/version keys', async () => {
    const f = await fixture();
    for (const scope of ['page', 'component', 'element'] as const)
      expect(
        (
          await f.put({
            ...f.identity,
            scope,
            ...(scope === 'page' ? { route: cacheFingerprint('/test') } : {}),
          })
        ).stored,
      ).toBe(true);
    const translation: CachePayload = {
      type: 'translation',
      findings: [
        {
          id: crypto.randomUUID(),
          type: 'translation',
          confidence: 'UNKNOWN',
          explanation: 'Lưu',
          evidence: null,
          cacheStatus: 'miss',
          analyzedAt: new Date().toISOString(),
        },
      ],
    };
    await f.put(
      {
        ...f.identity,
        kind: 'translation',
        provider: 'claude-code',
        model: 'sonnet',
        language: 'vi',
      },
      translation,
    );
    const inspected = await f.cache.inspect();
    expect(inspected.scopes).toMatchObject({ page: 1, component: 2, element: 1 });
    expect(inspected.kinds).toMatchObject({ analysis: 3, translation: 1 });
    for (const override of [
      { route: cacheFingerprint('/different') },
      { runtime: cacheFingerprint('different-state') },
      { model: 'other-model' },
      { provider: 'other-provider' },
      { schemaVersion: 'static-3' },
      { policy: cacheFingerprint('other-policy') },
      { language: 'vi' as const },
    ])
      expect((await f.cache.get({ ...f.identity, ...override })).status).toBe('miss');
    expect(await f.cache.clear({ kind: 'translation' })).toBe(1);
    expect((await f.cache.inspect()).entries).toBe(3);
  });
  it('invalidates dependencies, preserves unrelated entries and downgrades all stale confidence', async () => {
    const f = await fixture();
    await f.put();
    await writeFile(join(f.root, 'src/Other.tsx'), 'export const Other=()=> <a/>');
    const other = await createStaticAnalyzer({ workspaceRoot: f.root }).analyzeDetailed({
      requestId: 'other',
      sources: [{ file: 'src/Other.tsx', start: null, end: null }],
    });
    const identity = {
      ...f.identity,
      subject: cacheFingerprint('other'),
      revision: other.sourceHashes['src/Other.tsx'] ?? '',
    };
    const miss = await f.cache.get(identity);
    await f.cache.put({
      identity,
      payload: { type: 'static', result: other },
      hashes: other.sourceHashes,
      generation: miss.generation,
    });
    await writeFile(join(f.root, 'src/App.tsx'), f.code.replace('/orders', '/updated'));
    await f.cache.invalidateSource(
      'src/App.tsx',
      createHash('sha256').update(f.code.replace('/orders', '/updated')).digest('hex'),
    );
    expect((await f.cache.get(f.identity)).status).toBe('miss');
    expect((await f.cache.get(identity)).status).toBe('fresh');
    const stale = await f.cache.get(f.identity, { allowStale: true });
    expect(stale.status).toBe('stale');
    if (stale.status === 'miss' || stale.payload.type !== 'static')
      throw new Error('Missing historical result');
    expect(
      stale.payload.result.findings.every(
        (finding) => finding.confidence === 'UNKNOWN' && finding.cacheStatus === 'stale',
      ),
    ).toBe(true);
    expect(stale.payload.result.graph.edges.every((edge) => edge.confidence === 'UNKNOWN')).toBe(
      true,
    );
  });
  it('detects changes made while the dev server was stopped without trusting watcher history', async () => {
    const f = await fixture();
    await f.put();
    await f.cache.close();
    await writeFile(join(f.root, 'src/App.tsx'), f.code + '\n// edited offline');
    const cache = await openPersistentCache({ workspaceRoot: f.root });
    caches.push(cache);
    expect((await cache.get(f.identity)).status).toBe('miss');
  });
  it('detects a newly appearing resolution candidate even when existing source bytes are unchanged', async () => {
    const f = await fixture();
    const missing = ['src/alternative.ts'];
    const previous = await f.cache.get(f.identity);
    await f.cache.put({
      identity: f.identity,
      payload: f.payload,
      hashes: f.hashes,
      missing,
      generation: previous.generation,
    });
    expect((await f.cache.get(f.identity)).status).toBe('fresh');
    await writeFile(join(f.root, 'src/alternative.ts'), 'export const value=1');
    expect((await f.cache.get(f.identity)).status).toBe('miss');
  });
  it('uses transactional generation checks across workers for invalidation and clear', async () => {
    const f = await fixture();
    const second = await openPersistentCache({ workspaceRoot: f.root });
    caches.push(second);
    expect(second.initialInspection.persistent).toBe(true);
    const lease = await f.cache.get(f.identity);
    await second.invalidateSource('src/App.tsx', null, true);
    expect(
      (
        await f.cache.put({
          identity: f.identity,
          payload: f.payload,
          hashes: f.hashes,
          generation: lease.generation,
        })
      ).stored,
    ).toBe(false);
    await f.put();
    const next = await f.cache.get(f.identity);
    await second.clear();
    expect(
      (
        await f.cache.put({
          identity: f.identity,
          payload: f.payload,
          hashes: f.hashes,
          generation: next.generation,
        })
      ).stored,
    ).toBe(false);
  });
  it('serializes concurrent writers without duplicate or partial records', async () => {
    const f = await fixture();
    const second = await openPersistentCache({ workspaceRoot: f.root });
    caches.push(second);
    await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const cache = index % 2 ? f.cache : second,
          identity = { ...f.identity, subject: cacheFingerprint(index) };
        const previous = await cache.get(identity);
        await cache.put({
          identity,
          payload: f.payload,
          hashes: f.hashes,
          generation: previous.generation,
        });
      }),
    );
    expect((await f.cache.inspect()).entries).toBe(20);
    expect((await second.get(f.identity)).status).toBe('miss');
  });
  it('migrates populated v1 atomically across concurrent openers and invalidates legacy records', async () => {
    const f = await fixture();
    await f.put();
    await f.cache.close();
    const file = join(f.root, '.cache/devanalyst/analysis.sqlite');
    const db = new DatabaseSync(file);
    db.exec(
      'ALTER TABLE entries DROP COLUMN aliases; ALTER TABLE entries DROP COLUMN missing; PRAGMA user_version=1;',
    );
    db.close();
    const opened = await Promise.all([
      openPersistentCache({ workspaceRoot: f.root }),
      openPersistentCache({ workspaceRoot: f.root }),
    ]);
    caches.push(...opened);
    for (const cache of opened) {
      expect(cache.initialInspection.persistent).toBe(true);
      expect(cache.initialInspection.schemaVersion).toBe(3);
      expect((await cache.get(f.identity)).status).toBe('miss');
    }
    const stale = await opened[0]?.get(f.identity, { allowStale: true });
    expect(stale?.status).toBe('stale');
  });
  it('falls back safely on corrupted or future databases without overwriting them', async () => {
    const f = await fixture();
    await f.cache.close();
    const file = join(f.root, '.cache/devanalyst/analysis.sqlite');
    await writeFile(file, 'not a sqlite database');
    const before = await readFile(file);
    const corrupt = await openPersistentCache({ workspaceRoot: f.root });
    caches.push(corrupt);
    expect(corrupt.initialInspection).toMatchObject({
      persistent: false,
      diagnostic: 'CACHE_CORRUPT',
    });
    expect(await readFile(file)).toEqual(before);
    await corrupt.close();
    await rm(file);
    const db = new DatabaseSync(file);
    db.exec('PRAGMA application_id=1145132611; PRAGMA user_version=999;');
    db.close();
    const futureBytes = await readFile(file);
    const future = await openPersistentCache({ workspaceRoot: f.root });
    caches.push(future);
    expect(future.initialInspection).toMatchObject({
      persistent: false,
      diagnostic: 'CACHE_INCOMPATIBLE',
    });
    expect(await readFile(file)).toEqual(futureBytes);
  });
  it('rejects private runtime fields, sensitive sources and likely credentials before writing', async () => {
    const f = await fixture();
    expect(
      payloadSchema.safeParse({ type: 'translation', findings: [], value: 'PRIVATE-PASSWORD' })
        .success,
    ).toBe(false);
    const secret: CachePayload = {
      type: 'explanation',
      findings: [
        {
          id: crypto.randomUUID(),
          type: 'explanation',
          confidence: 'UNKNOWN',
          explanation: 'api_key="super-secret-token-value"',
          evidence: null,
          cacheStatus: 'miss',
          analyzedAt: new Date().toISOString(),
        },
      ],
    };
    await expect(f.put(f.identity, secret)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    await expect(
      f.cache.put({
        identity: f.identity,
        payload: f.payload,
        hashes: { 'src/.env.ts': 'a'.repeat(64) },
        generation: 0,
      }),
    ).rejects.toBeDefined();
    expect((await f.cache.inspect()).entries).toBe(0);
  });
  it('isolates projects and refuses symlink cache directories', async () => {
    const f = await fixture();
    await f.put();
    const external = await mkdtemp(join(tmpdir(), 'devanalyst-cache-outside-'));
    roots.push(external);
    await symlink(external, join(f.root, 'linked-cache'));
    const cache = await openPersistentCache({ workspaceRoot: f.root, directory: 'linked-cache' });
    caches.push(cache);
    expect(cache.initialInspection).toMatchObject({
      persistent: false,
      diagnostic: 'CACHE_UNAVAILABLE',
    });
    expect(createCacheKey('a'.repeat(64), f.identity, f.hashes).key).not.toBe(
      createCacheKey('b'.repeat(64), f.identity, f.hashes).key,
    );
  });
  it('evicts oldest entries at capacity, expires safely and bounds pending work', async () => {
    const f = await fixture({ maxEntries: 2 });
    await f.put();
    await f.put({ ...f.identity, subject: cacheFingerprint('two') });
    await f.put({ ...f.identity, subject: cacheFingerprint('three') });
    expect((await f.cache.inspect()).entries).toBe(2);
    expect((await f.cache.get(f.identity)).status).toBe('miss');
    const small = await openPersistentCache({ workspaceRoot: f.root, maxPending: 1, ttlMs: 1 });
    caches.push(small);
    const pending = small.inspect();
    await expect(small.inspect()).rejects.toMatchObject({ code: 'CACHE_QUEUE_FULL' });
    await pending;
    await small.close();
    await expect(small.inspect()).rejects.toMatchObject({ code: 'CACHE_CLOSED' });
  });
  it('expires into explicitly stale results and stops serving history after the stale window', async () => {
    const f = await fixture({ staleMs: 86400000 });
    await f.put();
    const db = new DatabaseSync(join(f.root, '.cache/devanalyst/analysis.sqlite'));
    try {
      db.prepare('UPDATE entries SET expires=?').run(Date.now() - 1000);
      expect((await f.cache.get(f.identity)).status).toBe('miss');
      expect((await f.cache.get(f.identity, { allowStale: true })).status).toBe('stale');
      db.prepare('UPDATE entries SET expires=?').run(Date.now() - 2 * 86400000);
      expect((await f.cache.get(f.identity, { allowStale: true })).status).toBe('miss');
    } finally {
      db.close();
    }
  });
  it('enforces byte eviction with bounded database and rollback journal overhead', async () => {
    const f = await fixture({ maxBytes: 65536, maxEntries: 100 });
    const payload: CachePayload = {
      type: 'explanation',
      findings: [
        {
          id: crypto.randomUUID(),
          type: 'explanation',
          confidence: 'UNKNOWN',
          explanation: 'x'.repeat(12000),
          evidence: null,
          cacheStatus: 'miss',
          analyzedAt: new Date().toISOString(),
        },
      ],
    };
    for (let i = 0; i < 8; i++)
      await f.put({ ...f.identity, subject: cacheFingerprint(i) }, payload);
    const info = await f.cache.inspect();
    expect(info.bytes).toBeLessThanOrEqual(65536);
    expect(info.entries).toBeLessThan(8);
    expect(info.databaseBytes).toBeLessThanOrEqual(2 * 65536 + 4 * 1024 * 1024);
    expect(info.journalBytes).toBe(0);
  });
  it('discards a corrupted row without presenting it as a valid analysis', async () => {
    const f = await fixture();
    await f.put();
    const db = new DatabaseSync(join(f.root, '.cache/devanalyst/analysis.sqlite'));
    db.prepare('UPDATE entries SET payload=?').run('{}');
    db.close();
    expect((await f.cache.get(f.identity)).status).toBe('miss');
    expect(await f.cache.inspect()).toMatchObject({ entries: 0, diagnostic: 'CACHE_CORRUPT' });
  });
  it('detects symlink retargeting even when both target modules contain the same bytes', async () => {
    const f = await fixture();
    await mkdir(join(f.root, 'src/first'));
    await mkdir(join(f.root, 'src/second'));
    const service = 'export {save} from "./value";';
    for (const name of ['first', 'second'])
      await writeFile(join(f.root, `src/${name}/service.ts`), service);
    await writeFile(
      join(f.root, 'src/first/value.ts'),
      'export function save(){return fetch("/first")}',
    );
    await writeFile(
      join(f.root, 'src/second/value.ts'),
      'export function save(){return fetch("/second")}',
    );
    const code = 'import {save} from "./alias";export const App=()=> <button onClick={save}/>;';
    await writeFile(join(f.root, 'src/App.tsx'), code);
    const alias = join(f.root, 'src/alias.ts');
    await symlink(join(f.root, 'src/first/service.ts'), alias);
    const result = await createStaticAnalyzer({ workspaceRoot: f.root }).analyzeDetailed({
      requestId: 'alias',
      sources: [{ file: 'src/App.tsx', start: null, end: null }],
    });
    expect(result.sourceAliases?.['src/alias.ts']).toBe('src/first/service.ts');
    const identity = { ...f.identity, revision: result.sourceHashes['src/App.tsx'] ?? '' };
    const miss = await f.cache.get(identity);
    expect(
      (
        await f.cache.put({
          identity,
          payload: { type: 'static', result },
          hashes: result.dependencyHashes ?? result.sourceHashes,
          missing: result.missingDependencies ?? [],
          aliases: result.sourceAliases ?? {},
          generation: miss.generation,
        })
      ).stored,
    ).toBe(true);
    expect((await f.cache.get(identity)).status).toBe('fresh');
    await unlink(alias);
    await symlink(join(f.root, 'src/second/service.ts'), alias);
    expect((await f.cache.get(identity)).status).toBe('miss');
  });
  it('bounds SQLite lock waits without blocking the parent event loop and recovers after the writer releases', async () => {
    const f = await fixture();
    await f.put();
    const lease = await f.cache.get(f.identity);
    const db = new DatabaseSync(join(f.root, '.cache/devanalyst/analysis.sqlite'));
    db.exec('BEGIN IMMEDIATE');
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      await expect(
        f.cache.put({
          identity: f.identity,
          payload: f.payload,
          hashes: f.hashes,
          generation: lease.generation,
        }),
      ).rejects.toMatchObject({ code: 'CACHE_BUSY' });
      expect(ticks).toBeGreaterThan(3);
    } finally {
      clearInterval(timer);
      db.exec('ROLLBACK');
      db.close();
    }
    expect((await f.cache.get(f.identity)).status).toBe('fresh');
  });
});
