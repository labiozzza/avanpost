import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getV2ProjectRoot, loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { V2DatabaseError } from '../database/identity.js';

loadV2Env();

const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

try {
  const config = loadV2Config();
  const operation = process.env.AVANPOST_V2_DATABASE_OPERATION === 'test' ? 'test' : 'migration';
  const targetDatabase = operation === 'test' ? config.database.test : config.database.development;
  const client = await connectVerifiedV2Database(config, operation);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS peace_v2_schema_migrations (
        name text PRIMARY KEY,
        sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrationsPath = path.join(getV2ProjectRoot(), 'db/peace-v2/migrations');
    const names = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort();
    for (const name of names) {
      if (!MIGRATION_NAME.test(name)) {
        throw new Error(`V2_MIGRATION_NAME_INVALID: ${name}`);
      }

      const sql = await readFile(path.join(migrationsPath, name), 'utf8');
      const sha256 = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ sha256: string }>(
        'SELECT sha256 FROM peace_v2_schema_migrations WHERE name = $1',
        [name]
      );

      if (existing.rows[0]) {
        if (existing.rows[0].sha256 !== sha256) {
          throw new Error(`V2_MIGRATION_DRIFT: applied migration ${name} changed; no SQL was executed.`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO peace_v2_schema_migrations (name, sha256) VALUES ($1, $2)',
          [name, sha256]
        );
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`V2_MIGRATION_FAILED: ${name} failed; its transaction was rolled back.`);
      }
    }

    console.log(
      JSON.stringify({
        status: 'ready',
        database: targetDatabase.databaseName,
        migrations: names.length
      })
    );
  } finally {
    await client.end();
  }
} catch (error) {
  const code = error instanceof V2DatabaseError ? error.code : 'V2_MIGRATION_BLOCKED';
  const message = error instanceof Error ? error.message : 'V2 migration blocked safely.';
  console.error(JSON.stringify({ status: 'blocked', code, message }));
  process.exitCode = 1;
}
