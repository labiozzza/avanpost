import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import {
  ErrorCode,
  type SchoolId,
  type SendSchoolCommand
} from '@avanpost/shared';
import {
  RESIDENT_NAMES,
  RESIDENT_TRAITS,
  applySchool,
  canMigrate,
  freeSlots,
  housingCapacity,
  residentNameFor,
  residentTraitsFor,
  TRAINING_TICKS,
  type PopulationRules
} from '@avanpost/sim';
import { AppError } from '../errors';
import type { DB, ResidentTable } from '../db/schema';
import type { WorldBalance } from '../balance';
import { executeCommand, type OutboxEvent } from './commands';
import { awardResidentXp } from './xp';

export const STARTING_RESIDENTS = 3;

export interface ResidentRow {
  id: string;
  name: string;
  traits: string[];
  schools: SchoolId[];
  profession: string;
  xp: number;
  status: 'idle' | 'school';
  school_id: string | null;
  training_left_ticks: number;
  training_total_ticks: number;
}

function readTraits(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string');
}

function readSchools(raw: unknown): SchoolId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is SchoolId => value === 'gather' || value === 'craft');
}

export function toResidentRow(row: ResidentTable): ResidentRow {
  return {
    id: row.id,
    name: row.name,
    traits: readTraits(row.traits),
    schools: readSchools(row.schools),
    profession: row.profession,
    xp: row.xp,
    status: row.status,
    school_id: row.school_id,
    training_left_ticks: row.training_left_ticks,
    training_total_ticks: row.training_total_ticks
  };
}

export function traitsVector(index: number): string[] {
  return residentTraitsFor(index);
}

export function residentName(index: number): string {
  return residentNameFor(index);
}

export function traitsCatalog(): readonly string[] {
  return RESIDENT_TRAITS;
}

/** GDD 3.1: starting settlement gets a few ready-to-work residents. */
export async function seedResidents(
  trx: Transaction<DB>,
  ownerId: string,
  now: Date,
  count: number = STARTING_RESIDENTS
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    ids.push(id);
    await trx
      .insertInto('resident')
      .values({
        id,
        owner_id: ownerId,
        name: residentNameFor(index),
        traits: JSON.stringify(residentTraitsFor(index)),
        schools: JSON.stringify([]),
        profession: 'Разнорабочий',
        xp: 0,
        status: 'idle',
        school_id: null,
        training_left_ticks: 0,
        training_total_ticks: 0,
        created_at: now
      })
      .execute();
  }
  return ids;
}

export async function loadResidents(
  db: Kysely<DB>,
  ownerId: string
): Promise<ResidentRow[]> {
  const rows = await db
    .selectFrom('resident')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .orderBy('created_at')
    .execute();
  return rows.map(toResidentRow);
}

/**
 * D2=A: every resident is one laborer (a body in the world). Bind the seeded
 * laborers to the seeded residents 1:1 so real work can credit the person.
 */
export async function bindResidentsToLaborers(
  trx: Transaction<DB>,
  ownerId: string,
  residentIds: readonly string[]
): Promise<void> {
  if (residentIds.length === 0) return;
  const laborers = await trx
    .selectFrom('laborer')
    .select(['id', 'role'])
    .where('owner_id', '=', ownerId)
    .where('resident_id', 'is', null)
    .orderBy('created_at')
    .execute();

  // D2=A: one resident == one laborer. Prefer a carrier body per resident so the
  // arrival route is visible; fall back to gatherers/builders when carriers run out.
  const roleRank: Record<string, number> = { carrier: 0, gatherer: 1, builder: 2 };
  const pool = [...laborers].sort(
    (a, b) => (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9)
  );
  const take = Math.min(residentIds.length, pool.length);
  for (let index = 0; index < take; index += 1) {
    const residentId = residentIds[index];
    const laborer = pool[index];
    if (!residentId || !laborer) continue;
    await trx
      .updateTable('laborer')
      .set({ resident_id: residentId })
      .where('id', '=', laborer.id)
      .execute();
  }
}

/**
 * GDD 2.2 / 3.1 / test 15: on the authoritative tick, if there is free living
 * space and enough real time has passed, one resident arrives on the visible
 * route. No free space => population never grows without houses.
 */
export async function migrateResidents(
  trx: Transaction<DB>,
  ownerId: string,
  tick: number,
  balance: WorldBalance,
  now: Date
): Promise<OutboxEvent[]> {
  if (!balance.population.migrationEnabled) return [];

  const state = await trx
    .selectFrom('world_state')
    .select(['last_migration_tick'])
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();
  const lastTick = state?.last_migration_tick ?? 0;
  if (tick - lastTick < balance.population.migrationMinTicks) return [];

  const residents = await trx
    .selectFrom('resident')
    .select(['id', 'name'])
    .where('owner_id', '=', ownerId)
    .orderBy('created_at')
    .execute();
  const houses = await trx
    .selectFrom('building')
    .select(['id'])
    .where('owner_id', '=', ownerId)
    .where('type', '=', 'house')
    .where('status', '=', 'complete')
    .execute();

  const rules: PopulationRules = {
    baseCapacity: balance.population.baseCapacity,
    housingCapacityPerHouse: balance.population.housingCapacityPerHouse,
    startingResidents: balance.population.startingResidents
  };
  const capacity = housingCapacity(houses.length, rules);
  if (!canMigrate(residents.length, capacity, balance.population.migrationEnabled)) {
    return [];
  }
  if (freeSlots(residents.length, capacity) <= 0) return [];

  const takenNames = residents.map((resident) => resident.name);
  const index = takenNames.length;
  const name = RESIDENT_NAMES.find((candidate) => !takenNames.includes(candidate)) ??
    residentNameFor(index);

  const sector = await trx
    .selectFrom('world_sector')
    .select(['id'])
    .where('owner_id', '=', ownerId)
    .orderBy('x')
    .orderBy('y')
    .executeTakeFirst();
  if (!sector) return [];

  const storage = await trx
    .selectFrom('storage')
    .select(['x', 'y'])
    .where('owner_id', '=', ownerId)
    .orderBy('created_at')
    .executeTakeFirst();
  const spawn = storage ?? { x: 0, y: 0 };

  const residentId = randomUUID();
  await trx
    .insertInto('resident')
    .values({
      id: residentId,
      owner_id: ownerId,
      name,
      traits: JSON.stringify(residentTraitsFor(index)),
      schools: JSON.stringify([]),
      profession: 'Разнорабочий',
      xp: 0,
      status: 'idle',
      school_id: null,
      training_left_ticks: 0,
      training_total_ticks: 0,
      created_at: now
    })
    .execute();

  const laborerId = randomUUID();
  await trx
    .insertInto('laborer')
    .values({
      id: laborerId,
      owner_id: ownerId,
      sector_id: sector.id,
      resident_id: residentId,
      role: balance.population.arrivalLaborerRole,
      status: 'idle',
      transport: 'person',
      x: spawn.x,
      y: spawn.y,
      node_id: null,
      created_at: now
    })
    .execute();

  await trx
    .updateTable('world_state')
    .set({ last_migration_tick: tick })
    .where('owner_id', '=', ownerId)
    .execute();

  return [
    {
      type: 'ResidentArrived',
      payload: {
        residentId,
        laborerId,
        name,
        x: spawn.x,
        y: spawn.y,
        residents: residents.length + 1,
        capacity
      }
    }
  ];
}

export async function sendSchoolCommand(  db: Kysely<DB>,
  ownerId: string,
  command: SendSchoolCommand,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'send_school',
    { resident_id: command.resident_id, school: command.school },
    now,
    async ({ trx }) => {
      const row = await trx
        .selectFrom('resident')
        .selectAll()
        .where('id', '=', command.resident_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!row) {
        throw new AppError(404, ErrorCode.RESIDENT_NOT_FOUND, 'resident not found');
      }

      const resident = toResidentRow(row);
      if (resident.status === 'school') {
        throw new AppError(409, ErrorCode.RESIDENT_IN_SCHOOL, 'resident is already studying');
      }
      if (resident.schools.includes(command.school)) {
        throw new AppError(
          409,
          ErrorCode.SCHOOL_ALREADY_LEARNED,
          'resident already knows this school'
        );
      }

      await trx
        .updateTable('resident')
        .set({
          status: 'school',
          school_id: command.school,
          training_left_ticks: TRAINING_TICKS,
          training_total_ticks: TRAINING_TICKS
        })
        .where('id', '=', resident.id)
        .execute();

      const events: OutboxEvent[] = [
        {
          type: 'ResidentStudyStarted',
          payload: {
            residentId: resident.id,
            school: command.school,
            ticks: TRAINING_TICKS
          }
        }
      ];
      return { events };
    }
  );
}

/**
 * Server-side school completion (GDD 9.6): results are recalculated on the
 * authoritative tick, never by the client.
 */
export async function advanceTraining(
  trx: Transaction<DB>,
  ownerId: string,
  ticks: number,
  xpRules: { xpPerSchool: number; levelThresholds: readonly number[] }
): Promise<OutboxEvent[]> {
  const studying = await trx
    .selectFrom('resident')
    .selectAll()
    .where('owner_id', '=', ownerId)
    .where('status', '=', 'school')
    .execute();

  const events: OutboxEvent[] = [];
  for (const row of studying) {
    const resident = toResidentRow(row);
    const left = Math.max(0, resident.training_left_ticks - ticks);
    if (left > 0) {
      await trx
        .updateTable('resident')
        .set({ training_left_ticks: left })
        .where('id', '=', resident.id)
        .execute();
      continue;
    }

    const school = resident.school_id;
    if (school !== 'gather' && school !== 'craft') {
      await trx
        .updateTable('resident')
        .set({ status: 'idle', school_id: null, training_left_ticks: 0 })
        .where('id', '=', resident.id)
        .execute();
      continue;
    }

    const outcome = applySchool(resident.schools, school);
    await trx
      .updateTable('resident')
      .set({
        schools: JSON.stringify(outcome.schools),
        profession: outcome.profession,
        status: 'idle',
        school_id: null,
        training_left_ticks: 0,
        training_total_ticks: 0
      })
      .where('id', '=', resident.id)
      .execute();

    events.push({
      type: 'ResidentTrained',
      payload: {
        residentId: resident.id,
        school,
        profession: outcome.profession,
        learned: outcome.learned
      }
    });
    events.push(
      ...(await awardResidentXp(
        trx,
        ownerId,
        resident.id,
        xpRules.xpPerSchool,
        'school',
        xpRules.levelThresholds
      ))
    );
  }
  return events;
}
