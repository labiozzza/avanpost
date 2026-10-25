import { Client } from 'pg';
import type { V2Config } from '../config.js';
import {
  validateDatabaseUrl,
  verifyConnectedDatabaseIdentity,
  type DatabaseOperation
} from './identity.js';

export async function connectVerifiedV2Database(
  config: V2Config,
  operation: DatabaseOperation
): Promise<Client> {
  const configuredTarget = operation === 'test' ? config.database.test : config.database.development;
  const rawUrl = operation === 'test' ? config.database.testUrl : config.database.developmentUrl;
  const target = validateDatabaseUrl(rawUrl, operation, {
    AVANPOST_V2_COMPOSE: configuredTarget.mode === 'compose' ? '1' : undefined
  });
  const client = new Client({ connectionString: rawUrl });
  await client.connect();

  try {
    const socket = client.connection.stream as typeof client.connection.stream & {
      remoteAddress?: string;
    };
    const peerAddress = socket.remoteAddress;
    await verifyConnectedDatabaseIdentity(client, target, peerAddress);
    return client;
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
}
