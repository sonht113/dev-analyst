import { describe, expect, it } from 'vitest';
import { clientEventSchema, PROTOCOL_VERSION, serverEventSchema } from './events.js';

const envelope = {
  version: PROTOCOL_VERSION,
  id: 'e29c1083-16a7-4c3c-b3e9-4ab81b5477e5',
  timestamp: '2026-11-12T04:00:00.000Z',
};

describe('event contracts', () => {
  it('validates a route event', () => {
    const event = { ...envelope, type: 'route.changed', payload: { pathname: '/settings' } };
    expect(clientEventSchema.parse(event)).toEqual(event);
  });

  it.each(['/settings?token=secret', '/settings#secret', 'https://example.com', '/x\n'])(
    'rejects unsafe route metadata: %s',
    (pathname) => {
      expect(
        clientEventSchema.safeParse({ ...envelope, type: 'route.changed', payload: { pathname } })
          .success,
      ).toBe(false);
    },
  );

  it('rejects unsupported versions, unknown event kinds, and extra runtime payloads', () => {
    for (const event of [
      { ...envelope, version: 2, type: 'route.changed', payload: { pathname: '/' } },
      { ...envelope, type: 'shell.execute', payload: { command: 'anything' } },
      { ...envelope, type: 'route.changed', payload: { pathname: '/', password: 'secret' } },
    ])
      expect(clientEventSchema.safeParse(event).success).toBe(false);
  });

  it('accepts progress within its known total and rejects overstated progress', () => {
    const progress = {
      ...envelope,
      type: 'analysis.progress',
      payload: { requestId: envelope.id, completed: 1, total: 2 },
    };
    expect(serverEventSchema.safeParse(progress).success).toBe(true);
    expect(
      serverEventSchema.safeParse({ ...progress, payload: { ...progress.payload, completed: 3 } })
        .success,
    ).toBe(false);
  });

  it('supports structured recoverable errors without exposing internal stacks', () => {
    const event = {
      ...envelope,
      type: 'bridge.error',
      payload: {
        requestId: null,
        error: {
          code: 'AI_DISABLED',
          message: 'Enable AI and choose permitted paths.',
          recoverable: true,
        },
      },
    };
    expect(serverEventSchema.safeParse(event).success).toBe(true);
    expect(
      serverEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, error: { ...event.payload.error, stack: 'private' } },
      }).success,
    ).toBe(false);
  });
});
