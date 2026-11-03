import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';

const ACCEPTANCE_DATABASE = 'avanpost_v2_g6_2_5_acceptance';

loadV2Env();

try {
  if (process.env.NODE_ENV === 'production' || process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test') {
    throw new Error('V2_ACCEPTANCE_DATABASE_BLOCKED: creation is allowed only from the isolated test operation.');
  }

  const config = loadV2Config();
  const testClient = await connectVerifiedV2Database(config, 'test');
  try {
    const role = await testClient.query<{ current_user: string }>('SELECT current_user');
    const owner = role.rows[0]?.current_user;
    if (!owner) throw new Error('V2_ACCEPTANCE_DATABASE_BLOCKED: could not verify the test connection owner.');
    const exists = await testClient.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [ACCEPTANCE_DATABASE]
    );
    if (exists.rows[0]?.exists) {
      throw new Error('V2_ACCEPTANCE_DATABASE_EXISTS: refusing to replace an existing acceptance database.');
    }
    const quotedOwner = `"${owner.replaceAll('"', '""')}"`;
    await testClient.query(`CREATE DATABASE ${ACCEPTANCE_DATABASE} OWNER ${quotedOwner}`);
    console.log(JSON.stringify({ status: 'created', source: config.database.test.databaseName, database: ACCEPTANCE_DATABASE }));
  } finally {
    await testClient.end();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Acceptance database creation was blocked safely.';
  console.error(JSON.stringify({ status: 'blocked', code: message.split(':', 1)[0] }));
  process.exitCode = 1;
}
