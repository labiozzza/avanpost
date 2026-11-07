import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/peace-v2/migrations/0016_lite_multiplayer_identity.sql'
);
const currentWorldMigrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/peace-v2/migrations/0017_lite_current_world.sql'
);
const commandIdMigrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/peace-v2/migrations/0018_lite_command_request_id_text.sql'
);
const authRateLimitMigrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../db/peace-v2/migrations/0019_lite_auth_rate_limit.sql'
);

describe('Peace Lite multiworld identity migration', () => {
  it('adds the identity, world, membership, invitation, and scoped-command tables without rewriting V2 state', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    for (const table of [
      'peace_v2_lite_accounts',
      'peace_v2_lite_worlds',
      'peace_v2_lite_world_memberships',
      'peace_v2_lite_sessions',
      'peace_v2_lite_email_identities',
      'peace_v2_lite_auth_links',
      'peace_v2_lite_invites',
      'peace_v2_lite_world_commands',
      'peace_v2_lite_world_tick_leases'
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }

    expect(sql).toContain("CHECK (status IN ('guest', 'linked', 'disabled'))");
    expect(sql).toContain("CHECK (role IN ('owner', 'editor', 'viewer'))");
    expect(sql).toContain('PRIMARY KEY (world_id, request_id)');
    expect(sql).toContain('token_hash char(64) PRIMARY KEY');
    expect(sql).toContain('normalized_email text NOT NULL UNIQUE');
    expect(sql).toContain('peace_v2_lite_one_active_owner_per_world');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|\w+)/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM)\s+peace_v2_(?:world_state|sessions|command_log)\b/i);
  });

  it('adds a session-scoped active world without changing legacy session or world rows', async () => {
    const sql = await readFile(currentWorldMigrationPath, 'utf8');
    expect(sql).toContain('ADD COLUMN current_world_id uuid REFERENCES peace_v2_lite_worlds(id)');
    expect(sql).toContain('CREATE INDEX peace_v2_lite_sessions_current_world_idx');
    expect(sql).toContain("memberships.role = 'owner'");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|\w+)/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM)\s+peace_v2_(?:world_state|sessions|command_log)\b/i);
  });

  it('keeps per-world command IDs compatible with the public string request-ID contract', async () => {
    const sql = await readFile(commandIdMigrationPath, 'utf8');
    expect(sql).toContain('ALTER COLUMN request_id TYPE text USING request_id::text');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|\w+)/i);
  });

  it('adds hashed-subject auth rate limiting and link lookup indexes without storing raw email attempts', async () => {
    const sql = await readFile(authRateLimitMigrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE peace_v2_lite_auth_attempts');
    expect(sql).toContain('subject_hash char(64) PRIMARY KEY');
    expect(sql).toContain('CREATE INDEX peace_v2_lite_auth_links_account_idx');
    expect(sql).not.toContain('email text');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\s+(?:TABLE|\w+)/i);
  });
});
