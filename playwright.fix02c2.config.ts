import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'fix02c2-ui-smoke.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/fix02c2/playwright',
  use: {
    baseURL: process.env.PEACE_V2_FIX02C2_URL ?? 'http://127.0.0.1:14255',
    trace: 'on', video: 'on', screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'fix02c2-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'fix02c2-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }
  ]
});
