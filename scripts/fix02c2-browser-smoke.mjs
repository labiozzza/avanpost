import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = process.env.PEACE_V2_FIX02C2_URL ?? 'http://127.0.0.1:14255/';
const outputDir = process.env.FIX02C2_SMOKE_OUTPUT ?? 'test-results/fix02c2/browser-diagnostics';
const screenshotPath = path.join(outputDir, 'minimal-smoke.png');
const reportPath = path.join(outputDir, 'minimal-smoke.json');
const report = {
  startedAt: new Date().toISOString(),
  playwright: '1.64.1',
  executablePath: chromium.executablePath(),
  headless: true,
  stages: []
};
let browser;

try {
  report.stages.push({ stage: 'launch', startedAt: new Date().toISOString() });
  browser = await chromium.launch({ headless: true, timeout: 15_000 });
  report.stages.at(-1).result = 'PASS';

  report.stages.push({ stage: 'newPage', startedAt: new Date().toISOString() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  report.stages.at(-1).result = 'PASS';

  report.stages.push({ stage: 'goto', url: baseURL, startedAt: new Date().toISOString() });
  const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  report.stages.at(-1).result = { status: response?.status(), title: await page.title() };
  if (!response?.ok()) throw new Error(`Client returned HTTP ${response?.status() ?? 'no response'}`);

  await mkdir(outputDir, { recursive: true });
  report.stages.push({ stage: 'screenshot', startedAt: new Date().toISOString() });
  await page.screenshot({ path: screenshotPath, timeout: 10_000 });
  report.stages.at(-1).result = 'PASS';
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = { name: error?.name, message: error?.message, stack: error?.stack };
  if (report.stages.length) report.stages.at(-1).result = 'FAIL';
  process.exitCode = 1;
} finally {
  if (browser) {
    report.stages.push({ stage: 'close', startedAt: new Date().toISOString() });
    try {
      await browser.close();
      report.stages.at(-1).result = 'PASS';
    } catch (error) {
      report.stages.at(-1).result = { error: String(error) };
      report.result = 'FAIL';
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(outputDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
