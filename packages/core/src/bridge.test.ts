import { describe, expect, it } from 'vitest';
import { bridgeOptionsSchema, bridgeBootstrapSchema } from './index.js';

describe('local bridge contracts', () => {
  it('defaults to ephemeral IPv4 loopback binding and bounded resources', () => {
    expect(bridgeOptionsSchema.parse({})).toMatchObject({
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      maxConnections: 32,
      reconnectAttempts: 12,
    });
  });

  it.each([
    { host: '0.0.0.0' },
    { port: -1 },
    { port: 65536 },
    { maxMessageBytes: 100_000 },
    { maxConnections: 0 },
    { reconnectAttempts: 100 },
  ])('rejects unsafe bridge settings: %j', (settings) => {
    expect(bridgeOptionsSchema.safeParse(settings).success).toBe(false);
  });

  it.each([
    'not-a-url',
    'ws://127.0.0.1:65536/__devanalyst/ws',
    'ws://untrusted.example:1234/__devanalyst/ws',
    'ws://127.0.0.1:1234/arbitrary',
    'ws://127.0.0.1:1234/__devanalyst/ws?token=secret',
    'ws://user:secret@127.0.0.1:1234/__devanalyst/ws',
  ])('rejects non-local or credential-bearing bootstrap endpoints: %s', (endpoint) => {
    expect(
      bridgeBootstrapSchema.safeParse({
        version: 1,
        endpoint,
        token: 'a'.repeat(64),
        reconnectAttempts: 12,
      }).success,
    ).toBe(false);
  });
});
