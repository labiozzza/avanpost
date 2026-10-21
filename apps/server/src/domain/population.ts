import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import {
  ErrorCode,
  type SchoolId,
  type SendSchoolCommand
} from '@avanpost/shared';
import {
  RESIDENT_TRAITS,
  applySchool,
  residentNameFor,
  residentTraitsFor,
  TRAINING_TICKS
} from '@avanpost/sim';
import { AppError } from '../errors';
import type { DB, ResidentTable } from '../db/schema';
import { executeCommand, type OutboxEvent } from './commands';

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
  now: Date
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < STARTING_RESIDENTS; index += 1) {
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

export async function sendSchoolCommand(
  db: Kysely<DB>,
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
  ticks: number
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
        xp: resident.xp + 1,
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
  }
  return events;
}
