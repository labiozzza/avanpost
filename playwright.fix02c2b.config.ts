import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'fix02c2b-warehouse-overflow.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/fix02c2b/playwright',
  use: { baseURL: process.env.PEACE_V2_FIX02C2B_URL ?? 'http://127.0.0.1:14265', trace: 'on', video: 'on', screenshot: 'only-on-failure' },
  projects: [
    { name: 'fix02c2b-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'fix02c2b-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }
  ]
});
