import { describe, expect, it } from 'vitest';
import { createMappingRegistry } from './mapping-runtime.js';
import type { SourceModuleManifest } from '@devanalyst/core';
const fixture = (revision = 'b'.repeat(64)): SourceModuleManifest => ({
  version: 1,
  moduleId: 'a'.repeat(64),
  revision,
  sites: [
    {
      id: 'c'.repeat(64),
      tag: 'button',
      source: { file: 'src/App.tsx', start: { line: 2, column: 10 }, end: { line: 2, column: 19 } },
      component: {
        id: 'd'.repeat(64),
        name: 'App',
        source: { file: 'src/App.tsx', start: { line: 1, column: 1 }, end: { line: 3, column: 2 } },
      },
    },
  ],
});
const element = (localName = 'button') => ({ nodeType: 1, localName, isConnected: true });
describe('committed DOM provenance registry', () => {
  it('verifies the actual ref-bound node, never attributes, selectors, ancestors or clones', () => {
    const registry = createMappingRegistry(),
      node = element();
    registry.register(fixture()).ref(0)(node);
    expect(registry.resolve(node)).toMatchObject({
      status: 'VERIFIED',
      source: { file: 'src/App.tsx' },
      component: { name: 'App' },
      strategy: 'compile-time-ref-v1',
    });
    expect(registry.resolve(element())).toMatchObject({
      status: 'UNKNOWN',
      reason: 'NOT_INSTRUMENTED',
      source: null,
    });
  });
  it('separates repeated instances without collecting keys or props and preserves identity through ref replacement', () => {
    const registry = createMappingRegistry(),
      module = registry.register(fixture()),
      a = element(),
      b = element();
    const ref = module.ref(0);
    ref(a);
    module.ref(0)(b);
    const first = registry.resolve(a),
      second = registry.resolve(b);
    if (first.status !== 'VERIFIED' || second.status !== 'VERIFIED')
      throw new Error('Missing mapping');
    expect(first.elementId).toBe(second.elementId);
    expect(first.runtimeId).not.toBe(second.runtimeId);
    ref(null);
    expect(registry.resolve(a).status).toBe('UNKNOWN');
    module.ref(0)(a);
    expect(registry.resolve(a).runtimeId).toBe(first.runtimeId);
  });
  it('cleans ref detach, tolerates StrictMode setup/cleanup and does not return a React cleanup function', () => {
    const registry = createMappingRegistry(),
      node = element(),
      ref = registry.register(fixture()).ref(0);
    expect(ref(node)).toBeUndefined();
    ref(null);
    ref(node);
    expect(registry.resolve(node).status).toBe('VERIFIED');
    ref(null);
    expect(registry.resolve(node).status).toBe('UNKNOWN');
  });
  it('invalidates old revisions and prevents an old disposal from invalidating a new module', () => {
    const registry = createMappingRegistry(),
      node = element(),
      old = registry.register(fixture());
    old.ref(0)(node);
    old.invalidate();
    expect(registry.resolve(node)).toMatchObject({ status: 'UNKNOWN', reason: 'STALE_SOURCE' });
    const next = registry.register(fixture('e'.repeat(64)));
    next.ref(0)(node);
    old.invalidate();
    expect(registry.resolve(node).status).toBe('VERIFIED');
  });
  it('never certifies multiple active owners or one ref reused across simultaneous nodes', () => {
    const registry = createMappingRegistry(),
      module = registry.register(fixture()),
      node = element();
    module.ref(0)(node);
    module.ref(0)(node);
    expect(registry.resolve(node)).toMatchObject({
      status: 'UNKNOWN',
      reason: 'AMBIGUOUS_BINDING',
    });
    const a = element(),
      b = element(),
      shared = module.ref(0);
    shared(a);
    shared(b);
    expect(registry.resolve(a).status).toBe('UNKNOWN');
    expect(registry.resolve(b).status).toBe('UNKNOWN');
  });
  it('rejects detached nodes and tag mismatches', () => {
    const registry = createMappingRegistry(),
      module = registry.register(fixture()),
      node = element('a');
    module.ref(0)(node);
    expect(registry.resolve(node)).toMatchObject({ status: 'UNKNOWN', reason: 'TAG_MISMATCH' });
    node.isConnected = false;
    expect(registry.resolve(node)).toMatchObject({ status: 'UNKNOWN', reason: 'DETACHED_ELEMENT' });
  });
  it.each([
    {},
    null,
    { ...fixture(), version: 2 },
    {
      ...fixture(),
      sites: [
        {
          ...fixture().sites[0],
          source: {
            file: '/private/source.tsx',
            start: { line: 1, column: 1 },
            end: { line: 1, column: 2 },
          },
        },
      ],
    },
    {
      ...fixture(),
      sites: [
        {
          ...fixture().sites[0],
          source: {
            file: 'src/App.tsx',
            start: { line: 0, column: 1 },
            end: { line: 1, column: 2 },
          },
        },
      ],
    },
  ])('rejects malformed manifests without affecting the host', (value) => {
    const registry = createMappingRegistry(),
      node = element();
    expect(() => registry.register(value).ref(0)(node)).not.toThrow();
    expect(registry.resolve(node).status).toBe('UNKNOWN');
  });
  it('does not expose mutable source records through caller inputs or result snapshots', () => {
    const registry = createMappingRegistry(),
      manifest = fixture(),
      node = element();
    registry.register(manifest).ref(0)(node);
    Reflect.set(manifest.sites[0]?.source ?? {}, 'file', 'src/wrong.tsx');
    const snapshot = registry.resolve(node);
    if (snapshot.status !== 'VERIFIED') throw new Error('Missing mapping');
    Reflect.set(snapshot.source, 'file', 'src/wrong.tsx');
    expect(registry.resolve(node)).toMatchObject({ source: { file: 'src/App.tsx' } });
  });
});

it('ignores invalidation for other generations and exposes stale evidence immediately for the matching generation', () => {
  const registry = createMappingRegistry(),
    node = element();
  const initial = fixture(),
    module = registry.register(initial);
  module.ref(0)(node);
  module.invalidateSource({ moduleId: initial.moduleId, revision: 'f'.repeat(64) });
  expect(registry.resolve(node).status).toBe('VERIFIED');
  module.invalidateSource({ moduleId: initial.moduleId, revision: initial.revision });
  expect(registry.resolve(node)).toMatchObject({
    status: 'UNKNOWN',
    reason: 'STALE_SOURCE',
    source: null,
  });
});
