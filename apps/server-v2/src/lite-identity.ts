import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createInitialPeaceWorld } from '@avanpost/peace-v2-sim';
import { PEACE_WORLD_SCHEMA_VERSION, type PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';

export interface LiteIdentityDatabase {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
}

export interface LiteSessionContext {
  accountId: string;
  worldId: string;
  role: 'owner' | 'editor' | 'viewer';
}

export interface CreatedLiteGuest extends LiteSessionContext {
  token: string;
  world: PeaceWorldSnapshot;
}

export const LITE_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export function hashLiteSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Creates account, private world, owner membership, world state, and session atomically. */
export async function createLiteGuest(database: LiteIdentityDatabase, now = new Date()): Promise<CreatedLiteGuest> {
  const accountId = randomUUID();
  const worldId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const world = createInitialPeaceWorld(worldId);
  const { revision, ...state } = world;
  const expiresAt = new Date(now.getTime() + LITE_SESSION_TTL_MS);

  await database.query('BEGIN');
  try {
    await database.query(
      "INSERT INTO peace_v2_lite_accounts (id, status) VALUES ($1, 'guest')",
      [accountId]
    );
    await database.query(
      `INSERT INTO peace_v2_lite_worlds (id, owner_account_id, seed, catalog_version, schema_version)
       VALUES ($1, $2, $3, 'peace-v2-g72-proposed-v1', $4)`,
      [worldId, accountId, world.worldSeed, PEACE_WORLD_SCHEMA_VERSION]
    );
    await database.query(
      "INSERT INTO peace_v2_lite_world_memberships (world_id, account_id, role) VALUES ($1, $2, 'owner')",
      [worldId, accountId]
    );
    await database.query(
      `INSERT INTO peace_v2_world_state
         (world_id, world_version, geometry_version, server_tick, last_simulated_at, state_schema_version, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [worldId, revision.worldVersion, revision.geometryVersion, revision.serverTick, now,
        PEACE_WORLD_SCHEMA_VERSION, JSON.stringify(state)]
    );
    await database.query(
      `INSERT INTO peace_v2_lite_sessions (token_hash, account_id, expires_at, current_world_id)
       VALUES ($1, $2, $3, $4)`,
      [hashLiteSecret(token), accountId, expiresAt, worldId]
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    throw error;
  }

  return { accountId, worldId, role: 'owner', token, world };
}

export async function resolveLiteSession(
  database: LiteIdentityDatabase,
  token: string,
  now = new Date()
): Promise<LiteSessionContext | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await database.query<LiteSessionContext>(
    `WITH active_session AS (
       UPDATE peace_v2_lite_sessions
          SET last_seen_at = $2
        WHERE token_hash = $1 AND expires_at > $2 AND revoked_at IS NULL
        RETURNING account_id, current_world_id
     )
     SELECT session.account_id AS "accountId", world.id AS "worldId", membership.role AS role
       FROM active_session AS session
       JOIN peace_v2_lite_world_memberships AS membership
         ON membership.account_id = session.account_id AND membership.revoked_at IS NULL
       JOIN peace_v2_lite_worlds AS world
         ON world.id = membership.world_id AND world.status = 'active'
       JOIN peace_v2_lite_accounts AS account
         ON account.id = session.account_id AND account.status <> 'disabled'
      WHERE membership.world_id = session.current_world_id OR membership.role = 'owner'
      ORDER BY (membership.world_id = session.current_world_id) DESC, (membership.role = 'owner') DESC, world.created_at ASC
      LIMIT 1`,
    [hashLiteSecret(token), now]
  );
  const context = result.rows[0];
  if (!context || !['owner', 'editor', 'viewer'].includes(context.role)) return null;
  return context;
}
