import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'fix02c1-warehouse.spec.ts',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/fix02c1',
  use: {
    baseURL: process.env.PEACE_V2_FIX02C1_URL ?? 'http://127.0.0.1:14245',
    trace: 'on', video: 'on', screenshot: 'only-on-failure'
  },
  projects: [{ name: 'warehouse-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }]
});
