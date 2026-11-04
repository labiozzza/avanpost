import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PEACE_V2_G72_ACCEPTANCE_URL ?? 'http://127.0.0.1:14204';

export default defineConfig({
  testDir: 'apps/client-v2/e2e',
  testMatch: 'g72-schools-acceptance.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'on', video: 'on' },
  projects: [
    { name: 'g72-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'g72-mobile-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'g72-mobile-360', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } }
  ]
});
