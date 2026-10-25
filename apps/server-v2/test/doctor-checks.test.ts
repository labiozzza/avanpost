import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  assertLoopbackPortAvailable,
  assertSupportedNode,
  getAvailableDiskBytes
} from '../src/cli/doctor-checks.js';

describe('V2 doctor preflight checks', () => {
  it('requires the declared Node runtime floor', () => {
    expect(() => assertSupportedNode('22.0.0')).not.toThrow();
    expect(() => assertSupportedNode('26.3.1')).not.toThrow();
    expect(() => assertSupportedNode('20.12.0')).toThrow('V2_NODE_VERSION_UNSUPPORTED');
  });

  it('rejects a loopback port already owned by another process', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port.');

    try {
      await expect(assertLoopbackPortAvailable(address.port)).rejects.toThrow('V2_PORT_IN_USE');
    } finally {
      await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reports available local disk space for the project volume', async () => {
    await expect(getAvailableDiskBytes(process.cwd())).resolves.toBeGreaterThan(0);
  });
});
