import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'fix02b-building-geometry.spec.ts',
  timeout: 600_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.PEACE_V2_FIX02B_URL ?? 'http://127.0.0.1:14224', trace: 'on', video: 'on' },
  projects: [
    { name: 'geometry-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'geometry-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }
  ]
});
