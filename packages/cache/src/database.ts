import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { constants, lstatSync } from 'node:fs';
import { lstat, mkdir, realpath, open, chmod } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createWorkspaceAccess } from '@devanalyst/analyzer/workspace';
import { DevAnalystError } from '@devanalyst/core';
import { z } from 'zod';
import {
  cacheOptionsSchema,
  cacheIdentitySchema,
  recordSchema,
  type CacheIdentity,
  type CacheWrite,
  type PersistentLookup,
  type CacheInspection,
  type commandSchema,
} from './contracts.js';
import { payloadSchema, labelPayload, type CachePayload } from './payload.js';
import { cacheFingerprint, createCacheKey } from './key.js';
import { safePersistence, safeRelativeFile } from './privacy.js';

export const DATABASE_VERSION = 3;
const APPLICATION_ID = 0x44415643;
export const V1_SCHEMA = `
CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
INSERT INTO meta VALUES(1,0);
CREATE TABLE entries (key TEXT PRIMARY KEY, base TEXT NOT NULL, project TEXT NOT NULL, identity TEXT NOT NULL,
 payload TEXT NOT NULL, hashes TEXT NOT NULL, fingerprint TEXT NOT NULL, checksum TEXT NOT NULL,
 created INTEGER NOT NULL, expires INTEGER NOT NULL, accessed INTEGER NOT NULL, stale INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL) STRICT;
CREATE INDEX entries_base ON entries(project,base,created DESC);
CREATE TABLE dependencies (key TEXT NOT NULL REFERENCES entries(key) ON DELETE CASCADE, project TEXT NOT NULL, file TEXT NOT NULL, hash TEXT, PRIMARY KEY(key,file)) STRICT;
CREATE INDEX dependencies_file ON dependencies(project,file);
`;
class CacheFailure extends Error {
  constructor(readonly code: 'CACHE_CORRUPT' | 'CACHE_INCOMPATIBLE' | 'CACHE_UNAVAILABLE') {
    super(code);
  }
}
const rowSchema = z.object({
  key: z.string(),
  identity: z.string(),
  payload: z.string(),
  hashes: z.string(),
  missing: z.string(),
  aliases: z.string(),
  fingerprint: z.string(),
  checksum: z.string(),
  created: z.number(),
  expires: z.number(),
  stale: z.number(),
});
async function ownedPath(root: string, directory: string): Promise<string> {
  let parent = root;
  const parts = directory.split('/');
  if (!safeRelativeFile(directory) || parts.some((part) => !part || part === '.' || part === '..'))
    throw new CacheFailure('CACHE_UNAVAILABLE');
  for (const part of parts) {
    parent = join(parent, part);
    try {
      await mkdir(parent, { mode: 0o700 });
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
        throw error;
    }
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CacheFailure('CACHE_UNAVAILABLE');
  }
  const canonical = await realpath(parent);
  if (!canonical.startsWith(root + sep)) throw new CacheFailure('CACHE_UNAVAILABLE');
  const info = await lstat(canonical);
  if (process.getuid && info.uid !== process.getuid()) throw new CacheFailure('CACHE_UNAVAILABLE');
  await chmod(canonical, 0o700);
  const file = join(canonical, 'analysis.sqlite');
  try {
    const handle = await open(
      file,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.close();
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'))
      throw error;
  }
  const database = await lstat(file);
  if (
    !database.isFile() ||
    database.isSymbolicLink() ||
    database.nlink !== 1 ||
    (process.getuid && database.uid !== process.getuid())
  )
    throw new CacheFailure('CACHE_UNAVAILABLE');
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      const sidecar = await lstat(file + suffix);
      if (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.nlink !== 1)
        throw new CacheFailure('CACHE_UNAVAILABLE');
    } catch (error: unknown) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw error;
    }
  }
  await chmod(file, 0o600);
  return file;
}
/** All synchronous SQLite and filesystem bookkeeping executes only in the owned cache worker. */
export async function openDatabase(input: unknown) {
  const options = cacheOptionsSchema.parse(input);
  const root = await realpath(options.workspaceRoot);
  const access = await createWorkspaceAccess(root, options.source);
  const project = cacheFingerprint({ root, source: options.source });
  let persistent = true,
    diagnostic: CacheInspection['diagnostic'] = null,
    file: string | null = null;
  let db: DatabaseSync | undefined;
  function scalar(sql: string, column: string): number {
    const row = db?.prepare(sql).get();
    const value = row?.[column];
    if (typeof value !== 'number' || !Number.isSafeInteger(value))
      throw new CacheFailure('CACHE_CORRUPT');
    return value;
  }
  function migrate(): void {
    if (!db) throw new CacheFailure('CACHE_UNAVAILABLE');
    db.exec(
      'PRAGMA busy_timeout=500; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;',
    );
    const checked = db.prepare('PRAGMA quick_check(1)').get();
    if (checked?.['quick_check'] !== 'ok') throw new CacheFailure('CACHE_CORRUPT');
    db.exec('BEGIN IMMEDIATE');
    try {
      const application = scalar('PRAGMA application_id', 'application_id');
      let version = scalar('PRAGMA user_version', 'user_version');
      const tables = scalar(
        "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        'n',
      );
      if (
        version > DATABASE_VERSION ||
        (application !== APPLICATION_ID && !(application === 0 && version === 0 && tables === 0))
      )
        throw new CacheFailure('CACHE_INCOMPATIBLE');
      if (version === 0) {
        db.exec(V1_SCHEMA);
        db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;`);
        version = 1;
      }
      if (version === 1) {
        db.exec(
          "ALTER TABLE entries ADD COLUMN missing TEXT NOT NULL DEFAULT '[]'; UPDATE entries SET stale=1; PRAGMA user_version=2;",
        );
      }
      if (version <= 2) {
        db.exec(
          "ALTER TABLE entries ADD COLUMN aliases TEXT NOT NULL DEFAULT '{}'; UPDATE entries SET stale=1; PRAGMA user_version=3;",
        );
      }
      // Compile the expected schema before accepting even an apparently compatible header.
      db.prepare('SELECT key,checksum,missing,aliases FROM entries LIMIT 0').all();
      db.prepare('SELECT generation FROM meta WHERE id=1').get();
      db.exec('COMMIT');
    } catch (error: unknown) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.exec(
      `PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA journal_size_limit=0; PRAGMA max_page_count=${Math.floor((options.maxBytes * 2 + 4 * 1024 * 1024) / 4096)};`,
    );
  }
  try {
    file = await ownedPath(root, options.directory);
    if ((await lstat(file)).size > options.maxBytes * 2 + 4 * 1024 * 1024)
      throw new CacheFailure('CACHE_UNAVAILABLE');
    db = new DatabaseSync(file, {
      timeout: 500,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    migrate();
  } catch (error: unknown) {
    try {
      db?.close();
    } catch {
      /* The failed connection is never reused. */
    }
    diagnostic =
      error instanceof CacheFailure
        ? error.code
        : typeof error === 'object' &&
            error !== null &&
            'errcode' in error &&
            (error.errcode === 11 || error.errcode === 26)
          ? 'CACHE_CORRUPT'
          : 'CACHE_UNAVAILABLE';
    persistent = false;
    file = null;
    db = new DatabaseSync(':memory:');
    migrate();
  }
  const connection = db;
  function transaction<T>(run: () => T): T {
    connection.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      connection.exec('COMMIT');
      return value;
    } catch (error: unknown) {
      connection.exec('ROLLBACK');
      throw error;
    }
  }
  function generation(): number {
    return scalar('SELECT generation FROM meta WHERE id=1', 'generation');
  }
  function advance(): number {
    connection.exec('UPDATE meta SET generation=generation+1 WHERE id=1');
    return generation();
  }
  function bytes(): number {
    return scalar('SELECT coalesce(sum(bytes),0) AS n FROM entries', 'n');
  }
  function evict(incoming = 0): void {
    connection.prepare('DELETE FROM entries WHERE expires < ?').run(Date.now() - options.staleMs);
    let count = scalar('SELECT count(*) AS n FROM entries', 'n');
    while (count >= options.maxEntries || bytes() + incoming > options.maxBytes) {
      const victim = connection
        .prepare('SELECT key FROM entries ORDER BY stale DESC,accessed,key LIMIT 1')
        .get();
      if (typeof victim?.['key'] !== 'string') break;
      connection.prepare('DELETE FROM entries WHERE key=?').run(victim['key']);
      count--;
    }
  }
  async function validate(
    hashes: Readonly<Record<string, string>>,
    missing: readonly string[],
    aliases: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    try {
      for (const [path, hash] of Object.entries(hashes))
        if (
          !safeRelativeFile(path) ||
          createHash('sha256')
            .update(await access.readSource(path))
            .digest('hex') !== hash
        )
          return false;
      for (const [alias, target] of Object.entries(aliases))
        if (
          !safeRelativeFile(alias) ||
          !safeRelativeFile(target) ||
          (await access.canonicalSourcePath(resolve(root, alias))) !== target
        )
          return false;
      for (const path of missing) {
        if (
          !safeRelativeFile(path) ||
          !(await access.sourcePath(resolve(root, path), true)) ||
          (await access.canonicalSourcePath(resolve(root, path)))
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  async function privatePayload(
    payload: CachePayload,
    hashes: Readonly<Record<string, string>>,
  ): Promise<boolean> {
    const files = new Set<string>();
    let safe = true;
    function visit(value: unknown, key = ''): void {
      if (typeof value === 'string') {
        if (!safePersistence(value)) safe = false;
        if (key === 'file') files.add(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value && typeof value === 'object')
        for (const [name, item] of Object.entries(value)) visit(item, name);
    }
    visit(payload);
    for (const path of files) if (!safeRelativeFile(path) || !hashes[path]) safe = false;
    for (const path of Object.keys(hashes)) if (!safeRelativeFile(path)) safe = false;
    return safe;
  }
  async function get(identity: CacheIdentity, allowStale: boolean): Promise<PersistentLookup> {
    const base = createCacheKey(project, identity, {}).base;
    const raw = connection
      .prepare('SELECT * FROM entries WHERE project=? AND base=? ORDER BY created DESC,key LIMIT 1')
      .get(project, base);
    if (!raw) return { status: 'miss', generation: generation() };
    try {
      if (
        Buffer.byteLength(String(raw['payload'])) +
          Buffer.byteLength(String(raw['hashes'])) +
          Buffer.byteLength(String(raw['missing'])) +
          Buffer.byteLength(String(raw['aliases'])) >
        2 * 1024 * 1024
      )
        throw new CacheFailure('CACHE_CORRUPT');
      const row = rowSchema.parse(raw),
        storedIdentity = cacheIdentitySchema.parse(JSON.parse(row.identity));
      const hashes = z.record(z.string(), z.string()).parse(JSON.parse(row.hashes)),
        missing = z.array(z.string()).parse(JSON.parse(row.missing));
      const aliases = z.record(z.string(), z.string()).parse(JSON.parse(row.aliases));
      const payload = payloadSchema.parse(JSON.parse(row.payload));
      const keys = createCacheKey(project, storedIdentity, hashes, missing, aliases);
      if (
        keys.base !== base ||
        keys.key !== row.key ||
        keys.fingerprint !== row.fingerprint ||
        cacheFingerprint({ payload, hashes, missing, aliases, identity: storedIdentity }) !==
          row.checksum ||
        !(await privatePayload(payload, hashes))
      )
        throw new CacheFailure('CACHE_CORRUPT');
      const observedGeneration = generation();
      const valid =
        storedIdentity.revision === identity.revision &&
        row.stale === 0 &&
        row.expires > Date.now() &&
        (payload.type !== 'static' || payload.result.completion === 'complete') &&
        (await validate(hashes, missing, aliases));
      // Another process can invalidate while asynchronous source reads are in flight.
      const currentGeneration = generation();
      const fresh = valid && observedGeneration === currentGeneration;
      if (!fresh) connection.prepare('UPDATE entries SET stale=1 WHERE key=?').run(row.key);
      if (!fresh && (!allowStale || row.expires + options.staleMs < Date.now()))
        return { status: 'miss', generation: currentGeneration };
      connection.prepare('UPDATE entries SET accessed=? WHERE key=?').run(Date.now(), row.key);
      return {
        status: fresh ? 'fresh' : 'stale',
        generation: currentGeneration,
        key: row.key,
        payload: labelPayload(payload, !fresh),
        cachedAt: new Date(row.created).toISOString(),
        expiresAt: new Date(row.expires).toISOString(),
        fingerprint: row.fingerprint,
      };
    } catch (error: unknown) {
      if (
        error instanceof CacheFailure ||
        error instanceof z.ZodError ||
        error instanceof SyntaxError
      ) {
        transaction(() => {
          connection.prepare('DELETE FROM entries WHERE key=?').run(String(raw['key']));
          advance();
        });
        diagnostic = 'CACHE_CORRUPT';
        return { status: 'miss', generation: generation() };
      }
      throw error;
    }
  }
  async function put(input: CacheWrite): Promise<{ stored: boolean; key: string }> {
    const record = recordSchema.parse(input),
      { identity, payload, hashes, missing, aliases } = record;
    if ((identity.kind === 'translation') !== (payload.type === 'translation'))
      throw new DevAnalystError(
        'INVALID_MESSAGE',
        'Keep translations separate from code analysis.',
      );
    if (
      payload.type === 'static' &&
      Object.entries(payload.result.dependencyHashes ?? payload.result.sourceHashes).some(
        ([path, hash]) => hashes[path] !== hash,
      )
    )
      throw new DevAnalystError(
        'INVALID_MESSAGE',
        'Supply the complete source dependency fingerprint.',
      );
    if (
      payload.type === 'static' &&
      (Object.entries(payload.result.sourceHashes).some(([path, hash]) => hashes[path] !== hash) ||
        (payload.result.missingDependencies ?? []).some((path) => !missing.includes(path)) ||
        Object.entries(payload.result.sourceAliases ?? {}).some(
          ([alias, target]) => aliases[alias] !== target,
        ))
    )
      throw new DevAnalystError(
        'INVALID_MESSAGE',
        'Supply source hashes and unresolved candidates without dropping dependencies.',
      );
    if (!(await privatePayload(payload, hashes)))
      throw new DevAnalystError(
        'INVALID_MESSAGE',
        'Cache context contains excluded fields, paths or likely secrets.',
      );
    if (
      !Object.values(identity).every((value) => typeof value !== 'string' || safePersistence(value))
    )
      throw new DevAnalystError('INVALID_MESSAGE', 'Cache identity contains a likely credential.');
    const keys = createCacheKey(project, identity, hashes, missing, aliases);
    const encoded = JSON.stringify(payload),
      size = Buffer.byteLength(JSON.stringify({ identity, payload, hashes, missing, aliases }));
    if (size > 2 * 1024 * 1024 || size > options.maxBytes)
      throw new DevAnalystError(
        'SOURCE_TOO_LARGE',
        'Cache records are limited to 2 MiB and the configured cache size.',
      );
    if (
      Object.values(aliases).some((target) => !hashes[target]) ||
      !(await validate(hashes, missing, aliases))
    )
      return { stored: false, key: keys.key };
    const stored = transaction(() => {
      if (record.generation !== generation()) return false;
      connection.prepare('DELETE FROM entries WHERE project=? AND base=?').run(project, keys.base);
      evict(size);
      const now = Date.now();
      connection
        .prepare(
          'INSERT INTO entries(key,base,project,identity,payload,hashes,fingerprint,checksum,created,expires,accessed,stale,bytes,missing,aliases) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          keys.key,
          keys.base,
          project,
          JSON.stringify(identity),
          encoded,
          JSON.stringify(hashes),
          keys.fingerprint,
          cacheFingerprint({ payload, hashes, missing, aliases, identity }),
          now,
          now + options.ttlMs,
          now,
          0,
          size,
          JSON.stringify(missing),
          JSON.stringify(aliases),
        );
      const add = connection.prepare(
        'INSERT INTO dependencies(key,project,file,hash) VALUES(?,?,?,?)',
      );
      for (const [path, hash] of Object.entries(hashes)) add.run(keys.key, project, path, hash);
      for (const path of new Set(missing))
        if (!(path in hashes)) add.run(keys.key, project, path, null);
      for (const [alias, target] of Object.entries(aliases))
        if (!(alias in hashes) && !missing.includes(alias))
          add.run(keys.key, project, alias, 'alias:' + cacheFingerprint(target));
      return true;
    });
    return { stored, key: keys.key };
  }
  function inspect(): CacheInspection {
    const scopes: Record<string, number> = {},
      kinds: Record<string, number> = {};
    for (const row of connection
      .prepare('SELECT identity FROM entries WHERE project=?')
      .all(project)) {
      try {
        const identity = cacheIdentitySchema.parse(JSON.parse(String(row['identity'])));
        scopes[identity.scope] = (scopes[identity.scope] ?? 0) + 1;
        kinds[identity.kind] = (kinds[identity.kind] ?? 0) + 1;
      } catch {
        diagnostic = 'CACHE_CORRUPT';
      }
    }
    const records: CacheInspection['records'] = [];
    for (const row of connection
      .prepare(
        'SELECT key,identity,stale,bytes,created FROM entries WHERE project=? ORDER BY accessed DESC LIMIT 100',
      )
      .all(project)) {
      try {
        const identity = cacheIdentitySchema.parse(JSON.parse(String(row['identity'])));
        records.push({
          key: String(row['key']),
          scope: identity.scope,
          kind: identity.kind,
          provider: identity.provider,
          model: identity.model,
          analysisSchema: identity.schemaVersion,
          stale: row['stale'] !== 0,
          bytes: Number(row['bytes']),
          cachedAt: new Date(Number(row['created'])).toISOString(),
        });
      } catch {
        diagnostic = 'CACHE_CORRUPT';
      }
    }
    const size = (path: string) => {
      try {
        return lstatSync(path).size;
      } catch {
        return 0;
      }
    };
    return {
      persistent,
      schemaVersion: DATABASE_VERSION,
      generation: generation(),
      entries: z
        .object({ n: z.number().int() })
        .parse(connection.prepare('SELECT count(*) AS n FROM entries WHERE project=?').get(project))
        .n,
      bytes: bytes(),
      databaseBytes: file ? size(file) : 0,
      journalBytes: file ? size(file + '-journal') : 0,
      diagnostic,
      scopes,
      kinds,
      records,
    };
  }
  return {
    project,
    inspect,
    async execute(command: z.output<typeof commandSchema>): Promise<unknown> {
      switch (command.type) {
        case 'get':
          return get(command.identity, command.allowStale);
        case 'put':
          return put(command.record);
        case 'invalidate':
          return transaction(() => {
            advance();
            const changed = command.topology
              ? connection.prepare('UPDATE entries SET stale=1 WHERE project=?').run(project)
              : connection
                  .prepare(
                    'UPDATE entries SET stale=1 WHERE project=? AND key IN (SELECT key FROM dependencies WHERE project=? AND file=? AND (hash IS NULL OR hash<>?))',
                  )
                  .run(project, project, command.file, command.revision ?? '');
            return Number(changed.changes);
          });
        case 'clear':
          return transaction(() => {
            advance();
            const rows = connection
              .prepare('SELECT key,identity FROM entries WHERE project=?')
              .all(project);
            let n = 0;
            for (const row of rows) {
              const identity = cacheIdentitySchema.parse(JSON.parse(String(row['identity'])));
              if (
                (command.scope === null || identity.scope === command.scope) &&
                (command.kind === null || identity.kind === command.kind)
              ) {
                connection.prepare('DELETE FROM entries WHERE key=?').run(String(row['key']));
                n++;
              }
            }
            return n;
          });
        case 'delete':
          return transaction(() => {
            advance();
            return Number(
              connection
                .prepare('DELETE FROM entries WHERE project=? AND key=?')
                .run(project, command.key).changes,
            );
          });
        case 'inspect':
          return inspect();
        case 'close':
          connection.close();
          return null;
      }
    },
  };
}
