import { describe, expect, it } from 'vitest';
import { RUNTIME_DIAGNOSTICS_KEY, RuntimeDiagnostics, safeErrorFrames, safeErrorType } from './runtime-diagnostics.js';

describe('private runtime diagnostics', () => {
  it('keeps only a bounded allow-listed event ring without save or identity fields', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    const diagnostics = new RuntimeDiagnostics(storage);
    for (let index = 0; index < 40; index++) {
      diagnostics.record({ type: 'role-switch', roleBefore: 'hauler', roleAfter: 'builder',
        mode: 'carrying', requestStatus: 'in_progress', loopScheduled: true });
    }
    const raw = values.get(RUNTIME_DIAGNOSTICS_KEY)!;
    expect(JSON.parse(raw)).toHaveLength(32);
    expect(raw).not.toMatch(/resident|world|save|name|r1|cargoAmount/i);
    expect(diagnostics.snapshot().at(-1)).toMatchObject({ roleBefore: 'hauler', roleAfter: 'builder',
      mode: 'carrying', requestStatus: 'in_progress', loopScheduled: true });
  });

  it('never lets a blocked diagnostics store escape into the game', () => {
    const diagnostics = new RuntimeDiagnostics({ getItem: () => { throw new Error('private'); },
      setItem: () => { throw new Error('private'); } });
    expect(() => diagnostics.record({ type: 'simulation-step-error', errorType: 'TypeError' })).not.toThrow();
    expect(diagnostics.snapshot()).toHaveLength(2);
  });

  it('normalizes error classes and omits error messages', () => {
    const error = new TypeError('resident Ada has private save contents');
    Object.defineProperty(error, 'stack', { value: 'TypeError: resident Ada has private save contents\n' +
      '    at assign (https://private.example/assets/index.js?token=secret:12:34)\n' +
      '    at step (C:\\Users\\owner\\simulation.ts:56:7)' });
    expect(safeErrorType(error)).toBe('TypeError');
    expect(safeErrorFrames(error)).toEqual(['index.js:12:34', 'simulation.ts:56:7']);
    expect(safeErrorType({ name: 'CustomError', message: 'private' })).toBe('Error');
    expect(JSON.stringify(safeErrorFrames(error))).not.toMatch(/private|owner|secret|Ada|Users/i);
  });
});
