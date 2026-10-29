export type ScenarioResetOperation = 'test' | 'manual';

export function assertScenarioResetAllowed(
  operation: string | undefined,
  nodeEnv: string | undefined
): asserts operation is ScenarioResetOperation {
  if (nodeEnv === 'production') {
    throw new Error('V2_SCENARIO_RESET_BLOCKED: scenario resets are disabled in production.');
  }
  if (operation !== 'test' && operation !== 'manual') {
    throw new Error('V2_SCENARIO_RESET_BLOCKED: only isolated test or manual databases may be reset.');
  }
}
