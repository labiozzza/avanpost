import { PeaceWorldSnapshotSchema, type PeaceWorldSnapshot, type PeaceResident } from '@avanpost/peace-v2-shared';
import { COPPICE_REGROWTH_TICKS, WOOD_REGROWTH_TICKS } from './settlement.js';
import { G33_STONE_BALANCE } from './g33-stone-config.js';

function resident(id: string, name: string, appearanceKey: string, x: number): PeaceResident {
  return {
    id, name, appearanceKey, position: { x, y: 0 }, facing: x < 0 ? 'right' : 'left',
    state: 'idle', workRole: 'none', visualState: 'idle', cargo: 0, cargoItemId: null, blockedReason: null, task: null,
    preferredStorageId: null, preferredHaulSourceId: null, createdAtTick: 0, arrivedAtTick: 0,
    civilianProfession: 'general_worker', civilianXp: 0, learningHistory: [], innateTraits: [],
    characteristics: { strength: 5, dexterity: 5, endurance: 5, intelligence: 5 },
    housingBuildingId: null, arrivalState: 'settled'
  };
}

/** Build a clean, deterministic V2-compatible starting settlement for a new account world. */
export function createInitialPeaceWorld(worldSeed: string, resources = { wood: 0, stone: 0 }): PeaceWorldSnapshot {
  if (!worldSeed.trim()) throw new Error('A unique world seed is required.');
  const storage = { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 100 };
  return PeaceWorldSnapshotSchema.parse({
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
    worldSeed,
    resources,
    storage,
    storages: [{
      ...storage, name: 'Склад', kind: 'warehouse',
      contents: resources, reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 },
      status: resources.wood + resources.stone >= storage.capacity ? 'full' : 'available', blockedReason: null
    }],
    trees: [
      { id: 'tree-1', name: 'Старая берёза', sourceKind: 'finite', position: { x: 3, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS },
      { id: 'tree-2', name: 'Восточная роща', sourceKind: 'finite', position: { x: 8, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS },
      { id: 'tree-3', name: 'Западный склон', sourceKind: 'finite', position: { x: -12, y: 0 }, remaining: 3,
        maxRemaining: 3, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: WOOD_REGROWTH_TICKS },
      { id: 'coppice-1', name: 'Возобновляемая поросль', sourceKind: 'renewable_plot', position: { x: 16, y: 0 }, remaining: 1,
        maxRemaining: 1, state: 'standing', regrowthProgressTicks: 0, regrowthEveryTicks: COPPICE_REGROWTH_TICKS }
    ],
    stoneDeposits: [{
      id: G33_STONE_BALANCE.stoneNode.id, name: 'Каменная жила', sourceKind: 'finite',
      position: { x: G33_STONE_BALANCE.stoneNode.dx, y: G33_STONE_BALANCE.stoneNode.dy },
      remaining: G33_STONE_BALANCE.stoneNode.initialAmount, maxRemaining: G33_STONE_BALANCE.stoneNode.initialAmount,
      bufferQuantity: 0, bufferCapacity: G33_STONE_BALANCE.stoneNode.bufferCapacity,
      yieldPerTick: G33_STONE_BALANCE.stoneNode.yieldPerTick, state: 'available'
    }],
    residents: [resident('worker-1', 'Илья', 'ilya', -3), resident('worker-2', 'Марья', 'maria', 14)],
    buildOrders: [], nextBuildOrderSequence: 1, buildings: []
  });
}
