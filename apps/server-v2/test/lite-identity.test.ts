import { describe, expect, it } from 'vitest';
import { createLiteGuest, hashLiteSecret, resolveLiteSession, type LiteIdentityDatabase } from '../src/lite-identity.js';

function memoryDatabase(): LiteIdentityDatabase & { statements: Array<{ sql: string; values?: unknown[] }> } {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  return {
    statements,
    async query<T>(sql: string, values?: unknown[]) {
      statements.push({ sql, values });
      return { rows: [] as T[], rowCount: 1 };
    }
  };
}

describe('Peace Lite guest identity', () => {
  it('atomically provisions a distinct account and world while persisting only a hash of the session token', async () => {
    const database = memoryDatabase();
    const guest = await createLiteGuest(database, new Date('2026-11-07T12:00:00.000Z'));

    expect(guest.role).toBe('owner');
    expect(guest.accountId).not.toBe(guest.worldId);
    expect(guest.world.worldSeed).toBe(guest.worldId);
    expect(guest.token).toMatch(/^[a-f0-9]{64}$/);
    const sessionInsert = database.statements.find(({ sql }) => sql.includes('INSERT INTO peace_v2_lite_sessions'))!;
    expect(sessionInsert.values?.[0]).toBe(hashLiteSecret(guest.token));
    expect(sessionInsert.values?.[0]).not.toBe(guest.token);
    expect(database.statements.map(({ sql }) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO peace_v2_lite_accounts'),
      expect.stringContaining('INSERT INTO peace_v2_lite_worlds'),
      expect.stringContaining('INSERT INTO peace_v2_lite_world_memberships'),
      expect.stringContaining('INSERT INTO peace_v2_world_state'),
      expect.stringContaining('INSERT INTO peace_v2_lite_sessions'),
      'COMMIT'
    ]);
  });

  it('rolls back the entire provision when any insert fails', async () => {
    const statements: string[] = [];
    const database: LiteIdentityDatabase = {
      async query<T>(sql: string) {
        statements.push(sql);
        if (sql.includes('INSERT INTO peace_v2_lite_worlds')) throw new Error('world insert failed');
        return { rows: [] as T[], rowCount: 1 };
      }
    };

    await expect(createLiteGuest(database)).rejects.toThrow('world insert failed');
    expect(statements.at(-1)).toBe('ROLLBACK');
  });

  it('resolves an active cookie token to its current membership and rejects malformed tokens', async () => {
    const guest = await createLiteGuest(memoryDatabase());
    let queriedHash: unknown;
    const database: LiteIdentityDatabase = {
      async query<T>(_sql: string, values?: unknown[]) {
        queriedHash = values?.[0];
        return { rows: [{ accountId: guest.accountId, worldId: guest.worldId, role: 'owner' }] as T[], rowCount: 1 };
      }
    };

    await expect(resolveLiteSession(database, guest.token)).resolves.toEqual({
      accountId: guest.accountId, worldId: guest.worldId, role: 'owner'
    });
    expect(queriedHash).toBe(hashLiteSecret(guest.token));
    await expect(resolveLiteSession(database, 'not-a-token')).resolves.toBeNull();
  });
});
