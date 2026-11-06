import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'fix02c2c-recovery.spec.ts',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/fix02c2c/playwright',
  use: {
    baseURL: process.env.PEACE_V2_FIX02C2C_URL ?? 'http://127.0.0.1:14286',
    trace: 'on', video: 'on', screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'fix02c2c-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'fix02c2c-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }
  ]
});
