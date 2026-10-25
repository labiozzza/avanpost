import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

describe('V2 repository contracts', () => {
  it.each([
    ['source map', 'scripts/check-peace-v2-source-map.mjs', 'SOURCE_MAP_CHECK: PASS_STRUCTURE'],
    ['API contracts', 'scripts/check-peace-v2-contracts.mjs', 'CONTRACT_CHECK: PASS'],
    ['live status', 'scripts/check-peace-v2-status.mjs', 'STATUS_CHECK: PASS']
  ])('validates the %s contract', (_name, script, passMarker) => {
    const output = execFileSync(process.execPath, [script], {
      cwd: projectRoot,
      encoding: 'utf8'
    });
    expect(output.includes(passMarker)).toBe(true);
  });

  it('keeps the documented V2-only verification commands wired in the root manifest', () => {
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(Boolean(manifest.scripts?.['test:peace:v2'])).toBe(true);
    expect(Boolean(manifest.scripts?.['build:peace:v2'])).toBe(true);
    expect(Boolean(manifest.scripts?.['e2e:peace:v2'])).toBe(true);
  });

  it('routes unit files and reuses only source-matched V2 browser evidence', () => {
    const runner = readFileSync(path.join(projectRoot, 'scripts/pregate-v2-runner.mjs'), 'utf8');
    expect(runner.includes('test:peace:v2')).toBe(true);
    expect(runner.includes('V2_E2E_REUSED')).toBe(true);
    expect(runner.includes('sourceSha256')).toBe(true);
  });
});
