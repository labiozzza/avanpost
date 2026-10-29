import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';
import { V2DatabaseError } from '../database/identity.js';

loadV2Env();

try {
  if (process.env.AVANPOST_V2_DATABASE_OPERATION !== 'manual' || process.env.NODE_ENV === 'production') {
    throw new Error('V2_MANUAL_DATABASE_CREATE_BLOCKED: explicit non-production manual operation is required.');
  }
  const config = loadV2Config();
  if (config.database.development.databaseName !== 'avanpost_v2_dev' ||
      config.database.manual.databaseName !== 'avanpost_v2_manual' ||
      config.database.development.mode !== config.database.manual.mode) {
    throw new Error('V2_MANUAL_DATABASE_CREATE_BLOCKED: verified local V2 dev/manual identities are required.');
  }

  const development = await connectVerifiedV2Database(config, 'development');
  let created = false;
  try {
    const existing = await development.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [config.database.manual.databaseName]
    );
    if (!existing.rows[0]?.exists) {
      try {
        await development.query('CREATE DATABASE avanpost_v2_manual');
        created = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== '42P04') throw error;
      }
    }
  } finally {
    await development.end();
  }

  const manual = await connectVerifiedV2Database(config, 'manual');
  try {
    const identity = await manual.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (identity.rows[0]?.database_name !== 'avanpost_v2_manual') {
      throw new Error('V2_MANUAL_DATABASE_CREATE_BLOCKED: actual manual database identity did not match.');
    }
  } finally {
    await manual.end();
  }
  console.log(JSON.stringify({ status: created ? 'created' : 'exists', environment: 'manual', database: 'avanpost_v2_manual' }));
} catch (error) {
  const code = error instanceof V2DatabaseError ? error.code
    : error instanceof Error && error.message.startsWith('V2_') ? error.message.split(':', 1)[0]
      : 'V2_MANUAL_DATABASE_CREATE_BLOCKED';
  console.error(JSON.stringify({ status: 'blocked', code }));
  process.exitCode = 1;
}
