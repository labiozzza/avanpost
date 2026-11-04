import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';

const DATABASE = 'avanpost_v2_g7_1_acceptance';
loadV2Env();

try {
  if (process.env.NODE_ENV === 'production' || process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test') {
    throw new Error('V2_ACCEPTANCE_DATABASE_BLOCKED: creation requires the isolated test operation.');
  }
  const config = loadV2Config();
  const client = await connectVerifiedV2Database(config, 'test');
  try {
    const ownerResult = await client.query<{ current_user: string }>('SELECT current_user');
    const owner = ownerResult.rows[0]?.current_user;
    if (!owner) throw new Error('V2_ACCEPTANCE_DATABASE_BLOCKED: test database owner could not be verified.');
    const exists = await client.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [DATABASE]);
    if (exists.rows[0]?.exists) throw new Error('V2_ACCEPTANCE_DATABASE_EXISTS: refusing to replace an existing database.');
    await client.query(`CREATE DATABASE ${DATABASE} OWNER "${owner.replaceAll('"', '""')}"`);
    console.log(JSON.stringify({ status: 'created', source: config.database.test.databaseName, database: DATABASE }));
  } finally {
    await client.end();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Acceptance database creation was blocked safely.';
  console.error(JSON.stringify({ status: 'blocked', code: message.split(':', 1)[0] }));
  process.exitCode = 1;
}
