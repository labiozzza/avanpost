import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config';

const LOCK_KEY = 742031;

export function findMigrationsDir(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('db/migrations not found');
    dir = parent;
  }
}

export async function runMigrations(pool: pg.Pool, dir: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, 1)', [LOCK_KEY]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const appliedResult = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.name));
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    const executed: string[] = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        executed.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return executed;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, 1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  const config = loadConfig();
  const dir = process.env.MIGRATIONS_DIR ?? findMigrationsDir();
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  runMigrations(pool, dir)
    .then((executed) => {
      console.log(executed.length > 0 ? `applied: ${executed.join(', ')}` : 'already up to date');
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
