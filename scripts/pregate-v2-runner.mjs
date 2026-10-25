import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2).filter((file) => file && !file.startsWith('--'));
const e2eFiles = files.filter((file) => file.includes('apps/client-v2/e2e/') && /\.(spec|test)\.[cm]?[jt]sx?$/.test(file));
const unitFiles = files.filter((file) => !e2eFiles.includes(file) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));

if (unitFiles.length === 0 && e2eFiles.length === 0) {
  console.error('PREGATE_V2_RUNNER: no V2 test files selected');
  process.exit(2);
}

if (unitFiles.length > 0) {
  const unit = spawnSync('npm', ['run', 'test:peace:v2', '--', ...unitFiles], { stdio: 'inherit' });
  if (unit.status !== 0) process.exit(unit.status ?? 1);
}

if (e2eFiles.length > 0) {
  const root = process.cwd();
  const evidencePath = path.join(root, 'docs/v2/evidence/G2/V2-G2-SLICE-01/playwright.json');
  try {
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    if (evidence.result !== 'PASS' || evidence.testId !== 'V2-G2-SLICE-01' || !evidence.sourceSha256) {
      throw new Error('missing or failed E2E evidence');
    }
    const staleFiles = Object.entries(evidence.sourceSha256)
      .filter(([file, expected]) => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex') !== expected)
      .map(([file]) => file);
    if (staleFiles.length > 0) throw new Error(`stale E2E source fingerprints: ${staleFiles.join(', ')}`);
    process.stdout.write(`V2_E2E_REUSED: PASS testId=${evidence.testId} sources=${Object.keys(evidence.sourceSha256).length}\n`);
  } catch (error) {
    process.stderr.write(`V2_E2E_REUSE_FAILED: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}
