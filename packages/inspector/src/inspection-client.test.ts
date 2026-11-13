import { expect, it, vi } from 'vitest';
import { inspectorUpdateSchema, type InspectorUpdate } from '@devanalyst/core';
import { createInspectionClient, isInspectorUpdate } from './inspection-client.js';
import { glossaryTranslation } from './glossary.js';
import type { ElementMetadata } from './metadata.js';

const source = { file: 'src/App.tsx', start: { line: 1, column: 1 }, end: { line: 1, column: 20 } };
const metadata: ElementMetadata = {
  tag: 'button',
  namespace: null,
  attributes: {},
  text: '保存',
  japaneseText: ['保存'],
  accessibleLabel: '保存',
  labelSource: 'visible text',
  childCount: 0,
  context: 'document',
  truncated: false,
  redacted: false,
  observedAt: new Date().toISOString(),
  sourceStatus: 'VERIFIED',
  source,
  cache: 'none',
  mapping: {
    status: 'VERIFIED',
    source,
    component: null,
    elementId: 'a'.repeat(64),
    revision: 'b'.repeat(64),
    runtimeId: 'node-1',
    strategy: 'compile-time-ref-v1',
    observedAt: new Date().toISOString(),
    cache: 'none',
  },
};
function fixture() {
  const send = vi.fn<(type: 'inspector.request' | 'inspector.cancel', payload: unknown) => boolean>(
      () => true,
    ),
    changed = vi.fn();
  const client = createInspectionClient({
    send,
    changed,
    route: () => ({ pathname: '/orders' }),
    pageId: () => crypto.randomUUID(),
  });
  client.inspect(metadata, true);
  const snapshot = client.getSnapshot();
  if (!snapshot) throw new Error('Missing selection');
  const update: InspectorUpdate = {
    requestId: snapshot.requestId,
    elementId: snapshot.elementId,
    revision: snapshot.revision,
    lane: 'translation',
    state: 'READY',
    cache: 'fresh',
    completion: 'complete',
    error: null,
    reset: true,
    limited: false,
    observedAt: new Date().toISOString(),
    items: [
      {
        id: crypto.randomUUID(),
        group: 'translation',
        title: 'Tiếng Việt',
        description: 'Lưu',
        confidence: 'INFERRED',
        evidence: { source, code: '<button>保存</button>' },
        trace: [],
        analyzedAt: new Date().toISOString(),
        cacheStatus: 'fresh',
      },
    ],
  };
  return { client, send, changed, update };
}
it('sends only a source identity and digest and excludes private controls', async () => {
  const { client, send } = fixture();
  await vi.waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      'inspector.request',
      expect.objectContaining({
        textDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        mode: 'expanded',
      }),
    ),
  );
  expect(JSON.stringify(send.mock.calls)).not.toContain('保存');
  send.mockClear();
  client.inspect({ ...metadata, redacted: true, text: 'PRIVATE_VALUE' }, true);
  await Promise.resolve();
  expect(send.mock.calls.every((call) => call[0] !== 'inspector.request')).toBe(true);
  expect(client.getSnapshot()).toBeNull();
  client.stop();
});
it('rejects malformed confidence and late messages after invalidation or a new selection', () => {
  const { client, update } = fixture();
  expect(inspectorUpdateSchema.safeParse(update).success).toBe(true);
  expect(isInspectorUpdate(update)).toBe(true);
  expect(isInspectorUpdate({ ...update, items: [{ ...update.items[0], evidence: null }] })).toBe(
    false,
  );
  expect(
    isInspectorUpdate({ ...update, items: [{ ...update.items[0], cacheStatus: 'stale' }] }),
  ).toBe(false);
  expect(client.accept(update)).toBe(true);
  client.invalidate();
  expect(client.getSnapshot()?.translation).toMatchObject({
    state: 'STALE',
    items: [{ confidence: 'UNKNOWN', cacheStatus: 'stale' }],
  });
  client.accept(update);
  expect(client.getSnapshot()?.translation.state).toBe('STALE');
  client.inspect({ ...metadata, text: '削除' }, true);
  client.accept(update);
  expect(client.getSnapshot()?.translation.items).toEqual([]);
  client.stop();
});
it('preserves bounded partial chunks and marks reused session results stale until checked', () => {
  const { client, update } = fixture();
  client.accept(update);
  const first = update.items[0];
  if (!first) throw new Error('Missing item');
  client.accept({
    ...update,
    reset: false,
    items: [{ ...first, id: crypto.randomUUID(), description: 'second' }],
  });
  expect(client.getSnapshot()?.translation.items).toHaveLength(2);
  client.cancel();
  client.inspect(metadata, true);
  expect(client.getSnapshot()?.translation).toMatchObject({ cache: 'stale', state: 'STALE' });
  expect(
    client.getSnapshot()?.translation.items.every((item) => item.confidence === 'UNKNOWN'),
  ).toBe(true);
  client.stop();
});
it('uses only exact local glossary candidates', () => {
  expect(glossaryTranslation(' 保存 ')).toBe('Lưu');
  expect(glossaryTranslation('注文を保存すると何が起こる')).toBeNull();
  expect(glossaryTranslation('toString')).toBeNull();
});
