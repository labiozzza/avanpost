import { levelFor } from '@avanpost/sim';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema';
import type { OutboxEvent } from './commands';

type Queryable = Kysely<DB> | Transaction<DB>;

/**
 * D1=A: earned XP belongs to the person. Real work is performed by a laborer
 * (a body in the world); that laborer is bound to a resident via
 * `laborer.resident_id`. When work completes we credit the bound resident.
 *
 * Returns the granted amount and, if a level was reached, the new level.
 */
export async function awardLaborerXp(
  queryable: Queryable,
  ownerId: string,
  laborerId: string | null,
  amount: number,
  reason: string,
  levelThresholds: readonly number[]
): Promise<OutboxEvent[]> {
  if (!laborerId || amount <= 0) return [];

  const laborer = await queryable
    .selectFrom('laborer')
    .select(['resident_id'])
    .where('id', '=', laborerId)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!laborer?.resident_id) return [];

  return awardResidentXp(
    queryable,
    ownerId,
    laborer.resident_id,
    amount,
    reason,
    levelThresholds
  );
}

/** Credit a specific resident and emit a `ResidentXpGained` event on level-up. */
export async function awardResidentXp(
  queryable: Queryable,
  ownerId: string,
  residentId: string,
  amount: number,
  reason: string,
  levelThresholds: readonly number[]
): Promise<OutboxEvent[]> {
  if (amount <= 0) return [];

  const resident = await queryable
    .selectFrom('resident')
    .select(['id', 'xp'])
    .where('id', '=', residentId)
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  if (!resident) return [];

  const before = levelFor(resident.xp, { levelThresholds });
  const after = levelFor(resident.xp + amount, { levelThresholds });

  await queryable
    .updateTable('resident')
    .set({ xp: resident.xp + amount })
    .where('id', '=', resident.id)
    .execute();

  return [
    {
      type: 'ResidentXpGained',
      payload: {
        residentId: resident.id,
        amount,
        xp: resident.xp + amount,
        reason,
        level: after,
        leveledUp: after > before
      }
    }
  ];
}
