import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import {
  ErrorCode,
  type CancelResearchCommand,
  type StartResearchCommand
} from '@avanpost/shared';
import type { WorldBalance } from '../balance';
import type { DB } from '../db/schema';
import { AppError } from '../errors';
import { executeCommand } from './commands';
import type { OutboxEvent } from './commands';
import type { WorldRun } from './run';

type Queryable = Kysely<DB> | Transaction<DB>;

/**
 * GDD 6.1: research is a player-level activity. The selected node occupies the
 * single research slot; it is only staffed while a live scholar is assigned.
 * RP accrue on the authoritative tick (see advanceResearch), never on read.
 */
export async function startResearchCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: StartResearchCommand,
  balance: WorldBalance,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'start_research',
    {
      technology_id: command.technology_id,
      scholar_id: command.scholar_id ?? null
    },
    now,
    async ({ trx }) => {
      if (!balance.research.enabled) {
        throw new AppError(409, ErrorCode.RESEARCH_DISABLED, 'research disabled');
      }

      const technology = balance.techTree[command.technology_id];
      if (!technology) {
        throw new AppError(
          404,
          ErrorCode.TECHNOLOGY_NOT_FOUND,
          `unknown technology ${command.technology_id}`
        );
      }

      const researched = await trx
        .selectFrom('researched_technology')
        .select('technology_id')
        .where('owner_id', '=', ownerId)
        .where('technology_id', '=', command.technology_id)
        .executeTakeFirst();
      if (researched) {
        throw new AppError(
          409,
          ErrorCode.TECHNOLOGY_NOT_AVAILABLE,
          `${command.technology_id} already researched`
        );
      }

      for (const requirement of technology.requires) {
        const met = await trx
          .selectFrom('researched_technology')
          .select('technology_id')
          .where('owner_id', '=', ownerId)
          .where('technology_id', '=', requirement)
          .executeTakeFirst();
        if (!met) {
          throw new AppError(
            409,
            ErrorCode.TECHNOLOGY_NOT_AVAILABLE,
            `${command.technology_id} requires ${requirement}`
          );
        }
      }

      const active = await trx
        .selectFrom('research_project')
        .select('id')
        .where('owner_id', '=', ownerId)
        .where('status', 'in', ['active', 'paused'])
        .executeTakeFirst();
      if (active) {
        throw new AppError(409, ErrorCode.RESEARCH_ALREADY_ACTIVE, 'research slot busy');
      }

      let scholarId: string | null = null;
      if (command.scholar_id) {
        const academy = await trx
          .selectFrom('building')
          .select('id')
          .where('owner_id', '=', ownerId)
          .where('type', '=', 'academy')
          .where('status', '=', 'complete')
          .executeTakeFirst();
        if (!academy) {
          throw new AppError(
            409,
            ErrorCode.BUILDING_NOT_COMPLETE,
            'a completed academy is required for research'
          );
        }
        const scholar = await trx
          .selectFrom('resident')
          .select(['id', 'status'])
          .where('id', '=', command.scholar_id)
          .where('owner_id', '=', ownerId)
          .executeTakeFirst();
        if (!scholar) {
          throw new AppError(404, ErrorCode.RESIDENT_NOT_FOUND, 'scholar not found');
        }
        if (scholar.status !== 'idle') {
          throw new AppError(409, ErrorCode.BUILDING_BUSY, 'scholar is not idle');
        }
        const craft = await trx
          .selectFrom('craft_order')
          .select('id')
          .where('worker_id', '=', command.scholar_id)
          .where('status', 'in', ['active', 'blocked'])
          .executeTakeFirst();
        if (craft) {
          throw new AppError(409, ErrorCode.BUILDING_BUSY, 'scholar is crafting');
        }
        scholarId = command.scholar_id;
      }

      const projectId = randomUUID();
      await trx
        .insertInto('research_project')
        .values({
          id: projectId,
          owner_id: ownerId,
          technology_id: command.technology_id,
          progress: 0,
          cost: technology.cost,
          scholar_id: scholarId,
          status: scholarId ? 'active' : 'paused',
          created_at: now,
          updated_at: now
        })
        .execute();

      return {
        events: [
          {
            type: 'ResearchStarted',
            payload: {
              projectId,
              technologyId: command.technology_id,
              scholarId,
              cost: technology.cost
            }
          }
        ]
      };
    }
  );
}

export async function cancelResearchCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: CancelResearchCommand,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'cancel_research',
    {},
    now,
    async ({ trx }) => {
      const project = await trx
        .selectFrom('research_project')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('status', 'in', ['active', 'paused'])
        .executeTakeFirst();
      if (!project) {
        throw new AppError(404, ErrorCode.RESEARCH_NOT_FOUND, 'no active research');
      }
      await trx
        .updateTable('research_project')
        .set({ status: 'cancelled', updated_at: now })
        .where('id', '=', project.id)
        .execute();
      return {
        events: [
          {
            type: 'ResearchCancelled',
            payload: {
              projectId: project.id,
              technologyId: project.technology_id
            }
          }
        ]
      };
    }
  );
}

/**
 * F3 (high): RP accrue only while a project is `active` AND its scholar is a
 * live resident. A project with no scholar (or a dead one) makes zero progress.
 */
export function advanceResearch(run: WorldRun): OutboxEvent[] {
  const { balance } = run;
  if (!balance.research.enabled) return [];

  const project = run.researchProject;
  if (!project) return [];
  if (project.status === 'complete' || project.status === 'cancelled') return [];

  if (!project.scholar_id) {
    if (project.status !== 'paused') project.status = 'paused';
    return [];
  }

  const scholar = run.residents.find((row) => row.id === project.scholar_id);
  const academy = run.buildings.find(
    (building) =>
      building.owner_id === run.ownerId &&
      building.type === 'academy' &&
      building.status === 'complete'
  );
  const craft = run.craftOrders.find(
    (order) =>
      order.worker_id === project.scholar_id &&
      (order.status === 'active' || order.status === 'blocked')
  );
  if (!scholar || scholar.status !== 'idle' || !academy || craft) {
    if (project.status !== 'paused') project.status = 'paused';
    return [];
  }

  if (project.status !== 'active') project.status = 'active';

  const progress = Math.min(
    project.cost,
    project.progress + balance.research.pointsPerTick
  );
  const events: OutboxEvent[] = [];

  const gained = Math.min(
    balance.research.pointsPerTick,
    project.cost - project.progress
  );
  if (progress >= project.cost) {
    project.progress = project.cost;
    project.status = 'complete';
    run.markTechnologyResearched(project.technology_id);
    events.push({
      type: 'ResearchCompleted',
      payload: {
        projectId: project.id,
        technologyId: project.technology_id
      }
    });
  } else {
    project.progress = progress;
  }

  run.addResearchPoints(gained);

  return events;
}
