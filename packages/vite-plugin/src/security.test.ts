import { expect, it } from 'vitest';
import { isLoopbackPeer } from './bridge.js';

it.each(['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'])(
  'accepts a kernel loopback peer: %s',
  (address) => {
    expect(isLoopbackPeer(address)).toBe(true);
  },
);

it.each([undefined, '192.168.0.1', '8.8.8.8', '::ffff:192.168.1.1', 'localhost', '127.invalid'])(
  'rejects remote or invalid peer addresses: %s',
  (address) => {
    expect(isLoopbackPeer(address)).toBe(false);
  },
);
