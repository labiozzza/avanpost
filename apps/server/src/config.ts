import { existsSync } from 'node:fs';
import path from 'node:path';

function loadEnvFile(start: string = process.cwd()): void {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // ignore malformed env files
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnvFile();

export interface Config {
  port: number;
  databaseUrl: string;
  appVersion: string;
  sessionDays: number;
  nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number.parseInt(env.PORT ?? '8787', 10),
    databaseUrl:
      env.DATABASE_URL ?? 'postgres://avanpost:avanpost@localhost:5433/avanpost',
    appVersion: env.APP_VERSION ?? '0.4.0',
    sessionDays: Number.parseInt(env.SESSION_DAYS ?? '30', 10),
    nodeEnv: env.NODE_ENV ?? 'development'
  };
}
