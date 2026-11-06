import { loadV2Env, loadV2Config } from '../config.js';
import { connectVerifiedV2Database } from '../database/connect.js';

const databaseNames = ['avanpost_v2_fix02c2b_test', 'avanpost_v2_fix02c2b_comp_test'] as const;
loadV2Env();

try {
  if (process.env.NODE_ENV === 'production' || process.env.AVANPOST_V2_DATABASE_OPERATION !== 'test') {
    throw new Error('FIX02C2B_DATABASE_BLOCKED: isolated test operation is required.');
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
    const existing = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = ANY($1::text[])', [databaseNames]
    );
    if (!owner || existing.rows.length > 0) {
      throw new Error('FIX02C2B_DATABASE_BLOCKED: owner missing or a target disposable database already exists.');
    }
    for (const name of databaseNames) {
      await client.query(`CREATE DATABASE ${name} OWNER "${owner.replaceAll('"', '""')}"`);
    }
    console.log(JSON.stringify({ status: 'created', source: 'avanpost_v2_test', databases: databaseNames }));
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', code: (error instanceof Error ? error.message : 'blocked').split(':', 1)[0] }));
  process.exitCode = 1;
}
