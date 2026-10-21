import { levelFor } from '@avanpost/sim';
import type { OutboxEvent } from './commands';
import type { WorldRun } from './run';

/**
 * D1=A: earned XP belongs to the person. Real work is performed by a laborer
 * (a body in the world); that laborer is bound to a resident via
 * `laborer.resident_id`. When work completes we credit the bound resident.
 *
 * Returns the granted amount and, if a level was reached, the new level.
 */
export function awardLaborerXp(
  run: WorldRun,
  laborerId: string | null,
  amount: number,
  reason: string,
  levelThresholds: readonly number[]
): OutboxEvent[] {
  if (!laborerId || amount <= 0) return [];

  const laborer = run.laborers.find((row) => row.id === laborerId);
  if (!laborer?.resident_id) return [];

  return awardResidentXp(
    run,
    laborer.resident_id,
    amount,
    reason,
    levelThresholds
  );
}

/** Credit a specific resident and emit a `ResidentXpGained` event on level-up. */
export function awardResidentXp(
  run: WorldRun,
  residentId: string,
  amount: number,
  reason: string,
  levelThresholds: readonly number[]
): OutboxEvent[] {
  if (amount <= 0) return [];

  const resident = run.residents.find((row) => row.id === residentId);
  if (!resident) return [];

  const before = levelFor(resident.xp, { levelThresholds });
  const after = levelFor(resident.xp + amount, { levelThresholds });
  resident.xp += amount;

  return [
    {
      type: 'ResidentXpGained',
      payload: {
        residentId: resident.id,
        amount,
        xp: resident.xp,
        reason,
        level: after,
        leveledUp: after > before
      }
    }
  ];
}
