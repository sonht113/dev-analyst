import { expect, it } from 'vitest';
import { vueSourceDirective } from './vue-runtime.js';
import { resolveElementSource, invalidateSourceModule } from './mapping-runtime.js';
function payload(siteId: string, revision = 'a'.repeat(64)) {
  return {
    manifest: {
      version: 1,
      framework: 'vue-vite',
      strategy: 'vue-directive-v1',
      moduleId: 'c'.repeat(64),
      revision,
      sites: [
        {
          id: siteId.repeat(64),
          tag: 'button',
          source: {
            file: 'src/App.vue',
            start: { line: 2, column: 1 },
            end: { line: 2, column: 20 },
          },
          component: null,
        },
      ],
    },
  };
}
it('uses per-DOM Vue directive bindings across instances/sites and replaces only obsolete module revisions', () => {
  const first = { nodeType: 1, localName: 'button', isConnected: true },
    second = { nodeType: 1, localName: 'button', isConnected: true };
  vueSourceDirective.mounted(first, { value: payload('d') });
  vueSourceDirective.mounted(second, { value: payload('e') });
  const a = resolveElementSource(first),
    b = resolveElementSource(second);
  expect(a.status).toBe('VERIFIED');
  expect(b.status).toBe('VERIFIED');
  expect(a.runtimeId).not.toBe(b.runtimeId);
  if (a.status !== 'VERIFIED' || b.status !== 'VERIFIED') throw new Error('Missing Vue origins');
  expect(a.strategy).toBe('vue-directive-v1');
  expect(a.elementId).not.toBe(b.elementId);
  vueSourceDirective.updated(first, { value: payload('d', 'b'.repeat(64)) });
  expect(resolveElementSource(first).status).toBe('VERIFIED');
  expect(resolveElementSource(second)).toMatchObject({ status: 'UNKNOWN', reason: 'STALE_SOURCE' });
  vueSourceDirective.updated(second, { value: payload('e', 'b'.repeat(64)) });
  expect(resolveElementSource(second).status).toBe('VERIFIED');
  invalidateSourceModule({ moduleId: 'c'.repeat(64), revision: 'a'.repeat(64) });
  expect(resolveElementSource(first).status).toBe('VERIFIED');
  vueSourceDirective.beforeUnmount(first);
  expect(resolveElementSource(first)).toMatchObject({
    status: 'UNKNOWN',
    reason: 'NOT_INSTRUMENTED',
  });
  vueSourceDirective.beforeUnmount(second);
});
it('rejects runtime values, invalid manifests and forged source positions', () => {
  const node = { nodeType: 1, localName: 'button', isConnected: true };
  for (const value of [
    'PRIVATE_RUNTIME_VALUE',
    null,
    { manifest: { version: 1, sites: [] } },
    { manifest: { ...payload('a').manifest, sites: [{ id: 'x', source: { file: '../secret' } }] } },
  ]) {
    vueSourceDirective.mounted(node, { value });
    expect(resolveElementSource(node).status).toBe('UNKNOWN');
  }
});

it('demotes an existing Vue module when a conflicting site registration is rejected', () => {
  const node = { nodeType: 1, localName: 'button', isConnected: true };
  const original = payload('f');
  original.manifest.moduleId = '9'.repeat(64);
  vueSourceDirective.mounted(node, { value: original });
  expect(resolveElementSource(node).status).toBe('VERIFIED');
  const conflict = payload('f');
  conflict.manifest.moduleId = original.manifest.moduleId;
  const site = conflict.manifest.sites[0];
  if (!site) throw new Error('Missing test site');
  site.source.start.line = 3;
  site.source.end.line = 3;
  const other = { nodeType: 1, localName: 'button', isConnected: true };
  vueSourceDirective.mounted(other, { value: conflict });
  expect(resolveElementSource(node)).toMatchObject({ status: 'UNKNOWN', reason: 'STALE_SOURCE' });
  vueSourceDirective.beforeUnmount(node);
  vueSourceDirective.beforeUnmount(other);
});
