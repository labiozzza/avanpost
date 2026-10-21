import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db';

const config = loadConfig();
const { db } = createDatabase(config.databaseUrl);
const app = await buildApp({ db, config });

async function shutdown(): Promise<void> {
  await app.close();
  await db.destroy();
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`avanpost server listening on :${config.port} (build ${config.appVersion})`);
