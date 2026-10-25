import { defineConfig, devices } from '@playwright/test';

const bindHost = process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://${bindHost}:4174`,
    trace: 'off'
  },
  projects: [
    { name: 'peace-v2-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'peace-v2-mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'npm run db:peace:v2:up && npm run doctor:peace:v2 && npm run db:peace:v2:test:migrate && npm run reset:peace:v2:test-world && AVANPOST_V2_DATABASE_OPERATION=test npm run dev:peace:v2',
    url: `http://${bindHost}:4174/`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
