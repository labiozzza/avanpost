import type { Kysely, Transaction } from 'kysely';
import { advanceClearing } from '@avanpost/sim';
import type { Config } from '../config';
import type { WorldBalance } from '../balance';
import type { DB, WorldStateTable } from '../db/schema';
import { loadRegion, refreshSectorStatuses, type Region } from './region';
import { advanceBuildings, advanceTransfers, planTransfers } from './construction';
import { advanceHauls, advanceNodes, planHauls } from './logistics';
import { advanceCraft, planProductionTransfers } from './craft';
import { advanceResearch } from './research';
import { advanceTraining, migrateResidents } from './population';
import { WorldRun } from './run';
import type { OutboxEvent } from './commands';

interface StartedClearingJob {
  id: string;
  sector_id: string;
  x: number;
  y: number;
  workDone: number;
  workRequired: number;
}

export interface CaughtUp {
  ticksProcessed: number;
  tick: number;
  fleetAt: Date;
  events?: OutboxEvent[];
}

/**
 * One tick of the world. All systems run in the same fixed order per tick, so
 * world state depends only on the number of ticks applied, never on how a
 * period was split across calls (ADR-0005, property D07).
 *
 * Every system mutates the in-memory WorldRun; persistence happens once via
 * `run.flush()` at the end of the batch.
 */
async function simulateOneTick(
  run: WorldRun,
  trx: Transaction<DB>,
  region: Region,
  tick: number,
  jobs: StartedClearingJob[],
  xpRules: { xpPerSchool: number; levelThresholds: readonly number[] }
): Promise<OutboxEvent[]> {
  const events: OutboxEvent[] = [];
  const balance = run.balance;

  // Fast-clearing of terrain (section I.1): per-tick work with immediate
  // terrain swap on completion.
  if (jobs.length > 0) {
    const advances = advanceClearing(jobs, 1, balance.clearing.workPerTick);
    const advanceById = new Map(advances.map((advance) => [advance.id, advance]));
    const finished: StartedClearingJob[] = [];
    for (const job of jobs) {
      const advance = advanceById.get(job.id);
      if (!advance) continue;
      if (!advance.completed) {
        job.workDone = advance.workDone;
        continue;
      }
      finished.push(job);
      const cell = await trx
        .selectFrom('terrain_cell')
        .selectAll()
        .where('sector_id', '=', job.sector_id)
        .where('x', '=', job.x)
        .where('y', '=', job.y)
        .executeTakeFirst();
      if (cell) {
        const rule = balance.terrains[cell.terrain_type];
        if (rule.clearable && rule.becomes) {
          const nextRule = balance.terrains[rule.becomes];
          await trx
            .updateTable('terrain_cell')
            .set({
              terrain_type: rule.becomes,
              obstacle: !nextRule.passable,
              passable: nextRule.passable
            })
            .where('sector_id', '=', job.sector_id)
            .where('x', '=', job.x)
            .where('y', '=', job.y)
            .execute();
          events.push({
            type: 'ClearingCompleted',
            payload: {
              sectorId: job.sector_id,
              x: job.x,
              y: job.y,
              terrain: rule.becomes
            }
          });
        }
      }
    }
    if (finished.length > 0) {
      for (const job of finished) {
        await trx
          .updateTable('clearing_job')
          .set({ work_done: job.workRequired, status: 'done' })
          .where('id', '=', job.id)
          .execute();
      }
      jobs = jobs.filter((job) => !finished.includes(job));
    }
  }
  if (balance.economyEnabled) {
    events.push(...advanceNodes(run));
    events.push(...advanceTransfers(run, region));
    // Inputs are delivered above; consume them and produce outputs before the
    // planner hauls outputs back to storage.
    events.push(...advanceCraft(run));
    events.push(...advanceResearch(run));
    events.push(...planTransfers(run, region));
    events.push(...planProductionTransfers(run, region));
    events.push(...planHauls(run, region));
    events.push(...advanceHauls(run, region));
    events.push(...advanceBuildings(run));
  }

  events.push(...advanceTraining(run, 1, xpRules));
  events.push(...migrateResidents(run, tick + 1));

  return Promise.resolve(events);
}

/**
 * Advance the world by exactly `ticks` ticks inside an already locked
 * transaction. The world is loaded into a run memo once; systems mutate the
 * memo per tick; the memo is flushed atomically at the end (ADR-0005).
 */
export async function simulateTicks(
  trx: Transaction<DB>,
  ownerId: string,
  balance: WorldBalance,
  now: Date,
  startTick: number,
  ticks: number
): Promise<{ tick: number; events: OutboxEvent[] }> {
  const run = await WorldRun.load(trx, ownerId, balance, now);
  const region = await loadRegion(trx, ownerId, balance);
  const jobRows = await trx
    .selectFrom('clearing_job')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', '=', 'active')
    .execute();
  const jobs: StartedClearingJob[] = jobRows.map((job) => ({
    id: job.id,
    sector_id: job.sector_id,
    x: job.x,
    y: job.y,
    workDone: job.work_done,
    workRequired: job.work_required
  }));

  const xpRules = {
    xpPerSchool: balance.xp.xpPerSchool,
    levelThresholds: balance.xp.levelThresholds
  };
  const events: OutboxEvent[] = [
    { type: 'WorldAdvanced', payload: { ticks } }
  ];

  let tick = startTick;
  for (let step = 0; step < ticks; step += 1) {
    events.push(...(await simulateOneTick(run, trx, region, tick, jobs, xpRules)));
    tick += 1;
  }

  for (const job of jobs) {
    await trx
      .updateTable('clearing_job')
      .set({ work_done: job.workDone })
      .where('id', '=', job.id)
      .execute();
  }

  await run.flush(trx);

  return { tick, events };
}

export interface SimPolicy {
  balance: WorldBalance;
  config: Pick<Config, 'tickMs' | 'maxCatchupTicks'>;
}

/**
 * Advance the world to wall-clock `now` inside a transaction that must hold the
 * world_state row lock. The caller is responsible for bumping versions where
 * needed and for writing back world_state.
 */
export async function catchUpLocked(
  trx: Transaction<DB>,
  ownerId: string,
  state: WorldStateTable,
  policy: SimPolicy,
  now: Date
): Promise<CaughtUp> {
  const { balance, config } = policy;
  const elapsed = now.getTime() - state.last_simulated_at.getTime();
  const due = Math.floor(elapsed / config.tickMs);
  const processed = Math.min(Math.max(due, 0), config.maxCatchupTicks);
  const fleetAt = new Date(
    state.last_simulated_at.getTime() + processed * config.tickMs
  );

  if (processed === 0) {
    return { ticksProcessed: 0, tick: state.tick, fleetAt };
  }

  const { tick, events } = await simulateTicks(
    trx,
    ownerId,
    balance,
    now,
    state.tick,
    processed
  );

  return { ticksProcessed: processed, tick, fleetAt, events };
}

/**
 * Lazy catch-up used by non-command endpoints (state/session/heartbeat):
 * one locked transaction per call, version bumped only when at least one tick
 * was simulated so the remainder is never silently dropped.
 */
export async function syncWorldTime(
  db: Kysely<DB>,
  ownerId: string,
  policy: SimPolicy,
  now: Date
): Promise<{ caughtUp: boolean; tick: number; version: number }> {
  const result = await db.transaction().execute(async (trx) => {
    const state = await trx
      .selectFrom('world_state')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    const caught = await catchUpLocked(trx, ownerId, state, policy, now);
    if (caught.ticksProcessed === 0) {
      return { caughtUp: false, tick: state.tick, version: state.version };
    }

    // Version changes only on player commands: catch-up must not invalidate
    // concurrently submitted command versions (optimistic locking holds).
    await trx
      .updateTable('world_state')
      .set({ tick: caught.tick, last_simulated_at: caught.fleetAt, updated_at: now })
      .where('owner_id', '=', ownerId)
      .execute();

    return { caughtUp: true, tick: caught.tick, version: state.version };
  });

  if (result.caughtUp) {
    await refreshSectorStatuses(db, ownerId, policy.balance);
  }

  return result;
}
