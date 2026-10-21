export const SIM_VERSION = '0.4.0';

export function advanceTick(tick: number, ticks: number): number {
  if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 60) {
    throw new Error('ticks must be an integer between 1 and 60');
  }
  return tick + ticks;
}
