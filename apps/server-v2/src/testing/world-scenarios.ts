import {
  PeaceWorldSnapshotSchema,
  type PeaceResident,
  type PeaceWorldSnapshot
} from '@avanpost/peace-v2-shared';
import {
  createBuildCabinOrder,
  createBuildWorkshopOrder,
  G33_STONE_BALANCE,
  WOOD_REGROWTH_TICKS,
  COPPICE_REGROWTH_TICKS,
  WOOD_UNLOADING_TICKS
} from '@avanpost/peace-v2-sim';

export const WORLD_SCENARIO_DESCRIPTIONS = {
  empty: 'Пустое поселение без запасов и доступных источников.',
  basic: 'Стартовый мир: два жителя, деревья, каменная залежь и пустой склад.',
  'resources-full': 'Полный склад, лесоруб с бревном и добытчик с камнем.',
  lumberjack: 'Свободный лесоруб с постоянной ролью.',
  'stone-mining': 'Добытчик камня и доступная залежь.',
  construction: 'Строитель, запас древесины и два ожидающих заказа.',
  'construction-role-transition': 'Два ожидающих заказа и житель без роли для ручной проверки назначения строителя.',
  'construction-blocked': 'Строитель ожидает недостающую древесину для заказа.',
  'logistics-deadlock': 'Полный склад, переносимые древесина и камень, заказ мастерской.',
  'multi-worker': 'Четыре жителя, два строителя и два конкурентных заказа.',
  'late-settlement': 'Три завершённых дома, мастерская и остаточные ресурсы.',
  'g4-multi-storage': 'Два физических склада, лесоруб, добытчик камня, носильщик и ожидающая мастерская.'
} as const;

export type WorldScenarioName = keyof typeof WORLD_SCENARIO_DESCRIPTIONS;

function resident(
  id: string,
  name: string,
  appearanceKey: string,
  position: number,
  workRole: PeaceResident['workRole'] = 'none'
): PeaceResident {
  return {
    id, name, appearanceKey, position: { x: position, y: 0 }, facing: position < 0 ? 'right' : 'left',
    state: 'idle', workRole, visualState: 'idle', cargo: 0, cargoItemId: null, blockedReason: null, task: null,
    preferredStorageId: null, preferredHaulSourceId: null
  };
}

function warehouse(id: string, name: string, anchorX: number, contents: { wood: number; stone: number }, capacity = 100) {
  return {
    id, name, kind: 'warehouse' as const, anchor: { x: anchorX, y: -1 }, footprint: { width: 2, height: 1 }, capacity,
    contents, reservedInbound: { wood: 0, stone: 0 }, reservedOutbound: { wood: 0, stone: 0 },
    status: contents.wood + contents.stone >= capacity ? 'full' as const : 'available' as const, blockedReason: null
  };
}

function baseWorld(resources = { wood: 0, stone: 0 }): PeaceWorldSnapshot {
  const storage = { id: 'storehouse-1', anchor: { x: -6, y: -1 }, footprint: { width: 2, height: 1 }, capacity: 100 };
  return PeaceWorldSnapshotSchema.parse({
    revision: { worldVersion: 1, geometryVersion: 1, serverTick: 0 },
    resources,
    storage,
    storages: [warehouse(storage.id, 'Склад', storage.anchor.x, resources, storage.capacity)],
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

function addCabin(world: PeaceWorldSnapshot, id: string, anchorX: number, queuePosition: number): void {
  const orderId = `${id}-order`;
  const created = createBuildCabinOrder(world, orderId, id, { x: anchorX, y: -1 }, queuePosition);
  if (!created) throw new Error(`Scenario cabin placement is invalid: ${id}`);
  world.buildOrders.push(created.order);
  world.buildings.push(created.building);
  world.nextBuildOrderSequence = Math.max(world.nextBuildOrderSequence, queuePosition + 1);
}

function addWorkshop(world: PeaceWorldSnapshot, id: string, anchorX: number, queuePosition: number): void {
  const orderId = `${id}-order`;
  const created = createBuildWorkshopOrder(world, orderId, id, { x: anchorX, y: -1 }, queuePosition);
  if (!created) throw new Error(`Scenario workshop placement is invalid: ${id}`);
  world.buildOrders.push(created.order);
  world.buildings.push(created.building);
  world.nextBuildOrderSequence = Math.max(world.nextBuildOrderSequence, queuePosition + 1);
}

function waitingWoodTask(id: string, sourceId: string, assignmentSource: 'manual' | 'profession') {
  return {
    id, kind: 'gather-wood' as const, phase: 'waiting_storage' as const, sourceId,
    destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0,
    requiredTicks: WOOD_UNLOADING_TICKS, blockedReason: 'STORAGE_FULL', continuous: false,
    cancelAfterDelivery: true, assignmentSource
  };
}

function waitingStoneTask(id: string) {
  return {
    id, kind: 'gather-stone' as const, phase: 'waiting_storage' as const, sourceId: G33_STONE_BALANCE.stoneNode.id,
    destinationId: 'storehouse-1', path: [], pathIndex: 0, progressTicks: 0,
    requiredTicks: WOOD_UNLOADING_TICKS, blockedReason: 'STORAGE_FULL', continuous: true,
    cancelAfterDelivery: false, assignmentSource: 'workRole' as const
  };
}

const builders: Record<WorldScenarioName, () => PeaceWorldSnapshot> = {
  empty: () => {
    const world = baseWorld();
    world.trees = world.trees.map((tree) => ({ ...tree, remaining: 0, state: 'uprooted', regrowthProgressTicks: 0 }));
    const deposit = world.stoneDeposits[0]!;
    deposit.remaining = 0;
    deposit.state = 'depleted';
    return PeaceWorldSnapshotSchema.parse(world);
  },
  basic: () => baseWorld(),
  'resources-full': () => {
    const world = baseWorld({ wood: 100, stone: 0 });
    world.residents[0] = {
      ...world.residents[0]!, workRole: 'builder', state: 'waiting', visualState: 'waiting_storage',
      cargo: 1, cargoItemId: 'wood', blockedReason: 'STORAGE_FULL', task: waitingWoodTask('full-store-builder-wood', 'tree-1', 'manual')
    };
    world.residents[1] = {
      ...world.residents[1]!, workRole: 'stone_miner', state: 'waiting', visualState: 'waiting_stone_storage',
      cargo: 18, cargoItemId: 'stone', blockedReason: 'STORAGE_FULL', task: waitingStoneTask('full-store-miner-stone')
    };
    return PeaceWorldSnapshotSchema.parse(world);
  },
  lumberjack: () => {
    const world = baseWorld();
    world.residents[0] = { ...world.residents[0]!, workRole: 'woodcutter' };
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'stone-mining': () => {
    const world = baseWorld();
    world.residents[0] = { ...world.residents[0]!, workRole: 'stone_miner' };
    return PeaceWorldSnapshotSchema.parse(world);
  },
  construction: () => {
    const world = baseWorld({ wood: 6, stone: 0 });
    world.residents[0] = { ...world.residents[0]!, workRole: 'builder' };
    addCabin(world, 'scenario-cabin-first', 0, 1);
    addCabin(world, 'scenario-cabin-second', 12, 2);
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'construction-role-transition': () => {
    const world = baseWorld({ wood: 6, stone: 0 });
    addCabin(world, 'scenario-role-cabin-first', 0, 1);
    addCabin(world, 'scenario-role-cabin-second', 12, 2);
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'construction-blocked': () => {
    const world = baseWorld({ wood: 0, stone: 0 });
    world.residents[0] = { ...world.residents[0]!, workRole: 'builder' };
    addCabin(world, 'scenario-cabin-blocked', 0, 1);
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'logistics-deadlock': () => {
    const world = baseWorld({ wood: 100, stone: 0 });
    world.residents[0] = {
      ...world.residents[0]!, workRole: 'builder', state: 'waiting', visualState: 'waiting_storage',
      cargo: 1, cargoItemId: 'wood', blockedReason: 'STORAGE_FULL', task: waitingWoodTask('deadlock-builder-wood', 'tree-1', 'profession')
    };
    world.residents[1] = {
      ...world.residents[1]!, workRole: 'stone_miner', state: 'waiting', visualState: 'waiting_stone_storage',
      cargo: 18, cargoItemId: 'stone', blockedReason: 'STORAGE_FULL', task: waitingStoneTask('deadlock-miner-stone')
    };
    addWorkshop(world, 'scenario-workshop-deadlock', 20, 1);
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'multi-worker': () => {
    const world = baseWorld({ wood: 6, stone: 0 });
    world.residents[0] = { ...world.residents[0]!, workRole: 'builder' };
    world.residents[1] = { ...world.residents[1]!, workRole: 'builder' };
    world.residents.push(
      resident('worker-3', 'Иван', 'ilya', -15, 'woodcutter'),
      resident('worker-4', 'Анна', 'maria', 18, 'stone_miner')
    );
    addCabin(world, 'scenario-multi-cabin-first', 0, 1);
    addCabin(world, 'scenario-multi-cabin-second', 12, 2);
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'g4-multi-storage': () => {
    const world = baseWorld({ wood: 16, stone: 0 });
    world.storage.capacity = 16;
    world.storages = [
      warehouse(world.storage.id, 'Главный склад', world.storage.anchor.x, { wood: 16, stone: 0 }, 16),
      warehouse('storehouse-2', 'Склад у рощи', 10, { wood: 0, stone: 0 }, 16)
    ];
    const westTree = world.trees.find((tree) => tree.id === 'tree-3')!;
    westTree.bufferQuantity = 3;
    westTree.bufferCapacity = 3;
    world.stoneDeposits[0]!.bufferQuantity = 6;
    world.residents[0] = { ...world.residents[0]!, workRole: 'woodcutter' };
    world.residents[1] = { ...world.residents[1]!, workRole: 'stone_miner' };
    world.residents.push(
      resident('worker-3', 'Иван', 'ilya', -15, 'hauler'),
      {
        ...resident('worker-4', 'Анна', 'maria', -22, 'builder'),
        state: 'waiting', visualState: 'waiting_storage', cargo: 1, cargoItemId: 'wood', blockedReason: 'STORAGE_FULL',
        task: {
          id: 'g4-builder-log-delivery', kind: 'gather-wood', phase: 'waiting_storage', sourceId: 'tree-1',
          destinationId: world.storage.id, path: [], pathIndex: 0, progressTicks: 0, requiredTicks: WOOD_UNLOADING_TICKS,
          blockedReason: 'STORAGE_FULL', continuous: false, cancelAfterDelivery: true, assignmentSource: 'manual'
        }
      }
    );
    addWorkshop(world, 'scenario-g4-workshop', 22, 1);
    return PeaceWorldSnapshotSchema.parse(world);
  },
  'late-settlement': () => {
    const world = baseWorld({ wood: 32, stone: 8 });
    addCabin(world, 'scenario-late-cabin-one', -22, 1);
    addCabin(world, 'scenario-late-cabin-two', -16, 2);
    addCabin(world, 'scenario-late-cabin-three', 20, 3);
    addWorkshop(world, 'scenario-late-workshop', 12, 4);
    for (const order of world.buildOrders) {
      order.status = 'completed';
      order.assignedResidentId = null;
      order.blockedReason = null;
      order.requiresExplicitBuilder = false;
    }
    for (const building of world.buildings) {
      building.state = 'complete';
      building.progressTicks = building.progressRequired;
    }
    return PeaceWorldSnapshotSchema.parse(world);
  }
};

export function listWorldScenarios(): WorldScenarioName[] {
  return Object.keys(builders) as WorldScenarioName[];
}

export function createWorldScenario(name: string): PeaceWorldSnapshot {
  if (!Object.hasOwn(builders, name)) throw new Error(`Unknown isolated-world scenario: ${name}`);
  return PeaceWorldSnapshotSchema.parse(builders[name as WorldScenarioName]());
}
