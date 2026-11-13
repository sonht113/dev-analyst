import { expect, it } from 'vitest';
import { analysisStateSchema, pageElementSchema, pageProgressSchema } from './preanalysis.js';
import { clientEventSchema } from './events.js';
const element = {
  elementId: 'a'.repeat(64),
  file: 'src/App.tsx',
  revision: 'b'.repeat(64),
  tag: 'button',
  kind: 'button',
};
it('validates structural page messages and rejects arbitrary source requests or private DOM fields', () => {
  expect(pageElementSchema.safeParse(element).success).toBe(true);
  for (const extra of [
    { text: 'private' },
    { value: 'password' },
    { source: 'guessed' },
    { href: '/private' },
    { file: '../../secret.ts' },
    { revision: 'fake' },
  ])
    expect(pageElementSchema.safeParse({ ...element, ...extra }).success).toBe(false);
  expect(
    clientEventSchema.safeParse({
      version: 1,
      id: '00000000-0000-4000-8000-000000000001',
      timestamp: new Date().toISOString(),
      type: 'page.index',
      payload: {
        requestId: '00000000-0000-4000-8000-000000000002',
        route: { pathname: '/orders/123' },
        elements: Array.from({ length: 9 }, () => element),
        limited: false,
      },
    }).success,
  ).toBe(false);
});
it('requires the six explicit states and bounded consistent progress', () => {
  expect(analysisStateSchema.options).toEqual([
    'NOT_ANALYZED',
    'QUEUED',
    'ANALYZING',
    'READY',
    'STALE',
    'FAILED',
  ]);
  expect(
    pageProgressSchema.safeParse({
      requestId: '00000000-0000-4000-8000-000000000001',
      items: [],
      total: 1,
      completed: 2,
      limited: false,
    }).success,
  ).toBe(false);
});
