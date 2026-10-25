import { createServer } from 'node:net';
import { statfs } from 'node:fs/promises';

export function assertSupportedNode(version: string): void {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(major) || major < 22) {
    throw new Error('V2_NODE_VERSION_UNSUPPORTED: V2 development requires Node.js 22 or newer.');
  }
}

export async function assertLoopbackPortAvailable(port: number, host = '127.0.0.1'): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error(`V2_PORT_IN_USE: V2 bind ${host}:${port} is not available.`)));
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

export async function getAvailableDiskBytes(projectRoot: string): Promise<number> {
  let stats;
  try {
    stats = await statfs(projectRoot);
  } catch {
    throw new Error('V2_DISK_SPACE_UNAVAILABLE: local project storage could not be checked.');
  }
  const bytes = stats.bavail * stats.bsize;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('V2_DISK_SPACE_UNAVAILABLE: no free local project storage is available.');
  }
  return bytes;
}
