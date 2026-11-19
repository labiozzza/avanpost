export type Resource = 'wood' | 'stone';
export type BuildingKind = 'house' | 'warehouse';
export type WorkRole = 'idle' | 'woodcutter' | 'miner' | 'builder' | 'hauler';
export type ResidentMode = 'idle' | 'moving' | 'working' | 'carrying' | 'building' | 'blocked';
export type WoodSourceId = 'home' | 'eastern';
export type EasternSectorState = 'closed' | 'unlocked' | 'clearing' | 'prepared';
export type LogisticsMode = 'hauler' | 'independent';
export type LogisticsRequestType = 'PICKUP_RESOURCE' | 'DELIVER_TO_CONSTRUCTION';
export type LogisticsRequestStatus = 'queued' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
export type LandCellState = 'closed' | 'unlocked' | 'clearing' | 'prepared';
export type DevelopmentGoal =
  | 'build-first-house'
  | 'increase-storage'
  | 'unlock-eastern-sector'
  | 'prepare-eastern-sector'
  | 'build-in-eastern-sector'
  | 'settlement-growth';

export interface PrototypeResident {
  id: string;
  name: string;
  role: WorkRole;
  x: number;
  y: number;
  mode: ResidentMode;
  task: string;
  blockedReason: string | null;
  cargo: Resource | null;
  targetX: number | null;
  targetY: number | null;
  targetSiteId: string | null;
  /** Warehouse the resident is carrying a harvested resource to. */
  targetStoreId: string | null;
  /** Warehouse and resource reserved for a physical construction-material pickup. */
  pickupStoreId: string | null;
  pickupResource: Resource | null;
  pickupStockpileId: string | null;
  progress: number;
  woodSource: WoodSourceId;
  cargoAmount: number;
  pickupAmount: number;
  logisticsMode: LogisticsMode;
  logisticsRequestId: string | null;
}

export interface PrototypeStore {
  id: string;
  x: number;
  wood: number;
  stone: number;
  capacity: number;
}

export interface PrototypeBuilding {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
}

export interface PrototypeSite {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  deliveredWood: number;
  deliveredStone: number;
  progress: number;
  stage: number;
}

export interface PrototypeStockpile {
  id: string;
  sourceId: string;
  resource: Resource;
  x: number;
  amount: number;
  capacity: number;
}

export interface PrototypeLandCell {
  id: number;
  x: number;
  y: number;
  state: LandCellState;
  clearingProgress: number;
  clearingPaused: boolean;
  clearerId: string | null;
}

export interface PrototypeLogisticsRequest {
  id: string;
  sequence: number;
  createdAt: number;
  initiatorId: string;
  type: LogisticsRequestType;
  resource: Resource;
  amount: number;
  pickupStockpileId: string | null;
  pickupStoreId: string | null;
  destinationStoreId: string | null;
  destinationSiteId: string | null;
  status: LogisticsRequestStatus;
  assignedHaulerId: string | null;
}

export interface PrototypeEasternSector {
  state: EasternSectorState;
  clearingProgress: number;
  clearingPaused: boolean;
  clearerId: string | null;
  woodStock: number;
  woodRecoverySeconds: number;
}

export interface PrototypeWorld {
  version: 1;
  mapVersion?: number;
  elapsedSeconds: number;
  woodSource: number;
  stoneSource: number;
  woodSourceRecoverySeconds: number;
  stoneSourceRecoverySeconds: number;
  residents: PrototypeResident[];
  stores: PrototypeStore[];
  buildings: PrototypeBuilding[];
  sites: PrototypeSite[];
  occupiedPlots: number[];
  nextId: number;
  easternSector: PrototypeEasternSector;
  landCells: PrototypeLandCell[];
  easternForestAvailable: boolean;
  stockpiles: PrototypeStockpile[];
  logisticsRequests: PrototypeLogisticsRequest[];
  nextRequestSequence: number;
  currentGoal: DevelopmentGoal;
}

export const STORAGE_KEY = 'avanpost:gameplay-prototype:v01';
export const WORLD = { width: 3900, height: 1750, groundY: 600 };
const LEGACY_WORLD_WIDTH = 1960;
export const PLOTS = [
  { id: 0, x: 350, y: WORLD.groundY },
  { id: 1, x: 690, y: WORLD.groundY },
  { id: 2, x: 1240, y: WORLD.groundY },
  { id: 3, x: 1590, y: WORLD.groundY },
  { id: 4, x: 2380, y: WORLD.groundY },
  { id: 5, x: 2780, y: WORLD.groundY },
  { id: 6, x: 3140, y: WORLD.groundY },
  { id: 7, x: 3500, y: WORLD.groundY }
] as const;

/**
 * Experimental prototype balance only. These values are not approved GDD
 * balance; keep them centralized so later playtests can tune the slice.
 */
export const PROTOTYPE_CONFIG = {
  sourceRecovery: {
    homeWoodSecondsPerUnit: 180,
    stoneSecondsPerUnit: 240,
    homeWoodCapacity: 32,
    stoneCapacity: 30
  },
  easternSector: {
    boundaryX: 2040,
    clearingX: 2240,
    forestX: 3200,
    unlockCost: { wood: 8, stone: 5 },
    clearingWorkSeconds: 30,
    forestInitialStock: 12,
    forestCapacity: 20,
    forestSecondsPerUnit: 90
  },
  expansion: {
    unlockCost: { wood: 8, stone: 5 },
    clearingWorkSeconds: 30
  },
  stockpile: { capacity: 10, harvestSeconds: 3.1, carryCapacity: 10 }
} as const;

const COST: Record<BuildingKind, { wood: number; stone: number }> = {
  house: { wood: 6, stone: 5 },
  warehouse: { wood: 5, stone: 4 }
};
const ROLE_LABEL: Record<WorkRole, string> = {
  idle: 'Без дела', woodcutter: 'Лесоруб', miner: 'Каменщик', builder: 'Строитель', hauler: 'Грузчик'
};
const MODE_LABEL: Record<ResidentMode, string> = {
  idle: 'ждёт задачу', moving: 'идёт по маршруту', working: 'добывает', carrying: 'несёт груз',
  building: 'строит', blocked: 'ожидает'
};
const NEW_NAMES = ['Агата', 'Мирон', 'Лада', 'Тихон', 'Ярина'];

export const roleLabel = (role: WorkRole): string => ROLE_LABEL[role];
export const modeLabel = (mode: ResidentMode): string => MODE_LABEL[mode];
export const costOf = (kind: BuildingKind) => COST[kind];

function resident(id: string, name: string, x: number): PrototypeResident {
  return {
    id, name, role: 'idle', x, y: WORLD.groundY, mode: 'idle', task: 'Ждёт назначения',
    blockedReason: null, cargo: null, targetX: null, targetY: null, targetSiteId: null,
    targetStoreId: null, pickupStoreId: null, pickupResource: null, pickupStockpileId: null, progress: 0,
    woodSource: 'home', cargoAmount: 0, pickupAmount: 0,
    logisticsMode: 'hauler', logisticsRequestId: null
  };
}

function initialLandCells(): PrototypeLandCell[] {
  return PLOTS.map((plot) => ({
    id: plot.id, x: plot.x, y: plot.y,
    state: plot.id < 4 ? 'prepared' : 'closed',
    clearingProgress: plot.id < 4 ? 1 : 0,
    clearingPaused: false,
    clearerId: null
  }));
}

function initialStockpiles(): PrototypeStockpile[] {
  return [
    { id: 'pile-wood-home', sourceId: 'home', resource: 'wood', x: 420, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity },
    { id: 'pile-stone-main', sourceId: 'stone', resource: 'stone', x: 1700, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity },
    { id: 'pile-wood-eastern', sourceId: 'eastern', resource: 'wood', x: 3020, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity }
  ];
}

function hasStoreCapacity(store: PrototypeStore, incomingReservations = 0, amount = 1): boolean {
	return store.id !== 'store-under-construction' &&
		store.wood + store.stone + incomingReservations + amount <= store.capacity;
}

function nearestStoreWithCapacity(
	stores: PrototypeStore[],
	fromX: number,
	incomingReservations: (storeId: string) => number = () => 0,
	amount = 1
): PrototypeStore | undefined {
	return stores.filter((store) => hasStoreCapacity(store, incomingReservations(store.id), amount)).sort((a, b) =>
    Math.abs(a.x - fromX) - Math.abs(b.x - fromX) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )[0];
}

function emptyEasternSector(): PrototypeEasternSector {
  return {
    state: 'closed', clearingProgress: 0, clearingPaused: false, clearerId: null,
    woodStock: PROTOTYPE_CONFIG.easternSector.forestInitialStock, woodRecoverySeconds: 0
  };
}

export function createNewWorld(): PrototypeWorld {
  const world: PrototypeWorld = {
    version: 1,
    mapVersion: 1,
    elapsedSeconds: 0,
    woodSource: 32,
    stoneSource: 30,
    woodSourceRecoverySeconds: 0,
    stoneSourceRecoverySeconds: 0,
    // Keep the warehouse facade open at game start: two residents stand left
    // of its visible alpha bounds, the third to the right.
    residents: [resident('r1', 'Илья', 640), resident('r2', 'Мария', 760), resident('r3', 'Саша', 1180)],
    stores: [{ id: 'store-1', x: 963, wood: 3, stone: 2, capacity: 12 }],
    buildings: [],
    sites: [],
    occupiedPlots: [],
    nextId: 2,
    easternSector: emptyEasternSector(),
    landCells: initialLandCells(),
    easternForestAvailable: false,
    stockpiles: initialStockpiles(),
    logisticsRequests: [],
    nextRequestSequence: 1,
    currentGoal: 'build-first-house'
  };
  world.currentGoal = developmentGoal(world);
  return world;
}

export function parseSavedWorld(raw: string | null): PrototypeWorld | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const world = value as PrototypeWorld & { mapVersion?: number };
    if (world.version !== 1 || !Array.isArray(world.residents) || !Array.isArray(world.stores) ||
        !Array.isArray(world.buildings) || !Array.isArray(world.sites) || !Array.isArray(world.occupiedPlots) ||
        !Number.isFinite(world.woodSource) || !Number.isFinite(world.stoneSource)) return null;
    if (world.residents.length < 3 || world.residents.length > 8 ||
        world.residents.some((person) => !person.id || !Number.isFinite(person.x) ||
          !['idle', 'woodcutter', 'miner', 'builder', 'hauler'].includes(person.role) ||
          !['idle', 'moving', 'working', 'carrying', 'building', 'blocked'].includes(person.mode) ||
          (person.cargo !== undefined && person.cargo !== null && person.cargo !== 'wood' && person.cargo !== 'stone'))) return null;
    if (world.stores.some((store) => !store.id || !Number.isFinite(store.x) ||
          !Number.isFinite(store.wood) || !Number.isFinite(store.stone) ||
          !Number.isFinite(store.capacity) || store.capacity < 0 ||
          store.wood < 0 || store.stone < 0 || store.wood + store.stone > store.capacity)) return null;
    if (!Number.isFinite(world.nextId) || !Number.isFinite(world.elapsedSeconds)) return null;
    const migrated = world.mapVersion === 3
      ? world
      : world.mapVersion === 2
      ? migrateDepthMapSave(world)
      : world.mapVersion === 1
        ? world
        : world.mapVersion === undefined
          ? migrateSideViewSave(world)
          : null;
    return migrated ? migrateExpansionSave(migrated) : null;
  } catch {
    return null;
  }
}

function migrateSideViewSave(world: PrototypeWorld & { mapVersion?: number }): PrototypeWorld {
  const scaleX = (x: number): number => Math.round(x * 1.8);
  const oldPlots = [
    { id: 0, x: 300 },
    { id: 1, x: 420 },
    { id: 2, x: 680 },
    { id: 3, x: 810 }
  ];
  const mapX = (x: number): number => {
    const oldPlot = oldPlots.find((plot) => Math.abs(plot.x - x) < 1);
    return oldPlot ? PLOTS.find((plot) => plot.id === oldPlot.id)?.x ?? scaleX(x) : scaleX(x);
  };
  world.residents = world.residents.map((person) => ({
    ...person,
    x: scaleX(person.x),
    y: WORLD.groundY,
    targetX: person.targetX === null ? null : scaleX(person.targetX),
    targetY: person.targetY === null ? null : WORLD.groundY
  }));
  world.stores = world.stores.map((store) => ({ ...store, x: scaleX(store.x) }));
  world.buildings = world.buildings.map((building) => ({
    ...building, x: mapX(building.x), y: WORLD.groundY
  }));
  world.sites = world.sites.map((site) => ({
    ...site, x: mapX(site.x), y: WORLD.groundY
  }));
  world.mapVersion = 1;
  return world;
}

/**
 * Saves created by the rejected depth-map experiment used the same storage key.
 * Project their existing state onto the restored side-view scene without
 * dropping residents, resources, tasks, construction progress, or buildings.
 */
function migrateDepthMapSave(world: PrototypeWorld & { mapVersion?: number }): PrototypeWorld {
  const depthPlots = [
    { id: 0, x: 455, y: 700 },
    { id: 1, x: 638, y: 1050 },
    { id: 2, x: 1032, y: 720 },
    { id: 3, x: 1230, y: 1040 },
    { id: 4, x: 600, y: 1380 },
    { id: 5, x: 850, y: 1450 },
    { id: 6, x: 1080, y: 1330 },
    { id: 7, x: 1450, y: 1280 }
  ];
  const mapX = (x: number): number => Math.round(x * LEGACY_WORLD_WIDTH / 1700);
  const mapPlotX = (x: number, y: number): number => {
    const oldPlot = depthPlots.find((plot) => Math.abs(plot.x - x) < 1 && Math.abs(plot.y - y) < 1);
    return oldPlot && oldPlot.id < 4
      ? PLOTS.find((plot) => plot.id === oldPlot.id)?.x ?? mapX(x)
      : mapX(x);
  };

  world.residents = world.residents.map((person) => ({
    ...person,
    x: mapX(person.x),
    y: WORLD.groundY,
    targetX: person.targetX === null ? null : mapX(person.targetX),
    targetY: person.targetY === null ? null : WORLD.groundY
  }));
  world.stores = world.stores.map((store) => ({
    id: store.id,
    x: mapX(store.x),
    wood: store.wood,
    stone: store.stone,
    capacity: store.capacity
  }));
  world.buildings = world.buildings.map((building) => ({
    ...building,
    x: mapPlotX(building.x, building.y),
    y: WORLD.groundY
  }));
  world.sites = world.sites.map((site) => ({
    ...site,
    x: mapPlotX(site.x, site.y),
    y: WORLD.groundY
  }));
  // The old depth-map experiment had eight plot IDs. IDs 4+ now mean the new
  // eastern plots, so preserve only converted structures near the four
  // original build locations rather than accidentally occupying new land.
  const occupied = new Set(world.occupiedPlots.filter((plotId) => plotId >= 0 && plotId < 4));
  for (const structure of [...world.buildings, ...world.sites]) {
    const plot = PLOTS.find((candidate) => candidate.id < 4 && Math.abs(candidate.x - structure.x) < 90);
    if (plot) occupied.add(plot.id);
  }
  world.occupiedPlots = [...occupied];
  world.mapVersion = 1;
  return world;
}

function developmentGoal(world: PrototypeWorld): DevelopmentGoal {
  if (!world.buildings.some((building) => building.kind === 'house')) return 'build-first-house';
  const capacity = world.stores.reduce((sum, store) => sum + store.capacity, 0);
  if (capacity < 24) return 'increase-storage';
  const next = frontierLandCell(world);
  if (!next || next.state === 'closed') return 'unlock-eastern-sector';
  if (next.state !== 'prepared') return 'prepare-eastern-sector';
  return 'build-in-eastern-sector';
}

function frontierLandCell(world: PrototypeWorld): PrototypeLandCell | undefined {
  return world.landCells?.filter((cell) => cell.id >= 4).sort((a, b) => a.id - b.id)
    .find((cell) => cell.state !== 'prepared');
}

function syncLegacySector(world: PrototypeWorld): void {
  const frontier = frontierLandCell(world);
  const lastPrepared = world.landCells.filter((cell) => cell.id >= 4 && cell.state === 'prepared')
    .sort((a, b) => b.id - a.id)[0];
  const source = frontier ?? lastPrepared;
  if (!source) return;
  world.easternSector.state = source.state;
  world.easternSector.clearingProgress = source.clearingProgress;
  world.easternSector.clearingPaused = source.clearingPaused;
  world.easternSector.clearerId = source.clearerId;
}

function migrateExpansionSave(world: PrototypeWorld): PrototypeWorld {
  const legacy = world as PrototypeWorld & Partial<Pick<
    PrototypeWorld,
    'woodSourceRecoverySeconds' | 'stoneSourceRecoverySeconds' | 'easternSector' | 'currentGoal'
  >>;
  const savedSector = legacy.easternSector;
  const state: EasternSectorState = savedSector &&
      ['closed', 'unlocked', 'clearing', 'prepared'].includes(savedSector.state)
    ? savedSector.state
    : 'closed';
  const requestedClearerId = typeof savedSector?.clearerId === 'string' ? savedSector.clearerId : null;
  const savedClearer = requestedClearerId
    ? world.residents.find((person) => person.id === requestedClearerId)
    : undefined;
  const savedClearerCanWork = Boolean(savedClearer &&
    (savedClearer.role === 'builder' || savedClearer.role === 'idle') && !savedClearer.cargo);
  const savedClearerId = savedClearer ? requestedClearerId : null;
  const sector: PrototypeEasternSector = {
    state,
    clearingProgress: state === 'prepared'
      ? 1
      : Math.min(1, Math.max(0, Number.isFinite(savedSector?.clearingProgress)
        ? savedSector.clearingProgress : 0)),
    clearingPaused: state === 'clearing'
      ? Boolean(savedSector?.clearingPaused) || !savedClearerCanWork
      : false,
    clearerId: state === 'prepared' ? null : savedClearerId,
    woodStock: Math.min(
      PROTOTYPE_CONFIG.easternSector.forestCapacity,
      Math.max(0, Number.isFinite(savedSector?.woodStock)
        ? savedSector.woodStock : PROTOTYPE_CONFIG.easternSector.forestInitialStock)
    ),
    woodRecoverySeconds: Math.min(
      PROTOTYPE_CONFIG.easternSector.forestSecondsPerUnit,
      Math.max(0, Number.isFinite(savedSector?.woodRecoverySeconds) ? savedSector.woodRecoverySeconds : 0)
    )
  };
  const restored: PrototypeWorld = {
    ...legacy,
    woodSourceRecoverySeconds: Math.max(0, Number.isFinite(legacy.woodSourceRecoverySeconds)
      ? legacy.woodSourceRecoverySeconds! : 0),
    stoneSourceRecoverySeconds: Math.max(0, Number.isFinite(legacy.stoneSourceRecoverySeconds)
      ? legacy.stoneSourceRecoverySeconds! : 0),
    residents: legacy.residents.map((person) => ({
      ...person,
      cargo: person.cargo === 'wood' || person.cargo === 'stone' ? person.cargo : null,
      cargoAmount: Math.max(0, Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity,
        Number.isFinite((person as PrototypeResident).cargoAmount)
          ? (person as PrototypeResident).cargoAmount
          : person.cargo ? 1 : 0)),
      pickupAmount: Math.max(0, Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity,
        Number.isFinite((person as PrototypeResident).pickupAmount)
          ? (person as PrototypeResident).pickupAmount
          : person.pickupResource ? 1 : 0)),
      targetStoreId: typeof person.targetStoreId === 'string' ? person.targetStoreId : null,
      pickupStoreId: typeof person.pickupStoreId === 'string' ? person.pickupStoreId : null,
      pickupResource: person.pickupResource === 'wood' || person.pickupResource === 'stone'
        ? person.pickupResource : null,
      pickupStockpileId: typeof (person as PrototypeResident).pickupStockpileId === 'string'
        ? (person as PrototypeResident).pickupStockpileId : null,
      woodSource: person.woodSource === 'eastern' ? 'eastern' : 'home',
      logisticsMode: (person as PrototypeResident).logisticsMode === 'independent' ? 'independent' : 'hauler',
      logisticsRequestId: typeof (person as PrototypeResident).logisticsRequestId === 'string'
        ? (person as PrototypeResident).logisticsRequestId : null
    })),
    easternSector: sector,
    landCells: migrateLandCells(legacy, sector),
    easternForestAvailable: typeof (legacy as PrototypeWorld).easternForestAvailable === 'boolean'
      ? (legacy as PrototypeWorld).easternForestAvailable
      : sector.state === 'prepared',
    stockpiles: migrateStockpiles(legacy),
    logisticsRequests: migrateLogisticsRequests(legacy),
    nextRequestSequence: Math.max(1, Number.isFinite((legacy as PrototypeWorld).nextRequestSequence)
      ? (legacy as PrototypeWorld).nextRequestSequence : 1),
    currentGoal: 'build-first-house'
  };
  restored.mapVersion = 3;
  restoreLogisticsRequests(restored);
  restoreLogisticsRoutes(restored);
  restored.currentGoal = developmentGoal(restored);
  return restored;
}

function migrateLandCells(world: PrototypeWorld, savedSector: PrototypeEasternSector): PrototypeLandCell[] {
  const migrated = initialLandCells();
  const savedCells = (world as PrototypeWorld).landCells;
  if (Array.isArray(savedCells)) {
    for (const cell of savedCells) {
      const target = migrated.find((candidate) => candidate.id === cell.id);
      if (target && ['closed', 'unlocked', 'clearing', 'prepared'].includes(cell.state)) {
        Object.assign(target, {
          ...cell,
          x: target.x,
          y: target.y,
          clearingProgress: Math.max(0, Math.min(1, Number(cell.clearingProgress) || 0)),
          clearingPaused: Boolean(cell.clearingPaused),
          clearerId: typeof cell.clearerId === 'string' ? cell.clearerId : null
        });
      }
    }
  } else {
    // A prepared legacy sector exposed exactly two plots. Preserve both for old saves.
    if (savedSector.state === 'prepared') {
      for (const cell of migrated.filter((candidate) => candidate.id === 4 || candidate.id === 5)) {
        cell.state = 'prepared';
        cell.clearingProgress = 1;
      }
    } else if (savedSector.state !== 'closed') {
      const cell = migrated.find((candidate) => candidate.id === 4)!;
      cell.state = savedSector.state;
      cell.clearingProgress = savedSector.clearingProgress;
      cell.clearingPaused = savedSector.clearingPaused;
      cell.clearerId = savedSector.clearerId;
    }
  }
  const occupiedIds = new Set(world.occupiedPlots);
  for (const structure of [...world.buildings, ...world.sites]) {
    const candidate = PLOTS.find((plot) => Math.abs(plot.x - structure.x) < 90);
    if (candidate) occupiedIds.add(candidate.id);
  }
  for (const cell of migrated) {
    if (cell.id < 4 || occupiedIds.has(cell.id)) {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
  }
  // Remove unreachable openings from old data; open cells must form a connected prefix.
  let connected = true;
  for (const cell of migrated.filter((candidate) => candidate.id >= 4).sort((a, b) => a.id - b.id)) {
    if (!connected) {
      if (!occupiedIds.has(cell.id)) {
        cell.state = 'closed'; cell.clearingProgress = 0; cell.clearingPaused = false; cell.clearerId = null;
      }
    } else if (cell.state !== 'prepared') {
      connected = false;
    }
  }
  return migrated;
}

function migrateStockpiles(world: PrototypeWorld): PrototypeStockpile[] {
  const saved = (world as PrototypeWorld).stockpiles;
  if (Array.isArray(saved)) {
    return initialStockpiles().map((fallback) => {
      const pile = saved.find((candidate) => candidate.id === fallback.id);
      return pile ? {
        ...fallback,
        amount: Math.max(0, Math.min(fallback.capacity, Number(pile.amount) || 0))
      } : fallback;
    });
  }
  return initialStockpiles();
}

function migrateLogisticsRequests(world: PrototypeWorld): PrototypeLogisticsRequest[] {
  const saved = (world as PrototypeWorld).logisticsRequests;
  if (!Array.isArray(saved)) return [];
  return saved.filter((request) => request && typeof request.id === 'string' &&
    ['PICKUP_RESOURCE', 'DELIVER_TO_CONSTRUCTION'].includes(request.type) &&
    ['wood', 'stone'].includes(request.resource) &&
    ['queued', 'assigned', 'in_progress', 'completed', 'cancelled', 'blocked'].includes(request.status))
    .map((request) => ({
      ...request,
      amount: Math.max(1, Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity, Number(request.amount) || 1)),
      assignedHaulerId: typeof request.assignedHaulerId === 'string' ? request.assignedHaulerId : null
    }));
}

function restoreLogisticsRequests(world: PrototypeWorld): void {
  const residents = new Map(world.residents.map((person) => [person.id, person]));
  const haulers = new Set(world.residents.filter((person) => person.role === 'hauler').map((person) => person.id));
  for (const request of world.logisticsRequests) {
    if (request.status === 'completed' || request.status === 'cancelled') continue;
    if (!request.initiatorId || !residents.has(request.initiatorId)) {
      request.status = 'cancelled'; request.assignedHaulerId = null; continue;
    }
    const assigned = request.assignedHaulerId ? residents.get(request.assignedHaulerId) : undefined;
    if (request.assignedHaulerId && (!assigned ||
        assigned.logisticsRequestId !== request.id || (!haulers.has(request.assignedHaulerId) && !assigned.cargo))) {
      request.assignedHaulerId = null;
      request.status = 'queued';
    }
  }
  for (const person of world.residents) {
    if (person.logisticsRequestId && !world.logisticsRequests.some((request) =>
      request.id === person.logisticsRequestId && request.assignedHaulerId === person.id)) {
      person.logisticsRequestId = null;
    }
  }
}

/** Restore saved routes without changing resources or discarding an in-flight load. */
function restoreLogisticsRoutes(world: PrototypeWorld): void {
	const incomingByStore = new Map<string, number>();
	const reserveIncoming = (storeId: string) => {
		incomingByStore.set(storeId, (incomingByStore.get(storeId) ?? 0) + 1);
	};
	const incomingReservations = (storeId: string) => incomingByStore.get(storeId) ?? 0;

  for (const person of world.residents) {
    const site = person.targetSiteId
      ? world.sites.find((candidate) => candidate.id === person.targetSiteId)
      : undefined;
    if (person.cargo) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      if (site) {
        person.targetSiteId = site.id;
        person.targetStoreId = null;
        person.targetX = site.x;
        person.targetY = WORLD.groundY;
        person.mode = 'carrying';
        person.task = 'Продолжает доставку на площадку';
        person.blockedReason = null;
        continue;
      }

      person.targetSiteId = null;
		const savedDestination = person.targetStoreId
			? world.stores.find((store) =>
				store.id === person.targetStoreId && hasStoreCapacity(store, incomingReservations(store.id)))
        : undefined;
		const destination = savedDestination ??
			nearestStoreWithCapacity(world.stores, person.x, incomingReservations);
      if (destination) {
			reserveIncoming(destination.id);
        person.targetStoreId = destination.id;
        person.targetX = destination.x;
        person.targetY = WORLD.groundY;
        person.mode = 'carrying';
        person.task = 'Продолжает доставку на склад';
        person.blockedReason = null;
      } else {
        person.targetStoreId = null;
        person.targetX = null;
        person.targetY = null;
        person.mode = 'blocked';
        person.blockedReason = 'Все склады заполнены. Построй ещё один склад или освободи место.';
        person.task = person.blockedReason;
      }
      continue;
    }

    person.targetStoreId = null;
    const pickup = person.pickupStoreId
      ? world.stores.find((store) => store.id === person.pickupStoreId)
      : undefined;
    if (site && pickup && person.pickupResource) {
      person.targetSiteId = site.id;
      person.targetX = pickup.x;
      person.targetY = WORLD.groundY;
      person.mode = 'moving';
      person.task = 'Идёт за грузом на склад';
      person.blockedReason = null;
    } else {
      person.pickupStoreId = null;
      person.pickupResource = null;
      if (!site) person.targetSiteId = null;
    }
  }
}

export class PrototypeSimulation {
  constructor(public world: PrototypeWorld, private readonly onChange: (message?: string) => void = () => {}) {
    if (!Array.isArray(world.landCells)) world.landCells = initialLandCells();
    if (!Array.isArray(world.stockpiles)) world.stockpiles = initialStockpiles();
    if (!Array.isArray(world.logisticsRequests)) world.logisticsRequests = [];
    if (!Number.isFinite(world.nextRequestSequence)) world.nextRequestSequence = 1;
    // Compatibility for callers loading a v0.7 world directly instead of through parseSavedWorld.
    if (world.easternSector?.state === 'prepared' &&
        !world.landCells.some((cell) => cell.id >= 4 && cell.state === 'prepared')) {
      for (const id of [4, 5]) {
        const cell = world.landCells.find((candidate) => candidate.id === id);
        if (cell) { cell.state = 'prepared'; cell.clearingProgress = 1; }
      }
    } else if (world.easternSector && world.easternSector.state !== 'closed') {
      const cell = world.landCells.find((candidate) => candidate.id === 4);
      if (cell && cell.state === 'closed') {
        cell.state = world.easternSector.state;
        cell.clearingProgress = world.easternSector.clearingProgress;
        cell.clearingPaused = world.easternSector.clearingPaused;
        cell.clearerId = world.easternSector.clearerId;
      }
    }
    if (world.easternSector?.state === 'prepared') world.easternForestAvailable = true;
    if (world.easternForestAvailable !== true) world.easternForestAvailable = false;
    syncLegacySector(world);
    restoreLogisticsRequests(world);
  }

  assign(residentId: string, role: WorkRole): boolean {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person) return false;
    if (person.role !== role) {
      const clearingCell = this.world.landCells.find((cell) => cell.clearerId === residentId && cell.state === 'clearing');
      if (clearingCell) clearingCell.clearingPaused = true;
    }
    if (person.role === 'hauler' && role !== 'hauler' && person.logisticsRequestId && !person.cargo) {
      const request = this.requestById(person.logisticsRequestId);
      if (request && request.status !== 'completed') {
        request.status = 'queued';
        request.assignedHaulerId = null;
      }
      person.logisticsRequestId = null;
    }
    person.role = role;
    person.blockedReason = null;
    person.progress = 0;
    if (person.cargo) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      const site = person.targetSiteId
        ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId)
        : undefined;
      if (site) {
        person.targetSiteId = site.id;
        person.targetStoreId = null;
        person.mode = 'carrying';
        person.task = 'Доставляет материал на площадку';
        person.targetX = site.x;
        person.targetY = WORLD.groundY;
      } else {
        person.targetSiteId = null;
        this.routeCargoToStore(person);
      }
    } else {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.pickupStockpileId = null;
      person.pickupAmount = 0;
      person.targetStoreId = null;
      person.mode = 'idle';
      person.task = role === 'idle' ? 'Ждёт назначения' : `${ROLE_LABEL[role]}: готовится к работе`;
      person.targetSiteId = null;
      person.targetX = null;
      person.targetY = null;
    }
    this.syncDevelopmentGoal();
    this.onChange(`${person.name}: ${ROLE_LABEL[role]}`);
    return true;
  }

  setLogisticsMode(residentId: string, mode: LogisticsMode): boolean {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person || person.role === 'idle' || person.role === 'hauler') return false;
    if (person.logisticsMode === mode) return true;
    person.logisticsMode = mode;
    if (mode === 'independent') {
      for (const request of this.world.logisticsRequests) {
        if (request.initiatorId !== person.id || !['queued', 'blocked', 'assigned'].includes(request.status)) continue;
        const hauler = request.assignedHaulerId
          ? this.world.residents.find((candidate) => candidate.id === request.assignedHaulerId)
          : undefined;
        request.status = 'cancelled';
        request.assignedHaulerId = null;
        if (hauler && !hauler.cargo && hauler.logisticsRequestId === request.id) {
          hauler.logisticsRequestId = null;
          hauler.pickupStockpileId = null;
          hauler.pickupStoreId = null;
          hauler.pickupResource = null;
          hauler.pickupAmount = 0;
          hauler.targetX = null;
          hauler.targetY = null;
          hauler.targetSiteId = null;
          hauler.targetStoreId = null;
          hauler.mode = 'idle';
          hauler.task = 'Заявка отменена';
        }
      }
    }
    this.onChange(`${person.name}: ${mode === 'hauler' ? 'использует грузчика' : 'работает самостоятельно'}.`);
    return true;
  }

  setWoodSource(residentId: string, source: WoodSourceId): { ok: true } | { ok: false; reason: string } {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person) return { ok: false, reason: 'Житель не найден.' };
    if (source === 'eastern' && !this.hasEasternForest()) {
      return { ok: false, reason: 'Сначала подготовь Восточную опушку.' };
    }
    person.woodSource = source;
    if (person.role === 'woodcutter' && !person.cargo) {
      person.mode = 'idle';
      person.task = source === 'eastern' ? 'Идёт к лесу Восточной опушки' : 'Идёт к лесу поселения';
      person.blockedReason = null;
      person.targetX = null;
      person.targetY = null;
    }
    this.onChange(source === 'eastern'
      ? `${person.name} будет добывать лес на Восточной опушке.`
      : `${person.name} возвращается к лесу поселения.`);
    return { ok: true };
  }

  unlockEasternSector(): { ok: true } | { ok: false; reason: string } {
    const cell = frontierLandCell(this.world);
    if (!cell || cell.state !== 'closed') return { ok: false, reason: 'Нет соседней закрытой клетки для открытия.' };
    if (!this.world.buildings.some((building) => building.kind === 'house')) {
      return { ok: false, reason: 'Сначала построй первый дом.' };
    }
    const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
    const availableWood = this.spendableResource('wood');
    const availableStone = this.spendableResource('stone');
    if (availableWood < cost.wood || availableStone < cost.stone) {
      const missing: string[] = [];
      if (availableWood < cost.wood) missing.push(`дерева ${availableWood}/${cost.wood}`);
      if (availableStone < cost.stone) missing.push(`камня ${availableStone}/${cost.stone}`);
      return { ok: false, reason: `Не хватает на открытие: ${missing.join(', ')}.` };
    }
    this.spendFromStores('wood', cost.wood);
    this.spendFromStores('stone', cost.stone);
    cell.state = 'unlocked';
    cell.clearingProgress = 0;
    cell.clearingPaused = false;
    cell.clearerId = null;
    syncLegacySector(this.world);
    this.syncDevelopmentGoal();
    this.onChange(`Открыта земельная клетка ${cell.id + 1}. Она примыкает к поселению; дальше потребуется отдельная расчистка.`);
    return { ok: true };
  }

  startEasternClearing(): { ok: true } | { ok: false; reason: string } {
    const cell = this.world.landCells.find((candidate) => candidate.state === 'unlocked' ||
      candidate.state === 'clearing' && candidate.clearingPaused);
    if (!cell) return { ok: false, reason: 'Сначала отдельно открой соседнюю земельную клетку.' };
    if (!this.world.buildings.some((building) => building.kind === 'house')) {
      return { ok: false, reason: 'Сначала построй первый дом.' };
    }
    if (cell.state === 'clearing' && !cell.clearingPaused) {
      return { ok: true };
    }

    const assigned = cell.clearerId
      ? this.world.residents.find((person) => person.id === cell.clearerId)
      : undefined;
    const eligible = (person: PrototypeResident): boolean =>
      (person.role === 'builder' || person.role === 'idle') &&
      !person.cargo && (person.mode === 'idle' || person.mode === 'blocked');
    const worker = assigned && eligible(assigned)
      ? assigned
      : this.world.residents.find((person) => person.role === 'builder' && eligible(person)) ??
        this.world.residents.find((person) => person.role === 'idle' && eligible(person));
    if (!worker) {
      return { ok: false, reason: 'Нужен свободный строитель или житель без работы.' };
    }

    cell.state = 'clearing';
    cell.clearerId = worker.id;
    cell.clearingPaused = false;
    worker.targetSiteId = null;
    worker.targetX = cell.x;
    worker.targetY = WORLD.groundY;
    worker.blockedReason = null;
    worker.progress = 0;
    if (Math.abs(worker.x - cell.x) <= 1) {
      worker.x = cell.x;
      worker.mode = 'working';
      worker.task = 'Расчищает Восточную опушку';
    } else {
      worker.mode = 'moving';
      worker.task = 'Идёт расчищать Восточную опушку';
    }
    syncLegacySector(this.world);
    this.syncDevelopmentGoal();
    this.onChange(`${worker.name} направлен расчищать земельную клетку ${cell.id + 1}.`);
    return { ok: true };
  }

  isPlotAvailable(plotId: number): boolean {
    const cell = this.world.landCells.find((candidate) => candidate.id === plotId);
    return Boolean(cell && cell.state === 'prepared' && !this.world.occupiedPlots.includes(plotId));
  }

  place(kind: BuildingKind, plotId: number): { ok: true } | { ok: false; reason: string } {
    const plot = PLOTS.find((candidate) => candidate.id === plotId);
    if (!plot) return { ok: false, reason: 'Выбери отмеченное место на карте.' };
    if (this.world.occupiedPlots.includes(plotId)) return { ok: false, reason: 'Это место уже занято.' };
    if (!this.isPlotAvailable(plotId)) {
      const cell = this.world.landCells.find((candidate) => candidate.id === plotId);
      return {
        ok: false,
        reason: cell?.state === 'closed'
          ? 'Эта клетка закрыта лесом. Сначала открой соседнюю территорию.'
          : 'Сначала полностью расчисти эту клетку.'
      };
    }
    if (this.world.sites.length >= 2) return { ok: false, reason: 'Сначала заверши или отмени одну из площадок.' };
    const id = `site-${this.world.nextId++}`;
    this.world.occupiedPlots.push(plotId);
    this.world.sites.push({
      id, kind, x: plot.x, y: plot.y, deliveredWood: 0, deliveredStone: 0, progress: 0, stage: 0
    });
    this.syncDevelopmentGoal();
    this.onChange(kind === 'house' ? 'Площадка дома готова. Назначь строителя и добывай материалы.' : 'Площадка склада готова. Строитель доставит материалы.');
    return { ok: true };
  }

  cancelSite(siteId: string): boolean {
    const index = this.world.sites.findIndex((site) => site.id === siteId);
    if (index < 0) return false;
    const [site] = this.world.sites.splice(index, 1);
    const plotId = PLOTS.find((plot) => plot.x === site!.x)?.id;
    if (plotId !== undefined) this.world.occupiedPlots = this.world.occupiedPlots.filter((id) => id !== plotId);
    for (const person of this.world.residents) {
      if (person.targetSiteId !== siteId) continue;
      person.targetSiteId = null;
      if (person.cargo) {
        this.routeCargoToStore(person);
      } else {
        person.pickupStoreId = null;
        person.pickupResource = null;
        person.mode = 'idle';
        person.task = 'Площадка отменена';
        person.targetX = null;
        person.targetY = null;
        person.targetStoreId = null;
        person.blockedReason = null;
      }
    }
    this.syncDevelopmentGoal();
    this.onChange('Стройка отменена. Доставленные материалы остались на площадке.');
    return true;
  }

  step(deltaSeconds: number): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.world.elapsedSeconds += dt;
    this.recoverSources(dt);
    this.refreshLogisticsRequests();
    for (const person of this.world.residents) this.updateResident(person, dt);
    this.assignLogisticsRequests();
    syncLegacySector(this.world);
    this.syncDevelopmentGoal();
  }

  logisticsQueueFor(residentId: string): PrototypeLogisticsRequest[] {
    return this.world.logisticsRequests.filter((request) => request.status === 'queued' ||
      request.status === 'assigned' || request.status === 'in_progress' || request.status === 'blocked')
      .sort((a, b) => a.sequence - b.sequence)
      .filter((request) => request.initiatorId === residentId || request.assignedHaulerId === residentId);
  }

  totals() {
    const storedWood = this.world.stores.reduce((sum, store) => sum + store.wood, 0);
    const storedStone = this.world.stores.reduce((sum, store) => sum + store.stone, 0);
    const pileWood = this.world.stockpiles.filter((pile) => pile.resource === 'wood').reduce((sum, pile) => sum + pile.amount, 0);
    const pileStone = this.world.stockpiles.filter((pile) => pile.resource === 'stone').reduce((sum, pile) => sum + pile.amount, 0);
    const carriedWood = this.world.residents.filter((person) => person.cargo === 'wood').reduce((sum, person) => sum + person.cargoAmount, 0);
    const carriedStone = this.world.residents.filter((person) => person.cargo === 'stone').reduce((sum, person) => sum + person.cargoAmount, 0);
    const wood = storedWood + pileWood + carriedWood;
    const stone = storedStone + pileStone + carriedStone;
    const capacity = this.world.stores.reduce((sum, store) => sum + store.capacity, 0);
    const housing = 3 + this.world.buildings.filter((building) => building.kind === 'house').length;
    return { wood, stone, capacity, stored: storedWood + storedStone, population: this.world.residents.length, housing };
  }

  availableInStores(resource: Resource): number {
    return this.spendableResource(resource);
  }

  private syncDevelopmentGoal(): void {
    syncLegacySector(this.world);
    this.world.currentGoal = developmentGoal(this.world);
  }

  private requestById(id: string | null): PrototypeLogisticsRequest | undefined {
    return id ? this.world.logisticsRequests.find((request) => request.id === id) : undefined;
  }

  private hasHaulers(): boolean {
    return this.world.residents.some((person) => person.role === 'hauler');
  }

  hasEasternForest(): boolean {
    return this.world.easternForestAvailable || this.world.landCells.some((cell) => cell.id === 6 && cell.state === 'prepared');
  }

  private delegatesToHauler(person: PrototypeResident): boolean {
    return person.logisticsMode === 'hauler' && this.hasHaulers();
  }

  private activeRequestFor(predicate: (request: PrototypeLogisticsRequest) => boolean): PrototypeLogisticsRequest | undefined {
    return this.world.logisticsRequests.find((request) => predicate(request) &&
      ['queued', 'assigned', 'in_progress', 'blocked'].includes(request.status));
  }

  private refreshLogisticsRequests(): void {
    if (!this.hasHaulers()) {
      for (const request of this.world.logisticsRequests) {
        if (request.status === 'queued' || request.status === 'blocked') request.status = 'cancelled';
      }
    }
    for (const person of this.world.residents) {
      if (!this.delegatesToHauler(person)) continue;
      if (person.role === 'woodcutter' || person.role === 'miner') {
        const pile = this.stockpileFor(person);
        if (pile.amount > 0) this.createStockpileRequest(person, pile);
      } else if (person.role === 'builder') {
        const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId) ??
          this.world.sites.find((candidate) => !this.siteHasAllMaterials(candidate));
        if (site) {
          for (const resource of ['wood', 'stone'] as const) {
            if (!this.siteHasResource(site, resource)) this.createConstructionRequest(person, site, resource);
          }
        }
      }
    }
  }

  private assignLogisticsRequests(): void {
    for (const request of this.world.logisticsRequests) {
      if (request.type !== 'PICKUP_RESOURCE' ||
          (request.status !== 'queued' && request.status !== 'blocked') ||
          !request.destinationStoreId) continue;
      const store = this.world.stores.find((candidate) => candidate.id === request.destinationStoreId);
      const availableSpace = store
        ? store.capacity - store.wood - store.stone -
          this.reservedInboundCapacity(store.id, undefined, request.id)
        : 0;
      if (availableSpace < 1) request.destinationStoreId = null;
    }

    for (const hauler of this.world.residents.filter((person) => person.role === 'hauler')) {
      if (hauler.logisticsRequestId) {
        const active = this.requestById(hauler.logisticsRequestId);
        if (active && active.assignedHaulerId === hauler.id && active.status !== 'completed' && active.status !== 'cancelled') continue;
        hauler.logisticsRequestId = null;
      }
      if (hauler.cargo) continue;
      const available = this.world.logisticsRequests.filter((request) =>
        request.assignedHaulerId === null &&
        (request.status === 'queued' || request.status === 'blocked' && this.requestReady(request)) &&
        this.requestReady(request))
        .sort((a, b) => {
          const priorityA = a.type === 'DELIVER_TO_CONSTRUCTION' ? 0 : 1;
          const priorityB = b.type === 'DELIVER_TO_CONSTRUCTION' ? 0 : 1;
          return priorityA - priorityB || a.sequence - b.sequence;
        });
      const request = available[0];
      if (!request) continue;
      if (request.type === 'PICKUP_RESOURCE' && !request.destinationStoreId) {
        const pileX = request.pickupStockpileId
          ? this.world.stockpiles.find((pile) => pile.id === request.pickupStockpileId)?.x ?? 0
          : 0;
        request.destinationStoreId = nearestStoreWithCapacity(this.world.stores, pileX,
          (storeId) => this.reservedInboundCapacity(storeId))?.id ?? null;
      }
      if (request.type === 'PICKUP_RESOURCE' && request.destinationStoreId) {
        const store = this.world.stores.find((candidate) => candidate.id === request.destinationStoreId);
        const pile = this.world.stockpiles.find((candidate) => candidate.id === request.pickupStockpileId);
        if (store && pile) {
          const space = Math.max(0, store.capacity - store.wood - store.stone -
            this.reservedInboundCapacity(store.id, undefined, request.id));
          const pileAvailable = Math.max(0, pile.amount - this.reservedStockpileAmount(pile.id, request.id));
          request.amount = Math.min(request.amount, space, pileAvailable,
            PROTOTYPE_CONFIG.stockpile.carryCapacity);
        }
      }
      request.status = 'assigned';
      request.assignedHaulerId = hauler.id;
      hauler.logisticsRequestId = request.id;
      hauler.targetSiteId = request.destinationSiteId;
      hauler.targetStoreId = request.destinationStoreId;
      hauler.targetX = request.pickupStockpileId
        ? this.world.stockpiles.find((pile) => pile.id === request.pickupStockpileId)?.x ?? null
        : request.pickupStoreId
          ? this.world.stores.find((store) => store.id === request.pickupStoreId)?.x ?? null
          : null;
      hauler.targetY = WORLD.groundY;
      hauler.mode = 'moving';
      hauler.task = request.type === 'DELIVER_TO_CONSTRUCTION'
        ? `Идёт за ${request.resource === 'wood' ? 'деревом' : 'камнем'} для стройки`
        : `Идёт за ${request.resource === 'wood' ? 'деревом' : 'камнем'} у источника`;
      hauler.blockedReason = null;
      hauler.pickupAmount = request.amount;
      hauler.pickupResource = request.resource;
      hauler.pickupStockpileId = request.pickupStockpileId;
      hauler.pickupStoreId = request.pickupStoreId;
    }
  }

  private requestReady(request: PrototypeLogisticsRequest): boolean {
    if (request.type === 'PICKUP_RESOURCE') {
      const pile = request.pickupStockpileId
        ? this.world.stockpiles.find((candidate) => candidate.id === request.pickupStockpileId)
        : undefined;
      const store = request.destinationStoreId
        ? this.world.stores.find((candidate) => candidate.id === request.destinationStoreId)
        : nearestStoreWithCapacity(this.world.stores, pile?.x ?? 0, (storeId) => this.reservedInboundCapacity(storeId));
      if (!pile || !store) return false;
      const residentReservations = this.world.residents.filter((person) => !person.logisticsRequestId &&
        person.cargo && !person.targetSiteId && person.targetStoreId === store.id)
        .reduce((sum, person) => sum + Math.max(1, person.cargoAmount), 0);
      const otherRequests = this.world.logisticsRequests.filter((candidate) => candidate.id !== request.id &&
        candidate.type === 'PICKUP_RESOURCE' && candidate.destinationStoreId === store.id &&
        ['queued', 'assigned', 'in_progress', 'blocked'].includes(candidate.status))
        .reduce((sum, candidate) => sum + candidate.amount, 0);
      return pile.amount > this.reservedStockpileAmount(pile.id, request.id) &&
        store.wood + store.stone + residentReservations + otherRequests < store.capacity;
    }
    const site = request.destinationSiteId
      ? this.world.sites.find((candidate) => candidate.id === request.destinationSiteId)
      : undefined;
    const sourceStore = request.pickupStoreId
      ? this.world.stores.find((candidate) => candidate.id === request.pickupStoreId)
      : undefined;
    const pile = request.pickupStockpileId
      ? this.world.stockpiles.find((candidate) => candidate.id === request.pickupStockpileId)
      : undefined;
    const residentPickups = sourceStore ? this.world.residents.filter((person) => !person.logisticsRequestId &&
      person.pickupStoreId === sourceStore.id && person.pickupResource === request.resource)
      .reduce((sum, person) => sum + Math.max(1, person.pickupAmount), 0) : 0;
    const otherRequestPickups = sourceStore ? this.world.logisticsRequests.filter((candidate) => candidate.id !== request.id &&
      candidate.pickupStoreId === sourceStore.id && candidate.resource === request.resource &&
      ['queued', 'assigned', 'in_progress', 'blocked'].includes(candidate.status))
      .reduce((sum, candidate) => sum + candidate.amount, 0) : 0;
    return Boolean(site && (sourceStore && sourceStore[request.resource] > residentPickups + otherRequestPickups ||
      pile && pile.amount > this.reservedStockpileAmount(pile.id, request.id)));
  }

  private reservedStockpileAmount(pileId: string, exceptRequestId?: string, exceptResidentId?: string): number {
    const requestReservations = this.world.logisticsRequests.filter((request) => request.id !== exceptRequestId &&
      request.pickupStockpileId === pileId && ['queued', 'assigned', 'in_progress', 'blocked'].includes(request.status))
      .reduce((sum, request) => sum + request.amount, 0);
    const residentReservations = this.world.residents.filter((person) => person.id !== exceptResidentId &&
      !person.logisticsRequestId && person.pickupStockpileId === pileId)
      .reduce((sum, person) => sum + Math.max(1, person.pickupAmount), 0);
    return requestReservations + residentReservations;
  }

  private makeRequest(input: Omit<PrototypeLogisticsRequest, 'id' | 'sequence' | 'createdAt' | 'status' | 'assignedHaulerId'>): PrototypeLogisticsRequest {
    const request: PrototypeLogisticsRequest = {
      ...input,
      id: `logistics-${this.world.nextRequestSequence}`,
      sequence: this.world.nextRequestSequence++,
      createdAt: this.world.elapsedSeconds,
      status: 'queued',
      assignedHaulerId: null
    };
    if (!this.requestReady(request)) request.status = 'blocked';
    this.world.logisticsRequests.push(request);
    return request;
  }

  private createStockpileRequest(initiator: PrototypeResident, pile: PrototypeStockpile): void {
    const active = this.activeRequestFor((request) => request.type === 'PICKUP_RESOURCE' &&
      request.initiatorId === initiator.id && request.pickupStockpileId === pile.id);
    if (active) {
      if (active.status === 'queued' || active.status === 'blocked' || active.status === 'assigned') {
        const otherReserved = this.reservedStockpileAmount(pile.id, active.id);
        const store = active.destinationStoreId
          ? this.world.stores.find((candidate) => candidate.id === active.destinationStoreId)
          : undefined;
        const freeStoreSpace = store
          ? Math.max(0, store.capacity - store.wood - store.stone -
            this.reservedInboundCapacity(store.id, undefined, active.id))
          : PROTOTYPE_CONFIG.stockpile.carryCapacity;
        active.amount = Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity,
          Math.max(active.amount, pile.amount - otherReserved), freeStoreSpace || active.amount);
        const hauler = active.assignedHaulerId
          ? this.world.residents.find((candidate) => candidate.id === active.assignedHaulerId)
          : undefined;
        if (hauler && !hauler.cargo) hauler.pickupAmount = active.amount;
        if (active.status === 'blocked' && this.requestReady(active)) active.status = 'queued';
      }
      return;
    }
    const available = pile.amount - this.reservedStockpileAmount(pile.id);
    if (available < 1) return;
    const store = nearestStoreWithCapacity(this.world.stores, pile.x,
      (storeId) => this.reservedInboundCapacity(storeId));
    this.makeRequest({
      initiatorId: initiator.id,
      type: 'PICKUP_RESOURCE',
      resource: pile.resource,
      amount: Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity, available),
      pickupStockpileId: pile.id,
      pickupStoreId: null,
      destinationStoreId: store?.id ?? null,
      destinationSiteId: null
    });
  }

  private createConstructionRequest(initiator: PrototypeResident, site: PrototypeSite, resource: Resource): void {
    const active = this.activeRequestFor((request) => request.type === 'DELIVER_TO_CONSTRUCTION' &&
      request.initiatorId === initiator.id && request.destinationSiteId === site.id && request.resource === resource);
    if (active) return;
    const need = this.costOfSite(site, resource) - this.siteDelivered(site, resource) - this.reservedForSite(site.id, resource);
    if (need < 1) return;
    const stores = this.world.stores.filter((store) => store[resource] > this.reservedPickups(store.id, resource))
      .sort((a, b) => Math.abs(a.x - site.x) - Math.abs(b.x - site.x));
    const piles = this.world.stockpiles.filter((pile) => pile.resource === resource &&
      pile.amount > this.reservedStockpileAmount(pile.id))
      .sort((a, b) => Math.abs(a.x - site.x) - Math.abs(b.x - site.x));
    const store = stores[0];
    const pile = store ? undefined : piles[0];
    const available = store
      ? store[resource] - this.reservedPickups(store.id, resource)
      : pile ? pile.amount - this.reservedStockpileAmount(pile.id) : 0;
    if (available < 1) return;
    this.makeRequest({
      initiatorId: initiator.id,
      type: 'DELIVER_TO_CONSTRUCTION',
      resource,
      amount: Math.min(need, available, PROTOTYPE_CONFIG.stockpile.carryCapacity),
      pickupStockpileId: pile?.id ?? null,
      pickupStoreId: store?.id ?? null,
      destinationStoreId: null,
      destinationSiteId: site.id
    });
  }

  private costOfSite(site: PrototypeSite, resource: Resource): number {
    return COST[site.kind][resource];
  }

  private siteDelivered(site: PrototypeSite, resource: Resource): number {
    return resource === 'wood' ? site.deliveredWood : site.deliveredStone;
  }

  private siteHasResource(site: PrototypeSite, resource: Resource): boolean {
    return this.siteDelivered(site, resource) + this.reservedForSite(site.id, resource) >= this.costOfSite(site, resource);
  }

  private spendFromStores(resource: Resource, amount: number): void {
    let remaining = amount;
    for (const store of this.world.stores) {
      const availableInStore = Math.max(0, store[resource] - this.reservedPickups(store.id, resource));
      const available = Math.min(availableInStore, remaining);
      store[resource] -= available;
      remaining -= available;
      if (remaining <= 0) return;
    }
  }

  private spendableResource(resource: Resource): number {
    return this.world.stores.reduce((sum, store) =>
      sum + Math.max(0, store[resource] - this.reservedPickups(store.id, resource)), 0);
  }

  private reservedPickups(storeId: string, resource: Resource, exceptResidentId?: string): number {
    const residentReservations = this.world.residents.filter((person) => person.id !== exceptResidentId &&
      !person.logisticsRequestId && person.pickupStoreId === storeId && person.pickupResource === resource)
      .reduce((sum, person) => sum + Math.max(1, person.pickupAmount), 0);
    const requestReservations = this.world.logisticsRequests.filter((request) =>
      request.pickupStoreId === storeId && request.resource === resource &&
      ['queued', 'assigned', 'in_progress', 'blocked'].includes(request.status))
      .reduce((sum, request) => sum + request.amount, 0);
    return residentReservations + requestReservations;
  }

  private reservedForSite(siteId: string, resource: Resource): number {
    const residentReservations = this.world.residents.filter((person) => person.targetSiteId === siteId &&
      !person.logisticsRequestId && (person.cargo === resource || person.pickupResource === resource))
      .reduce((sum, person) => sum + (person.cargo === resource ? Math.max(1, person.cargoAmount) : Math.max(1, person.pickupAmount)), 0);
    const requestReservations = this.world.logisticsRequests.filter((request) =>
      request.destinationSiteId === siteId && request.resource === resource &&
      ['queued', 'assigned', 'in_progress', 'blocked'].includes(request.status))
      .reduce((sum, request) => sum + request.amount, 0);
    return residentReservations + requestReservations;
  }

	private reservedInboundCapacity(storeId: string, exceptResidentId?: string, exceptRequestId?: string): number {
		const residentReservations = this.world.residents.filter((person) => person.id !== exceptResidentId &&
			!person.logisticsRequestId && person.cargo !== null && person.targetSiteId === null && person.targetStoreId === storeId)
			.reduce((sum, person) => sum + Math.max(1, person.cargoAmount), 0);
		const requestReservations = this.world.logisticsRequests.filter((request) => request.type === 'PICKUP_RESOURCE' &&
			request.id !== exceptRequestId && request.destinationStoreId === storeId &&
			['queued', 'assigned', 'in_progress', 'blocked'].includes(request.status))
			.reduce((sum, request) => sum + request.amount, 0);
		return residentReservations + requestReservations;
	}

	private hasCapacityForDelivery(
		store: PrototypeStore, exceptResidentId?: string, exceptRequestId?: string, amount = 1
	): boolean {
		return hasStoreCapacity(store, this.reservedInboundCapacity(store.id, exceptResidentId, exceptRequestId), amount);
	}

  private recoverSources(dt: number): void {
    const recover = (
      stock: number,
      recoverySeconds: number,
      capacity: number,
      secondsPerUnit: number
    ): { stock: number; recoverySeconds: number } => {
      if (stock >= capacity) return { stock: capacity, recoverySeconds: 0 };
      const accrued = recoverySeconds + dt;
      const recovered = Math.floor(accrued / secondsPerUnit);
      const nextStock = Math.min(capacity, stock + recovered);
      return {
        stock: nextStock,
        recoverySeconds: nextStock >= capacity ? 0 : accrued - recovered * secondsPerUnit
      };
    };
    const homeWood = recover(
      this.world.woodSource, this.world.woodSourceRecoverySeconds,
      PROTOTYPE_CONFIG.sourceRecovery.homeWoodCapacity,
      PROTOTYPE_CONFIG.sourceRecovery.homeWoodSecondsPerUnit
    );
    this.world.woodSource = homeWood.stock;
    this.world.woodSourceRecoverySeconds = homeWood.recoverySeconds;

    const stone = recover(
      this.world.stoneSource, this.world.stoneSourceRecoverySeconds,
      PROTOTYPE_CONFIG.sourceRecovery.stoneCapacity,
      PROTOTYPE_CONFIG.sourceRecovery.stoneSecondsPerUnit
    );
    this.world.stoneSource = stone.stock;
    this.world.stoneSourceRecoverySeconds = stone.recoverySeconds;

    const sector = this.world.easternSector;
    if (!this.hasEasternForest()) {
      sector.woodRecoverySeconds = 0;
      return;
    }
    const easternWood = recover(
      sector.woodStock, sector.woodRecoverySeconds,
      PROTOTYPE_CONFIG.easternSector.forestCapacity,
      PROTOTYPE_CONFIG.easternSector.forestSecondsPerUnit
    );
    sector.woodStock = easternWood.stock;
    sector.woodRecoverySeconds = easternWood.recoverySeconds;
  }

  private isActiveClearingWorker(person: PrototypeResident): boolean {
    return this.world.landCells.some((cell) => cell.state === 'clearing' && !cell.clearingPaused &&
      cell.clearerId === person.id) && !person.cargo &&
      (person.role === 'builder' || person.role === 'idle');
  }

  private updateClearingWorker(person: PrototypeResident, dt: number): void {
    const cell = this.world.landCells.find((candidate) => candidate.clearerId === person.id && candidate.state === 'clearing');
    if (!cell) return;
    if (person.role !== 'builder' && person.role !== 'idle') {
      cell.clearingPaused = true;
      syncLegacySector(this.world);
      return;
    }
    if (person.cargo) return;

    const targetX = cell.x;
    const distance = Math.abs(targetX - person.x);
    if (distance > 1) {
      const movement = 140.4 * dt;
      person.targetX = targetX;
      person.targetY = WORLD.groundY;
      person.mode = 'moving';
      person.task = 'Идёт расчищать Восточную опушку';
      if (distance <= movement) person.x = targetX;
      else person.x += Math.sign(targetX - person.x) * movement;
      return;
    }

    person.x = targetX;
    person.targetX = targetX;
    person.targetY = WORLD.groundY;
    person.mode = 'working';
    person.task = `Расчищает клетку ${cell.id + 1} · ${Math.round(cell.clearingProgress * 100)}%`;
    person.progress += dt;
    cell.clearingProgress = Math.min(1, cell.clearingProgress + dt / PROTOTYPE_CONFIG.expansion.clearingWorkSeconds);
    if (cell.clearingProgress >= 1) {
      cell.state = 'prepared';
      cell.clearerId = null;
      cell.clearingPaused = false;
      person.mode = 'idle';
      person.task = `Клетка ${cell.id + 1} расчищена`;
      person.targetX = null;
      person.targetY = null;
      person.progress = 0;
      if (cell.id === 6) this.world.easternForestAvailable = true;
      syncLegacySector(this.world);
      this.syncDevelopmentGoal();
      this.onChange(`Клетка ${cell.id + 1} подготовлена: открыта ровно одна строительная площадка.`);
    }
  }

  private updateResident(person: PrototypeResident, dt: number): void {
    if (this.isActiveClearingWorker(person)) {
      this.updateClearingWorker(person, dt);
      return;
    }
    if (person.role === 'hauler') {
      this.updateHauler(person, dt);
      return;
    }
    if (person.cargo && !this.ensureCargoDestination(person)) return;
    if (person.mode === 'blocked') {
      if (person.cargo) this.tryResumeCargo(person);
      else if (person.role === 'builder') this.planDelivery(person);
      else if (person.role === 'woodcutter' || person.role === 'miner') this.planHarvest(person);
      return;
    }
    if (person.mode === 'moving' || person.mode === 'carrying') {
      if (person.targetX === null) { person.mode = 'idle'; return; }
      const dx = person.targetX - person.x;
      const distance = Math.abs(dx);
      // World coordinates are enlarged for readable art; preserve the existing
      // travel time by applying the same coordinate-space scale to movement.
      const movement = 140.4 * dt;
      if (distance <= movement) {
        person.x = person.targetX;
        if (person.pickupStockpileId && !person.cargo) this.arriveAtStockpilePickup(person);
        else if (person.pickupStoreId && !person.cargo) this.arriveAtPickup(person);
        else if (person.cargo) this.arriveAtDestination(person);
        else if (person.role === 'builder' && person.targetSiteId) {
          const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId);
          if (site && this.siteHasAllMaterials(site)) {
            person.mode = 'building';
            person.progress = 0;
            person.task = 'Начинает строительство';
          } else {
            person.mode = 'idle';
            person.task = 'Ждёт материалы';
          }
        }
        else {
          person.mode = 'working';
          person.progress = 0;
          person.task = person.role === 'woodcutter' ? 'Рубит дерево' : person.role === 'miner' ? 'Добывает камень' : 'Осматривает площадку';
        }
      } else {
        person.x += Math.sign(dx) * movement;
      }
      return;
    }
    if (person.mode === 'working') {
      person.progress += dt;
      if (person.progress >= 3.1) this.finishHarvest(person);
      return;
    }
    if (person.mode === 'building') {
      const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId);
      if (!site) { person.mode = 'idle'; person.task = 'Ждёт площадку'; return; }
      person.progress += dt;
      site.progress = Math.min(1, site.progress + dt / 36);
      site.stage = Math.min(2, Math.floor(site.progress * 3));
      person.task = `Строит: этап ${site.stage + 1} из 3`;
      if (site.progress >= 1) this.completeBuilding(site);
      return;
    }
    if (person.mode === 'idle') {
      if (person.cargo) { this.tryResumeCargo(person); return; }
      if (person.role === 'woodcutter' || person.role === 'miner') this.planHarvest(person);
      else if (person.role === 'builder') this.planDelivery(person);
    }
  }

  private planHarvest(person: PrototypeResident): void {
    const wood = person.role === 'woodcutter';
    const easternWood = wood && person.woodSource === 'eastern';
    if (easternWood && !this.hasEasternForest()) {
      person.mode = 'blocked';
      person.blockedReason = 'Восточный лес станет доступен после подготовки территории.';
      person.task = person.blockedReason;
      return;
    }
    const pile = this.stockpileFor(person);
    if (!this.delegatesToHauler(person) && pile.amount > 0) {
      person.pickupStockpileId = pile.id;
      person.pickupAmount = Math.min(pile.amount, PROTOTYPE_CONFIG.stockpile.carryCapacity);
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.targetSiteId = null;
      person.targetStoreId = null;
      person.targetX = pile.x;
      person.targetY = WORLD.groundY;
      person.mode = 'moving';
      person.task = `Идёт забрать ${person.pickupAmount} ед. ${wood ? 'древесины' : 'камня'} у источника`;
      person.blockedReason = null;
      return;
    }
    if (pile.amount >= pile.capacity) {
      person.mode = 'blocked';
      person.blockedReason = `${wood ? 'Древесина' : 'Камень'} у источника: ${pile.amount}/${pile.capacity}. Ждёт вывоза.`;
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      return;
    }
    const remaining = wood
      ? easternWood ? this.world.easternSector.woodStock : this.world.woodSource
      : this.world.stoneSource;
    if (remaining <= 0) {
      person.mode = 'blocked';
      person.blockedReason = easternWood
        ? 'Запас Восточной опушки исчерпан; лес медленно восстанавливается.'
        : wood ? 'Лесной участок выработан; базовый запас медленно восстанавливается.'
          : 'Каменный выход выработан; базовый запас медленно восстанавливается.';
      person.task = person.blockedReason; return;
    }
    const targetX = wood
      ? easternWood ? PROTOTYPE_CONFIG.easternSector.forestX : 234
      : 1900;
    person.mode = 'moving'; person.targetX = targetX; person.targetY = WORLD.groundY;
    person.task = easternWood ? 'Идёт к лесу Восточной опушки' : wood ? 'Идёт к лесу' : 'Идёт к каменному выходу';
    person.blockedReason = null;
  }

  private stockpileFor(person: PrototypeResident): PrototypeStockpile {
    const sourceId = person.role === 'miner' ? 'stone' : person.woodSource;
    return this.world.stockpiles.find((pile) => pile.sourceId === sourceId) ?? this.world.stockpiles[0]!;
  }

  private finishHarvest(person: PrototypeResident): void {
    const item: Resource = person.role === 'woodcutter' ? 'wood' : 'stone';
    const easternWood = item === 'wood' && person.woodSource === 'eastern';
    const pile = this.stockpileFor(person);
    if (pile.amount >= pile.capacity) {
      person.mode = 'blocked';
      person.blockedReason = `Куча заполнена: ${pile.amount}/${pile.capacity}.`;
      person.task = person.blockedReason;
      return;
    }
    if (easternWood && this.hasEasternForest() && this.world.easternSector.woodStock > 0) {
      this.world.easternSector.woodStock--;
    } else if (item === 'wood' && !easternWood && this.world.woodSource > 0) {
      this.world.woodSource--;
    } else if (item === 'stone' && this.world.stoneSource > 0) {
      this.world.stoneSource--;
    }
    else { person.mode = 'idle'; return; }
    pile.amount = Math.min(pile.capacity, pile.amount + 1);
    person.progress = 0;
    if (this.delegatesToHauler(person)) {
      this.createStockpileRequest(person, pile);
      person.mode = pile.amount >= pile.capacity ? 'blocked' : 'working';
      person.task = pile.amount >= pile.capacity ? 'Ждёт, пока грузчик освободит кучу.' :
        `${item === 'wood' ? 'Добывает древесину' : 'Добывает камень'} · куча ${pile.amount}/${pile.capacity}`;
      person.blockedReason = pile.amount >= pile.capacity ? person.task : null;
      return;
    }
    person.cargo = item;
    person.cargoAmount = pile.amount;
    pile.amount = 0;
    person.targetSiteId = null;
    person.targetStoreId = null;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.pickupStockpileId = null;
    person.progress = 0;
    if (!this.routeCargoToStore(person)) {
      this.onChange(person.blockedReason ?? 'Все склады заполнены. Построй ещё один склад или освободи место.');
      return;
    }
    const sourceName = easternWood ? ' на Восточной опушке' : '';
    this.onChange(`${person.name} собрал ${person.cargoAmount} ${item === 'wood' ? 'ед. древесины' : 'ед. камня'}${sourceName} и несёт на склад.`);
  }

  private planDelivery(person: PrototypeResident): void {
    const site = this.world.sites.find((candidate) => {
      const needsMaterials = !this.siteHasAllMaterials(candidate);
      return needsMaterials || (person.role === 'builder' && this.siteHasAllMaterials(candidate) && candidate.progress < 1);
    });
    if (!site) {
      person.mode = 'idle';
      person.task = 'Нет активных строительных заказов';
      person.blockedReason = null;
      person.targetSiteId = null;
      person.targetStoreId = null;
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.targetX = null;
      person.targetY = null;
      return;
    }
    person.blockedReason = null;
    person.targetSiteId = site.id;
    person.targetStoreId = null;
    if (this.siteHasAllMaterials(site)) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.pickupStockpileId = null;
      person.pickupAmount = 0;
      if (person.role === 'builder') {
        person.mode = 'moving'; person.targetX = site.x; person.targetY = WORLD.groundY; person.task = 'Идёт к стройке';
      } else {
        person.mode = 'idle'; person.task = 'Материалы доставлены; нужен строитель';
        person.targetSiteId = null;
        person.targetX = null;
        person.targetY = null;
      }
      return;
    }
    const needs: Resource[] = [];
    const cost = COST[site.kind];
    if (!this.siteHasResource(site, 'wood')) needs.push('wood');
    if (!this.siteHasResource(site, 'stone')) needs.push('stone');
    const item = needs.find((resource) => this.world.stores.some((store) =>
      store.id !== 'store-under-construction' && store[resource] > this.reservedPickups(store.id, resource)) ||
      this.world.stockpiles.some((pile) => pile.resource === resource &&
        pile.amount > this.reservedStockpileAmount(pile.id)));
    if (!item) {
      const missing = needs.map((resource) => resource === 'wood' ? 'дерева' : 'камня').join(' и ');
      person.mode = 'blocked';
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = `Не хватает ${missing}. Назначь лесоруба или каменщика.`;
      person.task = person.blockedReason;
      return;
    }
    if (this.delegatesToHauler(person)) {
      for (const resource of needs) this.createConstructionRequest(person, site, resource);
      person.mode = 'blocked';
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = 'Ожидает грузчика с материалами';
      person.task = person.blockedReason;
      return;
    }
    const store = this.findStoreForPickup(item, person.x);
    const pile = store ? undefined : this.world.stockpiles.filter((candidate) => candidate.resource === item &&
      candidate.amount > this.reservedStockpileAmount(candidate.id))
      .sort((a, b) => Math.abs(a.x - person.x) - Math.abs(b.x - person.x))[0];
    if (!store && !pile) {
      const missing = item === 'wood' ? 'дерева' : 'камня';
      person.mode = 'blocked'; person.targetX = null; person.targetY = null;
      person.blockedReason = `Не хватает ${missing}. Назначь добытчика.`;
      person.task = person.blockedReason;
      return;
    }
    person.cargo = null;
    person.cargoAmount = 0;
    person.pickupStoreId = store?.id ?? null;
    person.pickupResource = item;
    person.pickupStockpileId = pile?.id ?? null;
    const available = store
      ? store[item] - this.reservedPickups(store.id, item)
      : pile!.amount - this.reservedStockpileAmount(pile!.id);
    person.pickupAmount = Math.min(needs.includes(item) ? cost[item] - this.siteDelivered(site, item) -
      this.reservedForSite(site.id, item) : 0, available, PROTOTYPE_CONFIG.stockpile.carryCapacity);
    person.mode = 'moving';
    person.targetX = store?.x ?? pile!.x;
    person.targetY = WORLD.groundY;
    person.task = store
      ? `Идёт за ${person.pickupAmount} ед. ${item === 'wood' ? 'дерева' : 'камня'} на склад`
      : `Идёт за ${person.pickupAmount} ед. у местной кучи`;
  }

  private tryResumeCargo(person: PrototypeResident): void {
    if (!person.cargo) return;
    if (!this.ensureCargoDestination(person)) return;
    const site = person.targetSiteId
      ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId)
      : undefined;
    person.mode = 'carrying';
    person.targetX = site?.x ?? this.world.stores.find((store) => store.id === person.targetStoreId)!.x;
    person.targetY = WORLD.groundY;
    person.task = site ? 'Продолжает доставку на площадку' : 'Продолжает доставку на склад';
    person.blockedReason = null;
  }

  private updateHauler(person: PrototypeResident, dt: number): void {
    const request = this.requestById(person.logisticsRequestId);
    if (!request || request.assignedHaulerId !== person.id || request.status === 'completed' || request.status === 'cancelled') {
      if (person.cargo) {
        if (!this.ensureCargoDestination(person)) return;
        this.moveResidentTowardTarget(person, dt);
        return;
      }
      person.logisticsRequestId = null;
      person.mode = 'idle';
      person.task = 'Ждёт заявки';
      this.clearHaulerRoute(person);
      return;
    }
    if (person.cargo) {
      if (!this.ensureCargoDestination(person)) {
        request.status = 'blocked';
        request.assignedHaulerId = person.id;
        person.mode = 'blocked';
        return;
      }
      request.status = 'in_progress';
      this.moveResidentTowardTarget(person, dt);
      return;
    }
    if (!this.requestReady(request)) {
      request.status = 'blocked';
      request.assignedHaulerId = null;
      person.logisticsRequestId = null;
      person.mode = 'idle';
      person.task = 'Заявка временно заблокирована; ищет другое задание';
      this.clearHaulerRoute(person);
      return;
    }
    const targetX = request.pickupStockpileId
      ? this.world.stockpiles.find((pile) => pile.id === request.pickupStockpileId)?.x
      : request.pickupStoreId
        ? this.world.stores.find((store) => store.id === request.pickupStoreId)?.x
        : undefined;
    if (targetX === undefined) {
      request.status = 'blocked';
      request.assignedHaulerId = null;
      person.logisticsRequestId = null;
      this.clearHaulerRoute(person);
      return;
    }
    person.targetX = targetX;
    person.targetY = WORLD.groundY;
    person.pickupAmount = request.amount;
    person.pickupResource = request.resource;
    person.mode = 'moving';
    this.moveResidentTowardTarget(person, dt, () => {
      if (request.pickupStockpileId) this.arriveAtStockpilePickup(person);
      else this.arriveAtPickup(person);
    });
  }

  private clearHaulerRoute(person: PrototypeResident): void {
    person.targetX = null;
    person.targetY = null;
    person.targetSiteId = null;
    person.targetStoreId = null;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.pickupStockpileId = null;
    person.pickupAmount = 0;
  }

  private moveResidentTowardTarget(person: PrototypeResident, dt: number, onArrival?: () => void): void {
    if (person.targetX === null) { person.mode = 'idle'; return; }
    const dx = person.targetX - person.x;
    const movement = 140.4 * dt;
    if (Math.abs(dx) <= movement) {
      person.x = person.targetX;
      if (onArrival) onArrival();
      else this.arriveAtDestination(person);
    } else {
      person.x += Math.sign(dx) * movement;
    }
  }

  private arriveAtDestination(person: PrototypeResident): void {
    const item = person.cargo;
    if (!item) return;
    const amount = Math.max(1, person.cargoAmount || 1);
    const site = person.targetSiteId ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId) : undefined;
    if (site) {
      const accepted = Math.min(amount, Math.max(0, COST[site.kind][item] - this.siteDelivered(site, item)));
      if (item === 'wood') site.deliveredWood += accepted;
      else site.deliveredStone += accepted;
      person.cargo = null;
      person.cargoAmount = 0;
      person.targetSiteId = null;
      person.targetStoreId = null;
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.pickupStockpileId = null;
      person.pickupAmount = 0;
      person.mode = 'idle';
      person.task = `${accepted} ед. доставлено на стройку`;
      person.progress = 0;
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = null;
      this.completeCurrentRequest(person);
      this.onChange(`${accepted} ед. ${item === 'wood' ? 'дерева' : 'камня'} доставлено на стройку.`);
      return;
    }
    person.targetSiteId = null;
	const store = this.world.stores.find((candidate) =>
		candidate.id === person.targetStoreId && this.hasCapacityForDelivery(
        candidate, person.id, person.logisticsRequestId ?? undefined, Math.max(1, person.cargoAmount || 1)));
    if (!store) {
      this.routeCargoToStore(person);
      return;
    }
    const accepted = Math.min(amount, Math.max(0, store.capacity - store.wood - store.stone));
    if (accepted < amount) {
      this.routeCargoToStore(person);
      return;
    }
    store[item] += accepted;
    person.cargo = null;
    person.cargoAmount = 0;
    person.targetStoreId = null;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.pickupStockpileId = null;
    person.pickupAmount = 0;
    person.mode = 'idle';
    person.task = `${accepted} ед. доставлено на склад`;
    person.progress = 0;
    person.targetX = null;
    person.targetY = null;
    person.blockedReason = null;
    this.completeCurrentRequest(person);
    this.onChange(`${accepted} ед. ${item === 'wood' ? 'дерева' : 'камня'} принято на склад.`);
  }

  private completeCurrentRequest(person: PrototypeResident): void {
    const request = this.requestById(person.logisticsRequestId);
    if (request) {
      request.status = 'completed';
      request.assignedHaulerId = null;
      const initiator = this.world.residents.find((candidate) => candidate.id === request.initiatorId);
      if (initiator && initiator.id !== person.id) {
        initiator.blockedReason = null;
        initiator.task = request.type === 'PICKUP_RESOURCE' ? 'Куча вывезена; продолжает добычу' : 'Материалы доставлены; приступает к стройке';
        if (!initiator.cargo && initiator.mode === 'blocked') initiator.mode = 'idle';
      }
    }
    person.logisticsRequestId = null;
  }

  private arriveAtStockpilePickup(person: PrototypeResident): void {
    const request = this.requestById(person.logisticsRequestId);
    const pileId = person.pickupStockpileId ?? request?.pickupStockpileId;
    const pile = pileId ? this.world.stockpiles.find((candidate) => candidate.id === pileId) : undefined;
    if (!pile) {
      person.pickupStockpileId = null;
      person.mode = 'idle';
      person.task = 'Куча уже вывезена';
      return;
    }
    const reserved = this.reservedStockpileAmount(pile.id, request?.id, person.id);
    const available = Math.max(0, pile.amount - reserved);
    const store = request?.destinationStoreId
      ? this.world.stores.find((candidate) => candidate.id === request.destinationStoreId)
      : undefined;
    const capacity = store
      ? Math.max(0, store.capacity - store.wood - store.stone -
        this.reservedInboundCapacity(store.id, person.id, request?.id))
      : PROTOTYPE_CONFIG.stockpile.carryCapacity;
    const amount = Math.min(person.pickupAmount || request?.amount || 1, available, capacity,
      PROTOTYPE_CONFIG.stockpile.carryCapacity);
    if (amount < 1) {
      if (request) { request.status = 'blocked'; request.assignedHaulerId = null; }
      person.logisticsRequestId = null;
      person.mode = 'idle';
      person.task = 'Куча или склад временно недоступны';
      this.clearHaulerRoute(person);
      return;
    }
    pile.amount -= amount;
    person.cargo = pile.resource;
    person.cargoAmount = amount;
    person.pickupStockpileId = null;
    person.pickupAmount = 0;
    person.targetSiteId = request ? request.destinationSiteId : person.targetSiteId;
    person.targetStoreId = request?.destinationStoreId ?? null;
    if (request) {
      request.amount = amount;
      request.status = 'in_progress';
      request.destinationStoreId = store?.id ?? null;
    } else if (!person.targetSiteId) {
      this.routeCargoToStore(person);
    }
    person.mode = 'carrying';
    person.targetX = person.targetSiteId
      ? this.world.sites.find((site) => site.id === person.targetSiteId)?.x ?? null
      : this.world.stores.find((candidate) => candidate.id === person.targetStoreId)?.x ?? null;
    person.targetY = WORLD.groundY;
    person.task = `Несёт ${amount} ед. ${pile.resource === 'wood' ? 'древесины' : 'камня'}`;
    person.blockedReason = null;
    this.onChange(`${person.name} забрал ${amount} ед. из местной кучи.`);
  }

  private arriveAtPickup(person: PrototypeResident): void {
    const resource = person.pickupResource;
    const store = person.pickupStoreId
      ? this.world.stores.find((candidate) => candidate.id === person.pickupStoreId)
      : undefined;
    const site = person.targetSiteId
      ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId)
      : undefined;
    if (!resource || !store || !site) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.targetSiteId = null;
      person.mode = 'idle';
      person.task = 'Площадка больше недоступна';
      person.targetX = null;
      person.targetY = null;
      return;
    }

    const request = this.requestById(person.logisticsRequestId);
    const requestReserved = this.world.logisticsRequests.filter((candidate) => candidate.id !== request?.id &&
      candidate.pickupStoreId === store.id && candidate.resource === resource &&
      ['queued', 'assigned', 'in_progress', 'blocked'].includes(candidate.status))
      .reduce((sum, candidate) => sum + candidate.amount, 0);
    const residentReserved = this.world.residents.filter((candidate) => candidate.id !== person.id &&
      !candidate.logisticsRequestId && candidate.pickupStoreId === store.id && candidate.pickupResource === resource)
      .reduce((sum, candidate) => sum + Math.max(1, candidate.pickupAmount), 0);
    const unreserved = store[resource] - requestReserved - residentReserved;
    if (unreserved < 1) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.mode = 'blocked';
      person.blockedReason = `На складе больше нет ${resource === 'wood' ? 'дерева' : 'камня'}; ищет другой доступный запас.`;
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      this.onChange(person.blockedReason);
      return;
    }

    const amount = Math.min(unreserved, person.pickupAmount || request?.amount || 1);
    if (amount < 1) return;
    store[resource] -= amount;
    person.cargo = resource;
    person.cargoAmount = amount;
    person.pickupStoreId = null;
    person.pickupAmount = 0;
    person.pickupResource = null;
    person.targetStoreId = null;
    if (request) {
      request.amount = amount;
      request.status = 'in_progress';
    }
    person.mode = 'carrying';
    person.targetX = site.x;
    person.targetY = WORLD.groundY;
    person.task = `Несёт ${amount} ед. ${resource === 'wood' ? 'дерева' : 'камня'} на стройку`;
    person.blockedReason = null;
    this.onChange(`${person.name} забрал ${amount} ед. ${resource === 'wood' ? 'дерева' : 'камня'} со склада.`);
  }

	private findStoreForDeposit(fromX: number, residentId: string, amount = 1): PrototypeStore | undefined {
		return nearestStoreWithCapacity(this.world.stores, fromX,
			(storeId) => this.reservedInboundCapacity(storeId, residentId), amount);
  }

  private findStoreForPickup(resource: Resource, fromX: number): PrototypeStore | undefined {
    return this.world.stores.filter((store) => store.id !== 'store-under-construction' &&
      store[resource] > this.reservedPickups(store.id, resource))
      .sort((a, b) =>
        Math.abs(a.x - fromX) - Math.abs(b.x - fromX) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )[0];
  }

  private routeCargoToStore(person: PrototypeResident): boolean {
    if (!person.cargo) return false;
    person.targetSiteId = null;
	const amount = Math.max(1, person.cargoAmount || 1);
	const store = this.findStoreForDeposit(person.x, person.id, amount);
    if (!store) {
      person.targetStoreId = null;
      person.mode = 'blocked';
      person.blockedReason = 'Все склады заполнены. Построй ещё один склад или освободи место.';
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      return false;
    }
    person.targetStoreId = store.id;
    const request = this.requestById(person.logisticsRequestId);
    if (request) request.destinationStoreId = store.id;
    person.targetX = store.x;
    person.targetY = WORLD.groundY;
    person.mode = 'carrying';
    person.task = 'Несёт груз на склад';
    person.blockedReason = null;
    return true;
  }

  private ensureCargoDestination(person: PrototypeResident): boolean {
    if (!person.cargo) return true;
    const site = person.targetSiteId
      ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId)
      : undefined;
    if (site) {
      person.targetStoreId = null;
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.targetX = site.x;
      person.targetY = WORLD.groundY;
      return true;
    }
    person.targetSiteId = null;
    const store = person.targetStoreId
		? this.world.stores.find((candidate) =>
			candidate.id === person.targetStoreId && this.hasCapacityForDelivery(
        candidate, person.id, person.logisticsRequestId ?? undefined, Math.max(1, person.cargoAmount || 1)))
      : undefined;
    if (store) return true;
    return this.routeCargoToStore(person);
  }

  private siteHasAllMaterials(site: PrototypeSite): boolean {
    const cost = COST[site.kind];
    return site.deliveredWood >= cost.wood && site.deliveredStone >= cost.stone;
  }

  private completeBuilding(site: PrototypeSite): void {
    this.world.buildings.push({ id: `building-${this.world.nextId++}`, kind: site.kind, x: site.x, y: site.y });
    this.world.sites = this.world.sites.filter((candidate) => candidate.id !== site.id);
    if (site.kind === 'warehouse') {
      this.world.stores.push({ id: `store-${this.world.nextId++}`, x: site.x, wood: 0, stone: 0, capacity: 12 });
    } else {
      const housing = 3 + this.world.buildings.filter((building) => building.kind === 'house').length;
      while (this.world.residents.length < housing && this.world.residents.length < 8) {
        const index = this.world.residents.length;
        this.world.residents.push(resident(`r${this.world.nextId++}`, NEW_NAMES[(index - 3) % NEW_NAMES.length]!, site.x + 32));
      }
    }
    for (const person of this.world.residents) {
      if (person.targetSiteId === site.id) {
        person.targetSiteId = null;
        if (person.cargo) {
          this.routeCargoToStore(person);
          continue;
        }
        person.pickupStoreId = null;
        person.pickupResource = null;
        person.targetStoreId = null;
        person.mode = 'idle'; person.progress = 0;
        person.task = 'Стройка завершена';
        person.blockedReason = null;
        person.targetX = null;
        person.targetY = null;
      }
    }
    this.syncDevelopmentGoal();
    this.onChange(site.kind === 'house' ? 'Дом готов! Вместимость жилья выросла, поселение встречает нового жителя.' : 'Новый склад открыт: вместимость поселения выросла.');
  }
}
