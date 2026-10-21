import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema';

export interface DatabaseHandle {
  db: Kysely<DB>;
  pool: pg.Pool;
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool })
  });
  return { db, pool };
}
