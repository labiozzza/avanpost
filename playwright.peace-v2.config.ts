import { defineConfig, devices } from '@playwright/test';

const bindHost = process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1';
const clientPort = Number(process.env.AVANPOST_V2_TEST_CLIENT_PORT ?? '14174');
const loopbackClientPort = Number(process.env.AVANPOST_V2_TEST_LOOPBACK_CLIENT_PORT ?? '14175');
const baseHost = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? 'localhost' : bindHost;
const basePort = process.env.AVANPOST_V2_ENABLE_LAN === 'true' ? loopbackClientPort : clientPort;

export default defineConfig({
  globalTeardown: './apps/client-v2/e2e/global-teardown.ts',
  testDir: 'apps/client-v2/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://${baseHost}:${basePort}`,
    trace: 'off'
  },
  projects: [
    { name: 'peace-v2-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'peace-v2-mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'npm run db:peace:v2:up && AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2 && npm run db:peace:v2:test:migrate && npm run reset:peace:v2:test-world && AVANPOST_V2_DATABASE_OPERATION=test npm run dev:peace:v2',
    url: `http://${baseHost}:${basePort}/`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
