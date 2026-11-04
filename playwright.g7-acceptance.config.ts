import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PEACE_V2_G7_ACCEPTANCE_URL ?? 'http://127.0.0.1:14194';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'g7-population-acceptance.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'off' },
  projects: [
    { name: 'g7-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'g7-mobile', use: { ...devices['Pixel 7'] } }
  ]
});
