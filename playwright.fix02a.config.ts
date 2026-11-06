import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'fix02a-builder-recovery.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PEACE_V2_FIX02A_URL ?? 'http://127.0.0.1:14224',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    trace: 'on',
    video: 'on'
  }
});
