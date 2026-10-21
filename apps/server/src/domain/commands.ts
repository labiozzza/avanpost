import { randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import { advanceClearing, advanceTick, cellKey } from '@avanpost/sim';
import {
  ErrorCode,
  type BuildCommand,
  type ClearCellCommand,
  type DemolishCommand,
  type GatherNodeCommand,
  type StopGatherCommand,
  type UnlockSectorCommand
} from '@avanpost/shared';
import type { WorldBalance } from '../balance';
import type { DB, WorldStateTable } from '../db/schema';
import { AppError } from '../errors';
import { chargeSectorCost } from './economy';
import {
  advanceBuildings,
  advanceTransfers,
  planTransfers
} from './construction';
import { advanceHauls, advanceNodes, planHauls } from './logistics';
import { advanceTraining } from './population';
import {
  findSector,
  hasReachableNeighbor,
  loadRegion,
  planSector,
  refreshSectorStatuses
} from './region';

export interface OutboxEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface HandlerContext {
  trx: Transaction<DB>;
  ownerId: string;
  state: WorldStateTable;
  now: Date;
}

interface HandlerResult {
  tick?: number;
  events: OutboxEvent[];
}

interface CommandSpec {
  request_id: string;
  expected_version: number;
}

export async function executeCommand(
  db: Kysely<DB>,
  ownerId: string,
  spec: CommandSpec,
  commandType: string,
  payload: unknown,
  now: Date,
  handler: (ctx: HandlerContext) => Promise<HandlerResult>
): Promise<{ replayed: boolean }> {
  return db.transaction().execute(async (trx) => {
    const previous = await trx
      .selectFrom('command_log')
      .select('result')
      .where('player_id', '=', ownerId)
      .where('request_id', '=', spec.request_id)
      .executeTakeFirst();
    if (previous) return { replayed: true };

    const state = await trx
      .selectFrom('world_state')
      .selectAll()
      .where('owner_id', '=', ownerId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (state.version !== spec.expected_version) {
      throw new AppError(
        409,
        ErrorCode.STALE_VERSION,
        `expected version ${spec.expected_version}, current ${state.version}`
      );
    }

    const result = await handler({ trx, ownerId, state, now });
    const tick = result.tick ?? state.tick;
    const version = state.version + 1;

    await trx
      .updateTable('world_state')
      .set({ tick, version, updated_at: now })
      .where('owner_id', '=', ownerId)
      .execute();

    await trx
      .insertInto('command_log')
      .values({
        player_id: ownerId,
        request_id: spec.request_id,
        command_type: commandType,
        payload: JSON.stringify(payload),
        result: JSON.stringify({ tick, version }),
        created_at: now
      })
      .execute();

    for (const event of result.events) {
      await trx
        .insertInto('outbox_event')
        .values({
          player_id: ownerId,
          event_type: event.type,
          payload: JSON.stringify(event.payload),
          created_at: now
        })
        .execute();
    }

    return { replayed: false };
  });
}

function reachableEdgeTo(
  region: Awaited<ReturnType<typeof loadRegion>>,
  targetX: number,
  targetY: number
): boolean {
  for (const sector of region.sectors) {
    const dx = sector.x - targetX;
    const dy = sector.y - targetY;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;

    const cells = region.cellsBySector.get(sector.id) ?? [];
    for (const cell of cells) {
      let onEdge = false;
      if (dx === 1) onEdge = cell.x === sector.width - 1;
      else if (dx === -1) onEdge = cell.x === 0;
      else if (dy === 1) onEdge = cell.y === sector.height - 1;
      else if (dy === -1) onEdge = cell.y === 0;
      if (onEdge && region.reachable.has(cellKey(cell.globalX, cell.globalY))) {
        return true;
      }
    }
  }
  return false;
}

export async function unlockSectorCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: UnlockSectorCommand,
  balance: WorldBalance,
  now: Date
): Promise<{ replayed: boolean }> {
  const result = await executeCommand(
    db,
    ownerId,
    command,
    'unlock_sector',
    {
      sector_x: command.sector_x,
      sector_y: command.sector_y
    },
    now,
    async ({ trx, state }) => {
      const region = await loadRegion(trx, ownerId, balance);
      if (findSector(region, command.sector_x, command.sector_y)) {
        throw new AppError(409, ErrorCode.SECTOR_EXISTS, 'sector already exists');
      }

      const adjacent = region.sectors.some(
        (sector) =>
          Math.abs(sector.x - command.sector_x) +
            Math.abs(sector.y - command.sector_y) ===
          1
      );
      if (!adjacent) {
        throw new AppError(409, ErrorCode.NOT_ADJACENT, 'sector is not adjacent');
      }
      if (!reachableEdgeTo(region, command.sector_x, command.sector_y)) {
        throw new AppError(
          409,
          ErrorCode.PATH_BLOCKED,
          'no reachable path to the sector edge'
        );
      }
      const spent = balance.economyEnabled
        ? await chargeSectorCost(trx, ownerId, balance)
        : { logs: 0, stone: 0 };

      const plan = planSector(
        state.world_seed,
        command.sector_x,
        command.sector_y,
        balance
      );
      const sectorId = randomUUID();
      await trx
        .insertInto('world_sector')
        .values({
          id: sectorId,
          owner_id: ownerId,
          x: plan.x,
          y: plan.y,
          width: plan.width,
          height: plan.height,
          biome: plan.biome,
          status: 'unlocked',
          seed: plan.seed,
          created_at: now
        })
        .execute();

      for (let offset = 0; offset < plan.terrain.length; offset += 500) {
        const chunk = plan.terrain.slice(offset, offset + 500);
        await trx
          .insertInto('terrain_cell')
          .values(
            chunk.map((cell) => ({
              sector_id: sectorId,
              x: cell.x,
              y: cell.y,
              terrain_type: cell.type,
              obstacle: cell.obstacle,
              passable: cell.passable
            }))
          )
          .execute();
      }

      return {
        events: [
          {
            type: 'SectorUnlocked',
            payload: {
              sectorId,
              x: plan.x,
              y: plan.y,
              biome: plan.biome,
              seed: plan.seed
            }
          },
          {
            type: 'ResourcesSpent',
            payload: { item: 'logs', qty: spent.logs }
          },
          {
            type: 'ResourcesSpent',
            payload: { item: 'stone', qty: spent.stone }
          }
        ]
      };
    }
  );

  if (!result.replayed) await refreshSectorStatuses(db, ownerId, balance);
  return result;
}

export async function clearCellCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: ClearCellCommand,
  balance: WorldBalance,
  now: Date
): Promise<{ replayed: boolean }> {
  const result = await executeCommand(
    db,
    ownerId,
    command,
    'clear_cell',
    {
      sector_id: command.sector_id,
      x: command.x,
      y: command.y
    },
    now,
    async ({ trx }) => {
      const sector = await trx
        .selectFrom('world_sector')
        .selectAll()
        .where('id', '=', command.sector_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!sector) {
        throw new AppError(404, ErrorCode.SECTOR_NOT_FOUND, 'sector not found');
      }

      const cell = await trx
        .selectFrom('terrain_cell')
        .selectAll()
        .where('sector_id', '=', command.sector_id)
        .where('x', '=', command.x)
        .where('y', '=', command.y)
        .executeTakeFirst();
      if (!cell) {
        throw new AppError(404, ErrorCode.TERRAIN_NOT_FOUND, 'terrain cell not found');
      }

      const rule = balance.terrains[cell.terrain_type];
      if (!rule.clearable) {
        throw new AppError(409, ErrorCode.NOT_CLEARABLE, 'terrain is not clearable');
      }

      const existingJob = await trx
        .selectFrom('clearing_job')
        .selectAll()
        .where('sector_id', '=', command.sector_id)
        .where('x', '=', command.x)
        .where('y', '=', command.y)
        .executeTakeFirst();
      if (existingJob?.status === 'active') {
        throw new AppError(
          409,
          ErrorCode.CLEARING_ALREADY_STARTED,
          'clearing already started'
        );
      }
      if (existingJob?.status === 'done') {
        throw new AppError(409, ErrorCode.ALREADY_CLEARED, 'cell is already cleared');
      }

      const region = await loadRegion(trx, ownerId, balance);
      const regionCell = (region.cellsBySector.get(sector.id) ?? []).find(
        (item) => item.x === command.x && item.y === command.y
      );
      if (!regionCell || !hasReachableNeighbor(region, regionCell)) {
        throw new AppError(409, ErrorCode.PATH_BLOCKED, 'cell is not reachable');
      }

      await trx
        .insertInto('clearing_job')
        .values({
          id: randomUUID(),
          owner_id: ownerId,
          sector_id: sector.id,
          x: command.x,
          y: command.y,
          work_done: 0,
          work_required: rule.clearingWork,
          status: 'active',
          created_at: now,
          updated_at: now
        })
        .execute();

      await trx
        .updateTable('world_sector')
        .set({ status: 'clearing' })
        .where('id', '=', sector.id)
        .execute();

      return {
        events: [
          {
            type: 'ClearingStarted',
            payload: {
              sectorId: sector.id,
              x: command.x,
              y: command.y,
              terrain: cell.terrain_type,
              workRequired: rule.clearingWork
            }
          }
        ]
      };
    }
  );

  if (!result.replayed) await refreshSectorStatuses(db, ownerId, balance);
  return result;
}

export async function gatherNodeCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: GatherNodeCommand,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'gather_node',
    { node_id: command.node_id },
    now,
    async ({ trx }) => {
      const node = await trx
        .selectFrom('resource_node')
        .selectAll()
        .where('id', '=', command.node_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!node) {
        throw new AppError(404, ErrorCode.NODE_NOT_FOUND, 'resource node not found');
      }
      if (node.active) {
        throw new AppError(409, ErrorCode.ALREADY_GATHERING, 'node is already being gathered');
      }
      if (node.amount <= 0) {
        throw new AppError(409, ErrorCode.NODE_DEPLETED, 'resource node is depleted');
      }

      const gatherer = await trx
        .selectFrom('laborer')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('role', '=', 'gatherer')
        .where('status', '=', 'idle')
        .orderBy('created_at')
        .executeTakeFirst();
      if (!gatherer) {
        throw new AppError(409, ErrorCode.NO_IDLE_GATHERER, 'no idle gatherer');
      }

      await trx
        .updateTable('resource_node')
        .set({ active: true, gatherer_id: gatherer.id })
        .where('id', '=', node.id)
        .execute();
      await trx
        .updateTable('laborer')
        .set({
          status: 'gathering',
          node_id: node.id,
          sector_id: node.sector_id,
          x: node.x,
          y: node.y
        })
        .where('id', '=', gatherer.id)
        .execute();

      return {
        events: [
          {
            type: 'GatheringStarted',
            payload: {
              nodeId: node.id,
              gathererId: gatherer.id,
              kind: node.kind,
              item: node.item
            }
          }
        ]
      };
    }
  );
}

export async function stopGatherCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: StopGatherCommand,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'stop_gather',
    { node_id: command.node_id },
    now,
    async ({ trx }) => {
      const node = await trx
        .selectFrom('resource_node')
        .selectAll()
        .where('id', '=', command.node_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!node) {
        throw new AppError(404, ErrorCode.NODE_NOT_FOUND, 'resource node not found');
      }
      if (!node.active) {
        throw new AppError(409, ErrorCode.NOT_GATHERING, 'node is not being gathered');
      }

      await trx
        .updateTable('resource_node')
        .set({ active: false, gatherer_id: null })
        .where('id', '=', node.id)
        .execute();
      if (node.gatherer_id) {
        await trx
          .updateTable('laborer')
          .set({ status: 'idle', node_id: null })
          .where('id', '=', node.gatherer_id)
          .execute();
      }

      return {
        events: [
          {
            type: 'GatheringStopped',
            payload: { nodeId: node.id, kind: node.kind }
          }
        ]
      };
    }
  );
}

export async function buildCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: BuildCommand,
  balance: WorldBalance,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'build',
    {
      building_type: command.building_type,
      sector_id: command.sector_id,
      x: command.x,
      y: command.y
    },
    now,
    async ({ trx }) => {
      const rule = balance.buildings[command.building_type];
      if (!rule) {
        throw new AppError(
          404,
          ErrorCode.BUILDING_TYPE_NOT_FOUND,
          `unknown building type ${command.building_type}`
        );
      }

      const sector = await trx
        .selectFrom('world_sector')
        .selectAll()
        .where('id', '=', command.sector_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!sector) {
        throw new AppError(404, ErrorCode.SECTOR_NOT_FOUND, 'sector not found');
      }
      const cell = await trx
        .selectFrom('terrain_cell')
        .selectAll()
        .where('sector_id', '=', sector.id)
        .where('x', '=', command.x)
        .where('y', '=', command.y)
        .executeTakeFirst();
      if (!cell) {
        throw new AppError(404, ErrorCode.TERRAIN_NOT_FOUND, 'terrain cell not found');
      }
      if (!cell.passable) {
        throw new AppError(409, ErrorCode.NOT_BUILDABLE, 'cell is not passable');
      }

      const occupiedBuilding = await trx
        .selectFrom('building')
        .selectAll()
        .where('sector_id', '=', sector.id)
        .where('x', '=', command.x)
        .where('y', '=', command.y)
        .where('status', '<>', 'demolished')
        .executeTakeFirst();
      const pendingSalvage = await trx
        .selectFrom('building')
        .innerJoin('building_material', 'building_material.building_id', 'building.id')
        .select('building.id')
        .where('building.sector_id', '=', sector.id)
        .where('building.x', '=', command.x)
        .where('building.y', '=', command.y)
        .where('building.status', '=', 'demolished')
        .where('building_material.delivered', '>', 0)
        .executeTakeFirst();
      const occupiedStorage = await trx
        .selectFrom('storage')
        .selectAll()
        .where('sector_id', '=', sector.id)
        .where('x', '=', command.x)
        .where('y', '=', command.y)
        .executeTakeFirst();
      const occupiedNode = await trx
        .selectFrom('resource_node')
        .selectAll()
        .where('sector_id', '=', sector.id)
        .where('x', '=', command.x)
        .where('y', '=', command.y)
        .executeTakeFirst();
      if (occupiedBuilding || pendingSalvage || occupiedStorage || occupiedNode) {
        throw new AppError(409, ErrorCode.CELL_OCCUPIED, 'cell is already occupied');
      }

      const region = await loadRegion(trx, ownerId, balance);
      const globalX = sector.x * sector.width + command.x;
      const globalY = sector.y * sector.height + command.y;
      if (!region.reachable.has(cellKey(globalX, globalY))) {
        throw new AppError(409, ErrorCode.PATH_BLOCKED, 'build cell is not reachable');
      }

      const buildingId = randomUUID();
      await trx
        .insertInto('building')
        .values({
          id: buildingId,
          owner_id: ownerId,
          sector_id: sector.id,
          type: rule.id,
          x: command.x,
          y: command.y,
          status: 'awaiting_materials',
          work_done: 0,
          work_required: rule.buildWork,
          workers_limit: rule.workersLimit,
          builder_id: null,
          created_at: now,
          updated_at: now,
          completed_at: null
        })
        .execute();
      for (const [item, qty] of Object.entries(rule.materials)) {
        await trx
          .insertInto('building_material')
          .values({ building_id: buildingId, item, required: qty, delivered: 0 })
          .execute();
      }

      return {
        events: [
          {
            type: 'BuildingPlaced',
            payload: {
              buildingId,
              type: rule.id,
              sectorId: sector.id,
              x: command.x,
              y: command.y
            }
          }
        ]
      };
    }
  );
}

export async function demolishCommand(
  db: Kysely<DB>,
  ownerId: string,
  command: DemolishCommand,
  now: Date
): Promise<{ replayed: boolean }> {
  return executeCommand(
    db,
    ownerId,
    command,
    'demolish',
    { building_id: command.building_id },
    now,
    async ({ trx }) => {
      const building = await trx
        .selectFrom('building')
        .selectAll()
        .where('id', '=', command.building_id)
        .where('owner_id', '=', ownerId)
        .executeTakeFirst();
      if (!building) {
        throw new AppError(404, ErrorCode.BUILDING_NOT_FOUND, 'building not found');
      }
      if (building.status !== 'complete') {
        throw new AppError(
          409,
          ErrorCode.BUILDING_NOT_COMPLETE,
          'only completed buildings can be demolished'
        );
      }
      const busy = await trx
        .selectFrom('transfer_task')
        .selectAll()
        .where('building_id', '=', building.id)
        .where('status', 'not in', ['complete', 'failed'])
        .executeTakeFirst();
      if (busy) {
        throw new AppError(409, ErrorCode.BUILDING_BUSY, 'building has active transfers');
      }

      await trx
        .updateTable('building')
        .set({
          status: 'demolition',
          work_done: 0,
          work_required: Math.max(1, Math.ceil(building.work_required / 2)),
          builder_id: null,
          completed_at: null,
          updated_at: now
        })
        .where('id', '=', building.id)
        .execute();

      return {
        events: [
          {
            type: 'DemolitionStarted',
            payload: { buildingId: building.id, type: building.type }
          }
        ]
      };
    }
  );
}

export async function advanceWorldCommand(
  db: Kysely<DB>,
  ownerId: string,
  spec: CommandSpec & { ticks: number },
  balance: WorldBalance,
  now: Date
): Promise<{ replayed: boolean }> {
  const result = await executeCommand(
    db,
    ownerId,
    spec,
    'advance',
    { ticks: spec.ticks },
    now,
    async ({ trx, state }) => {
      const jobs = await trx
        .selectFrom('clearing_job')
        .selectAll()
        .where('owner_id', '=', ownerId)
        .where('status', '=', 'active')
        .execute();

      const advances = advanceClearing(
        jobs.map((job) => ({
          id: job.id,
          workDone: job.work_done,
          workRequired: job.work_required
        })),
        spec.ticks,
        balance.clearing.workPerTick
      );
      const advanceById = new Map(advances.map((advance) => [advance.id, advance]));
      const events: OutboxEvent[] = [];

      for (const job of jobs) {
        const advance = advanceById.get(job.id);
        if (!advance) continue;

        if (!advance.completed) {
          await trx
            .updateTable('clearing_job')
            .set({ work_done: advance.workDone, updated_at: now })
            .where('id', '=', job.id)
            .execute();
          continue;
        }

        const cell = await trx
          .selectFrom('terrain_cell')
          .selectAll()
          .where('sector_id', '=', job.sector_id)
          .where('x', '=', job.x)
          .where('y', '=', job.y)
          .executeTakeFirst();
        if (!cell) continue;
        const rule = balance.terrains[cell.terrain_type];
        if (!rule.clearable || !rule.becomes) continue;
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

        await trx
          .updateTable('clearing_job')
          .set({
            work_done: job.work_required,
            status: 'done',
            updated_at: now
          })
          .where('id', '=', job.id)
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

      if (balance.economyEnabled) {
        const region = await loadRegion(trx, ownerId, balance);
        const nodeEvents = await advanceNodes(trx, ownerId, spec.ticks, balance, now);
        const transferEvents = await advanceTransfers(
          trx,
          ownerId,
          spec.ticks,
          balance,
          now,
          region
        );
        const transferQueue = await planTransfers(trx, ownerId, region, balance, now);
        const queueEvents = await planHauls(trx, ownerId, region, balance, now);
        const haulEvents = await advanceHauls(
          trx,
          ownerId,
          spec.ticks,
          balance,
          now,
          region
        );
        const buildingEvents = await advanceBuildings(
          trx,
          ownerId,
          spec.ticks,
          balance,
          now
        );
        events.push(
          ...nodeEvents,
          ...transferEvents,
          ...transferQueue,
          ...queueEvents,
          ...haulEvents,
          ...buildingEvents
        );
      }

      const trainingEvents = await advanceTraining(trx, ownerId, spec.ticks);

      events.unshift({
        type: 'WorldAdvanced',
        payload: { ticks: spec.ticks }
      });
      events.push(...trainingEvents);

      return { tick: advanceTick(state.tick, spec.ticks), events };
    }
  );

  if (!result.replayed) await refreshSectorStatuses(db, ownerId, balance);
  return result;
}
