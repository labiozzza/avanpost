import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '../../..');

describe('V2 starter onboarding', () => {
  it('keeps the starter archive aligned with the documented project entry points', () => {
    const archive = path.join(projectRoot, 'AVANPOST_V2_OPENCODE_STARTER.zip');
    const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n');
    expect(entries.includes('AVANPOST_V2_MASTER_SPEC.md')).toBe(true);
    expect(entries.includes('.opencode/commands/avanpost-v2.md')).toBe(true);
    expect(entries.includes('START_HERE.txt')).toBe(true);
  });

  it('points the project command at resumable V2 status and preserves the V1 boundary', () => {
    const command = readFileSync(path.join(projectRoot, '.opencode/commands/avanpost-v2.md'), 'utf8');
    const startHere = readFileSync(path.join(projectRoot, 'START_HERE.txt'), 'utf8');
    expect(command.includes('docs/v2/STATUS.md')).toBe(true);
    expect(command.includes('docs/v2/NEXT_ACTION.md')).toBe(true);
    expect(command.includes('Не делать reset/force push/merge/deploy в production')).toBe(true);
    expect(startHere.includes('OpenCode')).toBe(true);
    expect(startHere.includes('НЕ распаковывай')).toBe(true);
  });
});
