import { randomUUID } from 'node:crypto';
import { cellKey, findPath, stepPath, type WorldGraph } from '@avanpost/sim';
import type { WorldBalance } from '../balance';
import type {
  BuildingBufferTable,
  BuildingMaterialTable,
  BuildingTable,
  LaborerTable,
  StorageTable,
  TransferTaskTable
} from '../db/schema';
import { carrierCapacity, itemVolume, storageAccepts, storageFree } from './economy';
import { TERMINAL_TRANSFER, type BuildingWithMaterials, type WorldRun } from './run';
import type { EconomyEvent } from './logistics';
import { globalKeyFor, localizeGlobal, type Region } from './region';
import { awardLaborerXp } from './xp';

interface TransferRuntime {
  task: TransferTaskTable;
  storage: StorageTable;
  building: BuildingWithMaterials;
  material: BuildingMaterialTable | null;
  buffer: BuildingBufferTable | null;
  state: string;
  fromPath: Array<[number, number]>;
  toPath: Array<[number, number]>;
  index: number;
  stateTicks: number;
  sectorId: string;
  x: number;
  y: number;
  done: boolean;
}

function toPoints(keys: string[]): Array<[number, number]> {
  return keys.map((key) => {
    const [x, y] = key.split(':');
    return [Number(x), Number(y)] as [number, number];
  });
}

function parsePath(value: unknown): Array<[number, number]> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('transfer path must be an array');
    }
  }
  if (!Array.isArray(value)) throw new Error('transfer path must be an array');
  return value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error('transfer path point must be [x, y]');
    }
    return [Number(point[0]), Number(point[1])] as [number, number];
  });
}

function transferQty(
  building: BuildingWithMaterials,
  item: string,
  active: TransferTaskTable[]
): number {
  const material = building.materials.find((entry) => entry.item === item);
  if (!material) return 0;
  const moving = active
    .filter(
      (task) =>
        task.building_id === building.id &&
        task.item === item &&
        task.direction === 'to_building'
    )
    .reduce((sum, task) => sum + task.qty, 0);
  return Math.max(0, material.required - material.delivered - moving);
}

function salvageQty(building: BuildingWithMaterials, item: string, active: TransferTaskTable[]): number {
  const material = building.materials.find((entry) => entry.item === item);
  if (!material) return 0;
  const moving = active
    .filter(
      (task) =>
        task.building_id === building.id &&
        task.item === item &&
        task.direction === 'to_storage'
    )
    .reduce((sum, task) => sum + task.qty, 0);
  return Math.max(0, material.delivered - moving);
}

export function planTransfers(run: WorldRun, region: Region): EconomyEvent[] {
  const { balance, now } = run;
  const idleCarriers = run.laborers
    .filter((laborer) => laborer.role === 'carrier' && laborer.status === 'idle')
    .sort(
      (a, b) =>
        Number(b.transport === 'cart') - Number(a.transport === 'cart')
    );
  if (idleCarriers.length === 0) return [];

  const buildings = run.buildingsByStatus(['awaiting_materials', 'demolished']);
  if (buildings.length === 0) return [];

  // run.transferTasks is loaded non-terminal and stays non-terminal, so it
  // mirrors the old `active` query.
  const active = run.transferTasks.filter((task) => !TERMINAL_TRANSFER.has(task.status));

  const storageById = new Map(run.storages.map((storage) => [storage.id, storage]));
  const events: EconomyEvent[] = [];

  for (const carrier of idleCarriers) {
    const candidate = chooseTransfer(
      run,
      region,
      carrier,
      buildings,
      run.storages,
      active
    );
    if (!candidate) continue;
    const storage = storageById.get(candidate.storageId);
    if (!storage) continue;

    const task: TransferTaskTable = {
      id: candidate.id,
      owner_id: run.ownerId,
      building_id: candidate.buildingId,
      storage_id: candidate.storageId,
      direction: candidate.direction,
      item: candidate.item,
      qty: candidate.qty,
      carrier_id: carrier.id,
      status: 'reserved',
      path_from: JSON.stringify(candidate.pathFrom),
      path_to: JSON.stringify(candidate.pathTo),
      path_index: 0,
      state_ticks: 0,
      created_at: now,
      updated_at: now
    };
    run.addTransferTask(task);
    carrier.status = 'hauling';
    active.push(task);

    events.push({
      type: 'TransferQueued',
      payload: {
        taskId: candidate.id,
        buildingId: candidate.buildingId,
        direction: candidate.direction,
        item: candidate.item,
        qty: candidate.qty
      }
    });
  }

  return events;
}

interface TransferCandidate {
  id: string;
  buildingId: string;
  storageId: string;
  direction: 'to_building' | 'to_storage';
  item: string;
  qty: number;
  pathFrom: Array<[number, number]>;
  pathTo: Array<[number, number]>;
}

function graphAccessKeys(graph: WorldGraph, key: string): string[] {
  if (graph.has(key)) return [key];
  const [xText, yText] = key.split(':');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return [];
  return [
    cellKey(x + 1, y),
    cellKey(x - 1, y),
    cellKey(x, y + 1),
    cellKey(x, y - 1)
  ].filter((candidate) => graph.has(candidate));
}

function shortestPathFrom(
  graph: WorldGraph,
  starts: string[],
  destination: string
): string[] | null {
  let best: string[] | null = null;
  for (const start of starts) {
    const path = findPath(graph, start, destination);
    if (path && (!best || path.length < best.length)) best = path;
  }
  return best;
}

function chooseTransfer(
  run: WorldRun,
  region: Region,
  carrier: LaborerTable,
  buildings: BuildingWithMaterials[],
  storages: StorageTable[],
  active: TransferTaskTable[]
): TransferCandidate | null {
  const { balance } = run;
  const carrierKey = globalKeyFor(region, carrier.sector_id, carrier.x, carrier.y);
  if (!carrierKey) return null;
  const graph = carrier.transport === 'cart' ? region.cartGraph : region.graph;
  const carrierKeys = graphAccessKeys(graph, carrierKey);
  if (carrierKeys.length === 0) return null;
  const capacity = carrierCapacity(balance, carrier.transport);
  let best: TransferCandidate | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const building of buildings) {
    if (building.status === 'awaiting_materials') {
      for (const material of building.materials) {
        const remaining = transferQty(building, material.item, active);
        if (remaining <= 0) continue;

        const buildingKey = globalKeyFor(
          region,
          building.sector_id,
          building.x,
          building.y
        );
        if (!buildingKey) continue;

        for (const storage of storages) {
          if (!storageAccepts(balance, storage.type, material.item)) continue;
          const storageKey = globalKeyFor(
            region,
            storage.sector_id,
            storage.x,
            storage.y
          );
          if (!storageKey) continue;
          const content = run.storageQty(storage.id, material.item);
          const reservedOut = active
            .filter(
              (task) =>
                task.storage_id === storage.id &&
                task.item === material.item &&
                task.direction === 'to_building'
            )
            .reduce((sum, task) => sum + task.qty, 0);
          const available = content - reservedOut;
          if (available <= 0) continue;
          const qty = Math.min(capacity, remaining, available);
          if (qty <= 0) continue;

          const fromKeys = shortestPathFrom(graph, carrierKeys, storageKey);
          const toKeys = findPath(graph, storageKey, buildingKey);
          if (!fromKeys || !toKeys) continue;
          const cost = fromKeys.length + toKeys.length;
          if (cost >= bestCost) continue;
          bestCost = cost;
          best = {
            id: randomUUID(),
            buildingId: building.id,
            storageId: storage.id,
            direction: 'to_building',
            item: material.item,
            qty: Math.max(1, Math.min(qty, capacity)),
            pathFrom: toPoints(fromKeys),
            pathTo: toPoints(toKeys)
          };
        }
      }
      continue;
    }

    if (building.status !== 'demolished') continue;
    for (const material of building.materials) {
      const remaining = salvageQty(building, material.item, active);
      if (remaining <= 0) continue;
      const volume = itemVolume(balance, material.item);
      if (volume <= 0) continue;

      const buildingKey = globalKeyFor(
        region,
        building.sector_id,
        building.x,
        building.y
      );
      if (!buildingKey) continue;

      for (const storage of storages) {
        if (!storageAccepts(balance, storage.type, material.item)) continue;
        const storageKey = globalKeyFor(
          region,
          storage.sector_id,
          storage.x,
          storage.y
        );
        if (!storageKey) continue;
        const free = storageFree(storage);
        if (free < volume) continue;
        const qty = Math.min(capacity, remaining, Math.floor(free / volume));
        if (qty <= 0) continue;

        const fromKeys = shortestPathFrom(graph, carrierKeys, buildingKey);
        const toKeys = findPath(graph, buildingKey, storageKey);
        if (!fromKeys || !toKeys) continue;
        const cost = fromKeys.length + toKeys.length;
        if (cost >= bestCost) continue;
        bestCost = cost;
        best = {
          id: randomUUID(),
          buildingId: building.id,
          storageId: storage.id,
          direction: 'to_storage',
          item: material.item,
          qty,
          pathFrom: toPoints(fromKeys),
          pathTo: toPoints(toKeys)
        };
      }
    }
  }

  if (!best) return null;

  if (best.direction === 'to_storage') {
    const volume = itemVolume(balance, best.item) * best.qty;
    const storage = storages.find((entry) => entry.id === best?.storageId);
    if (!storage) return null;
    storage.reserved += volume;
  }
  return best;
}

function stepWithRoads(
  path: Array<[number, number]>,
  index: number,
  steps: number,
  region: Region
): { index: number; x: number; y: number } {
  let step = stepPath(path, index, steps);
  while (
    step.index < path.length - 1 &&
    region.moveCostByKey.has(cellKey(step.x, step.y))
  ) {
    step = stepPath(path, step.index, 1);
  }
  return step;
}

export function advanceTransfers(run: WorldRun, region: Region): EconomyEvent[] {
  const { balance } = run;
  const tasks = run.transferTasks.filter((task) => !TERMINAL_TRANSFER.has(task.status));
  if (tasks.length === 0) return [];

  const storageById = new Map(run.storages.map((storage) => [storage.id, storage]));
  const buildingById = new Map(run.buildings.map((building) => [building.id, building]));
  const carrierById = new Map(
    run.laborers.filter((laborer) => laborer.role === 'carrier').map((carrier) => [carrier.id, carrier])
  );

  const runtimes: TransferRuntime[] = [];
  for (const task of tasks) {
    if (!task.carrier_id) continue;
    const carrier = carrierById.get(task.carrier_id);
    const storage = storageById.get(task.storage_id);
    const building = buildingById.get(task.building_id);
    if (!carrier || !storage || !building) continue;
    runtimes.push({
      task,
      storage,
      building,
      material:
        building.materials.find((material) => material.item === task.item) ?? null,
      buffer: run.bufferFor(building.id, task.item) ?? null,
      state: task.status,
      fromPath: parsePath(task.path_from),
      toPath: parsePath(task.path_to),
      index: task.path_index,
      stateTicks: task.state_ticks,
      sectorId: carrier.sector_id,
      x: carrier.x,
      y: carrier.y,
      done: false
    });
  }
  if (runtimes.length === 0) return [];

  const events: EconomyEvent[] = [];
  const itemVolumes = new Map<string, number>();

  for (const runtime of runtimes) {
    const volume = (() => {
      const known = itemVolumes.get(runtime.task.item);
      if (known !== undefined) return known;
      const value = itemVolume(balance, runtime.task.item);
      itemVolumes.set(runtime.task.item, value);
      return value;
    })();

    {
      switch (runtime.state) {
        case 'queued':
        case 'reserved': {
          runtime.state = 'worker_to_source';
          runtime.index = 0;
          runtime.stateTicks = 0;
          // The old loop repeated the same tick (`tick -= 1`): take the step now.
          const step = stepWithRoads(
            runtime.fromPath,
            runtime.index,
            balance.carrier.moveTicksPerTile,
            region
          );
          runtime.index = step.index;
          const position = localizeGlobal(region, step.x, step.y);
          if (position) {
            runtime.sectorId = position.sectorId;
            runtime.x = position.x;
            runtime.y = position.y;
          }
          if (runtime.index >= runtime.fromPath.length - 1) {
            runtime.state = 'loading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'worker_to_source': {
          const step = stepWithRoads(
            runtime.fromPath,
            runtime.index,
            balance.carrier.moveTicksPerTile,
            region
          );
          runtime.index = step.index;
          const position = localizeGlobal(region, step.x, step.y);
          if (position) {
            runtime.sectorId = position.sectorId;
            runtime.x = position.x;
            runtime.y = position.y;
          }
          if (runtime.index >= runtime.fromPath.length - 1) {
            runtime.state = 'loading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'loading': {
          runtime.stateTicks += 1;
          if (runtime.stateTicks >= balance.carrier.loadTicks) {
            loadTransferSource(run, runtime, volume);
            moveRuntimeToPathEnd(runtime, runtime.fromPath, region);
            runtime.state = 'moving';
            runtime.index = 0;
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'moving': {
          const step = stepWithRoads(
            runtime.toPath,
            runtime.index,
            balance.carrier.moveTicksPerTile,
            region
          );
          runtime.index = step.index;
          const position = localizeGlobal(region, step.x, step.y);
          if (position) {
            runtime.sectorId = position.sectorId;
            runtime.x = position.x;
            runtime.y = position.y;
          }
          if (runtime.index >= runtime.toPath.length - 1) {
            runtime.state = 'unloading';
            runtime.stateTicks = 0;
          }
          break;
        }
        case 'unloading': {
          runtime.stateTicks += 1;
          if (runtime.stateTicks >= balance.carrier.unloadTicks) {
            unloadTransfer(run, runtime, volume, events);
            moveRuntimeToPathEnd(runtime, runtime.toPath, region);
            runtime.state = 'complete';
            runtime.done = true;
          }
          break;
        }
        default:
          runtime.done = true;
      }
    }

    const carrierId = runtime.task.carrier_id;
    runtime.task.status = runtime.done ? 'complete' : runtime.state;
    runtime.task.carrier_id = runtime.done ? null : runtime.task.carrier_id;
    runtime.task.path_index = runtime.index;
    runtime.task.state_ticks = runtime.stateTicks;

    const carrier = carrierId ? carrierById.get(carrierId) : undefined;
    if (carrier) {
      carrier.status = runtime.done ? 'idle' : 'hauling';
      carrier.sector_id = runtime.sectorId;
      carrier.x = runtime.x;
      carrier.y = runtime.y;
    }
  }

  return events;
}

function moveRuntimeToPathEnd(
  runtime: TransferRuntime,
  path: Array<[number, number]>,
  region: Region
): void {
  const endpoint = path[path.length - 1];
  if (!endpoint) return;
  const position = localizeGlobal(region, endpoint[0], endpoint[1]);
  if (!position) return;
  runtime.sectorId = position.sectorId;
  runtime.x = position.x;
  runtime.y = position.y;
}

function loadTransferSource(
  run: WorldRun,
  runtime: TransferRuntime,
  volume: number
): void {
  if (
    runtime.task.direction === 'to_building' ||
    runtime.task.direction === 'to_buffer'
  ) {
    const available = run.storageQty(runtime.storage.id, runtime.task.item);
    if (available < runtime.task.qty) {
      runtime.state = 'failed';
      runtime.done = true;
      return;
    }
    run.takeStorageItem(
      runtime.storage.id,
      runtime.task.item,
      runtime.task.qty,
      runtime.task.qty * volume
    );
    return;
  }

  if (runtime.task.direction === 'from_buffer') {
    const buffer = runtime.buffer;
    if (!buffer || buffer.qty < runtime.task.qty) {
      runtime.state = 'failed';
      runtime.done = true;
      return;
    }
    buffer.qty -= runtime.task.qty;
    return;
  }

  if (!runtime.material) {
    runtime.state = 'failed';
    runtime.done = true;
    return;
  }
  runtime.material.delivered = Math.max(
    0,
    runtime.material.delivered - runtime.task.qty
  );
}

function unloadTransfer(
  run: WorldRun,
  runtime: TransferRuntime,
  volume: number,
  events: EconomyEvent[]
): void {
  if (runtime.task.direction === 'to_buffer') {
    const existing = run.bufferFor(runtime.building.id, runtime.task.item);
    if (existing) {
      existing.qty += runtime.task.qty;
      runtime.buffer = existing;
    } else {
      const created = run.addBuffer(runtime.building.id, runtime.task.item, runtime.task.qty);
      runtime.buffer = created;
    }
    events.push({
      type: 'BufferDelivered',
      payload: {
        buildingId: runtime.building.id,
        item: runtime.task.item,
        qty: runtime.task.qty
      }
    });
    return;
  }

  if (runtime.task.direction === 'from_buffer') {
    run.addStorageItem(
      runtime.storage.id,
      runtime.task.item,
      runtime.task.qty,
      runtime.task.qty * volume
    );
    events.push({
      type: 'BufferStored',
      payload: {
        buildingId: runtime.building.id,
        item: runtime.task.item,
        qty: runtime.task.qty
      }
    });
    return;
  }

  if (runtime.task.direction === 'to_storage') {
    run.addStorageItem(
      runtime.storage.id,
      runtime.task.item,
      runtime.task.qty,
      runtime.task.qty * volume
    );
    events.push({
      type: 'SalvageStored',
      payload: {
        buildingId: runtime.building.id,
        item: runtime.task.item,
        qty: runtime.task.qty
      }
    });
    return;
  }

  if (!runtime.material) {
    runtime.state = 'failed';
    runtime.done = true;
    return;
  }
  const next = Math.min(
    runtime.material.required,
    runtime.material.delivered + runtime.task.qty
  );
  runtime.material.delivered = next;

  const complete = runtime.building.materials.every(
    (material) => material.delivered >= material.required
  );
  if (complete && runtime.building.status === 'awaiting_materials') {
    runtime.building.status = 'building';
    runtime.building.work_done = 0;
    events.push({
      type: 'BuildingMaterialsDelivered',
      payload: { buildingId: runtime.building.id, type: runtime.building.type }
    });
  }
}

export function advanceBuildings(run: WorldRun): EconomyEvent[] {
  const { balance, now } = run;
  const active = run.buildingsByStatus(['building', 'demolition']);
  if (active.length === 0) return [];

  const builders = run.laborers
    .filter((laborer) => laborer.role === 'builder')
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const idleBuilders = builders.filter((builder) => builder.status === 'idle');
  const events: EconomyEvent[] = [];

  for (const building of active) {
    let builder: LaborerTable | undefined;
    if (building.builder_id) {
      builder = builders.find((entry) => entry.id === building.builder_id);
    } else {
      builder = idleBuilders.shift();
      if (!builder) continue;
      building.builder_id = builder.id;
      builder.status = 'building';
      builder.sector_id = building.sector_id;
      builder.x = building.x;
      builder.y = building.y;
      builder.node_id = null;
      events.push({
        type: 'BuilderAssigned',
        payload: { buildingId: building.id, builderId: builder.id }
      });
    }
    if (!builder) continue;

    const workDone = Math.min(
      building.work_required,
      building.work_done + balance.buildRate
    );
    if (workDone < building.work_required) {
      building.work_done = workDone;
      continue;
    }

    if (building.status === 'building') {
      building.status = 'complete';
      building.work_done = building.work_required;
      building.builder_id = null;
      building.completed_at = now;
      builder.status = 'idle';
      builder.sector_id = building.sector_id;
      builder.x = building.x;
      builder.y = building.y;
      events.push({
        type: 'BuildingCompleted',
        payload: { buildingId: building.id, type: building.type, x: building.x, y: building.y }
      });
      events.push(
        ...awardLaborerXp(
          run,
          builder.id,
          balance.xp.xpPerTask,
          'build',
          balance.xp.levelThresholds
        )
      );
      continue;
    }

    building.status = 'demolished';
    building.work_done = building.work_required;
    building.builder_id = null;
    building.completed_at = now;
    builder.status = 'idle';
    builder.sector_id = building.sector_id;
    builder.x = building.x;
    builder.y = building.y;
    for (const material of building.materials) {
      material.delivered = Math.floor(material.delivered * balance.salvageRatio);
    }
    events.push({
      type: 'BuildingDemolished',
      payload: { buildingId: building.id, type: building.type, x: building.x, y: building.y }
    });
  }

  return events;
}

export function buildingTint(balance: WorldBalance, type: string): string {
  return balance.buildings[type]?.tint ?? '#8b7358';
}

export function buildingLabel(balance: WorldBalance, type: string): string {
  return balance.buildings[type]?.label ?? type;
}
