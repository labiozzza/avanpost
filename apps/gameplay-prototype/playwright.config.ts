import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR
  ? resolve(process.env.PLAYWRIGHT_OUTPUT_DIR)
  : 'test-results';
const reportDir = process.env.PLAYWRIGHT_REPORT_DIR
  ? resolve(process.env.PLAYWRIGHT_REPORT_DIR)
  : 'playwright-report';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 8 * 60 * 1000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: reportDir, open: 'never' }]
  ],
  outputDir,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4176',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  }
});
