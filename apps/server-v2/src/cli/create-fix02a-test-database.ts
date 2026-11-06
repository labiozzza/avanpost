import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';

const databaseName = 'avanpost_v2_g7_2_fix02a_test';
loadV2Env();

try {
  if (process.env.NODE_ENV === 'production' || process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test') {
    throw new Error('FIX02A_DATABASE_BLOCKED: isolated test operation is required.');
  }
  const config = loadV2Config();
  const sourceUrl = new URL(config.database.testUrl);
  sourceUrl.pathname = '/avanpost_v2_test';
  const client = await connectVerifiedV2Database({ ...config,
    database: { ...config.database, test: { ...config.database.test, databaseName: 'avanpost_v2_test' },
      testUrl: sourceUrl.toString() }
  }, 'test');
  try {
    const owner = (await client.query<{ current_user: string }>('SELECT current_user')).rows[0]?.current_user;
    const exists = await client.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', [databaseName]
    );
    if (!owner || exists.rows[0]?.exists) throw new Error('FIX02A_DATABASE_BLOCKED: owner missing or disposable database already exists.');
    await client.query(`CREATE DATABASE ${databaseName} OWNER "${owner.replaceAll('"', '""')}"`);
    console.log(JSON.stringify({ status: 'created', source: 'avanpost_v2_test', database: databaseName }));
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', code: (error instanceof Error ? error.message : 'blocked').split(':', 1)[0] }));
  process.exitCode = 1;
}
