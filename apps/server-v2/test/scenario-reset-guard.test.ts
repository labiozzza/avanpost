import { describe, expect, it } from 'vitest';
import { assertScenarioResetAllowed } from '../src/testing/reset-guard.js';

describe('scenario reset protection', () => {
  it('allows only explicit isolated test/manual operations outside production', () => {
    expect(() => assertScenarioResetAllowed('test', 'development')).not.toThrow();
    expect(() => assertScenarioResetAllowed('manual', 'development')).not.toThrow();
  });

  it.each(['development', 'migration', undefined])('rejects %s operation before database access', (operation) => {
    expect(() => assertScenarioResetAllowed(operation, 'development'))
      .toThrow('V2_SCENARIO_RESET_BLOCKED');
  });

  it('rejects test or manual resets in production', () => {
    expect(() => assertScenarioResetAllowed('test', 'production')).toThrow('V2_SCENARIO_RESET_BLOCKED');
    expect(() => assertScenarioResetAllowed('manual', 'production')).toThrow('V2_SCENARIO_RESET_BLOCKED');
  });
});
