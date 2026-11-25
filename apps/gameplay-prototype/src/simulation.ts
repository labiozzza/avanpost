import {
  LAND_GRID_CELLS, LAND_SURFACE_CELLS, LAND_GRID_CONFIG, LAND_GRID_EXPANSION_ORDER,
  LEGACY_LAND_GRID_CELLS, LEGACY_LAND_GRID_EXPANSION_ORDER, LEGACY_PLOTS,
  cellsForFootprint, footprintCenterX, landCellById, landCellNumber,
  landCellAtCoordinate, legacyLandCellById, legacyLandCellIdToGridId,
  type GridFootprint, type LandCellState
} from './land-grid.js';
import { advanceOnRoads, ROAD_CONFIG, snapRoadPosition, type RoadSegment } from './roads.js';
import { FEATURES } from './features.js';

export type Resource = 'wood' | 'ore';
export type BuildingKind = 'house' | 'warehouse' | 'sawmill' | 'mine';
export type SiteKind = BuildingKind | 'road' | 'house-upgrade';
export type WorkRole = 'idle' | 'woodcutter' | 'miner' | 'builder' | 'hauler';
export type ResidentMode = 'idle' | 'moving' | 'working' | 'carrying' | 'building' | 'blocked';
export type WoodSourceId = 'home' | 'eastern';
export type ProductionPriority = 1 | 2 | 3;
export type EasternSectorState = 'closed' | 'unlocked' | 'clearing' | 'prepared';
export type LogisticsMode = 'hauler' | 'independent';
export type LogisticsRequestType = 'PICKUP_RESOURCE' | 'DELIVER_TO_CONSTRUCTION';
export type LogisticsRequestStatus = 'queued' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
export type { LandCellState } from './land-grid.js';
export type StoredLandCellState = Extract<LandCellState, 'closed' | 'unlocked' | 'clearing' | 'prepared'>;
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
  /** Building record that owns this warehouse; absent only in older saves. */
  buildingId?: string;
  /** Prevent new storage routes from targeting a warehouse during demolition. */
  closedForDemolition?: boolean;
  x: number;
  wood: number;
  ore: number;
  capacity: number;
}

export interface PrototypeBuilding {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  gridColumn?: number;
  gridRow?: number;
  footprint?: GridFootprint;
  level?: number;
  sourceTreeId?: string | null;
  demolition?: PrototypeDemolition;
}

export interface PrototypeDemolition {
  state: 'demolishing';
  progress: number;
  workerId: string | null;
  paused: boolean;
  blockedReason: string | null;
}

export interface PrototypeSite {
  id: string;
  kind: SiteKind;
  x: number;
  y: number;
  deliveredWood: number;
  deliveredOre: number;
  progress: number;
  stage: number;
  gridColumn?: number;
  gridRow?: number;
  footprint?: GridFootprint;
  sourceTreeId?: string | null;
  /** Set only for an in-place house upgrade site. */
  upgradeBuildingId?: string;
  /** Manual scheduling weight: 1 low, 2 normal, 3 high. */
  priority?: ProductionPriority;
  paused?: boolean;
}

export interface PrototypeProductionSettings {
  quota: Record<Resource, number>;
  priority: Record<Resource, ProductionPriority>;
}

export interface PrototypeRoad extends RoadSegment {
  builtAt: number;
}

export interface PrototypeStockpile {
  id: string;
  sourceId: string;
  resource: Resource;
  x: number;
  amount: number;
  capacity: number;
  treeId?: string;
}

export type PrototypeTreeState = 'growing' | 'mature' | 'falling' | 'stump';

export interface PrototypeTree {
  id: string;
  cellId: number;
  sourceId: WoodSourceId;
  x: number;
  state: PrototypeTreeState;
  growthSeconds: number;
  cutProgress: number;
  stateSeconds: number;
  workerId: string | null;
  planted: boolean;
}

export interface PrototypeLandCell {
  id: number;
  column?: number;
  row?: number;
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
}

export interface PrototypeWorld {
  version: 1;
  economyVersion?: number;
  mapVersion?: number;
  gridVersion?: number;
  sourceLayoutVersion?: number;
  lastSimulatedAtMs?: number;
  elapsedSeconds: number;
  oreSource: number;
  trees: PrototypeTree[];
  residents: PrototypeResident[];
  stores: PrototypeStore[];
  buildings: PrototypeBuilding[];
  sites: PrototypeSite[];
  roads: PrototypeRoad[];
  occupiedPlots: number[];
  nextId: number;
  easternSector: PrototypeEasternSector;
  landCells: PrototypeLandCell[];
  easternForestAvailable: boolean;
  stockpiles: PrototypeStockpile[];
  logisticsRequests: PrototypeLogisticsRequest[];
  nextRequestSequence: number;
  currentGoal: DevelopmentGoal;
  productionSettings?: PrototypeProductionSettings;
}

export const STORAGE_KEY = 'avanpost:gameplay-prototype:v01';
export const ECONOMY_VERSION = 4;
export const GRID_VERSION = 2;
export const MAP_VERSION = 9;
export const WORLD = { width: LAND_GRID_CONFIG.right, height: LAND_GRID_CONFIG.bottom, groundY: LAND_GRID_CONFIG.groundY };
const LEGACY_WORLD_WIDTH = 1960;
export const PLOTS = LAND_SURFACE_CELLS.map((cell) => ({
  id: cell.id, column: cell.column, row: cell.row, x: cell.centerX, y: WORLD.groundY,
  role: cell.role, ...(cell.resource ? { resource: cell.resource } : {})
}));
export const EXPANSION_CELL_ORDER = LAND_GRID_EXPANSION_ORDER;

export const BUILDING_FOOTPRINTS: Readonly<Record<BuildingKind, GridFootprint>> = {
  house: { widthCells: 1, heightCells: 1 },
  warehouse: { widthCells: 1, heightCells: 1 },
  sawmill: { widthCells: 2, heightCells: 1 },
  mine: { widthCells: 1, heightCells: 1 }
};

function footprintFor(kind: BuildingKind): GridFootprint {
  return BUILDING_FOOTPRINTS[kind];
}

function buildingKindForSite(kind: SiteKind): BuildingKind | null {
  return kind === 'road' ? null : kind === 'house-upgrade' ? 'house' : kind;
}

function storeAmount(store: PrototypeStore, resource: Resource): number {
  return store[resource] ?? 0;
}

function storeTotal(store: PrototypeStore): number {
  return store.wood + store.ore;
}

function siteDeliveredAmount(site: PrototypeSite, resource: Resource): number {
  return resource === 'wood' ? site.deliveredWood : site.deliveredOre;
}

/**
 * Experimental prototype balance only. These values are not approved GDD
 * balance; keep them centralized so later playtests can tune the slice.
 */
export const PROTOTYPE_CONFIG = {
  warehouseCapacity: 120,
  initialResources: { wood: 30, ore: 20 },
  constructionSeconds: 300,
  production: {
    initialQuota: { wood: 240, ore: 240 },
    maxQuota: 240,
    quotaStep: 10,
  },
  diagnosticSeconds: 15,
  offline: { maxSeconds: 8 * 60 * 60, stepSeconds: 0.1, diagnosticSteps: 150, chunkSteps: 1500, checkpointSteps: 3000 },
  sources: { homeX: 234, oreX: 1950, homePileX: 150, orePileX: 1850, easternPileX: 3900 },
  trees: {
    initialGrowthSeconds: 120,
    cuttingSeconds: 28,
    woodPerCut: 10,
    fallSeconds: 0.65,
    stumpSeconds: 0.25,
    regrowthSeconds: 1.7,
    plantingCost: 10
  },
  ore: {
    initialDeposit: 180,
    mineCost: { wood: 60, ore: 0 },
    mineSecondsPerUnit: 2.8
  },
  easternSector: {
    boundaryX: 2400,
    clearingX: 2400,
    forestX: 3750,
    unlockCost: { wood: 80, ore: 50 },
    clearingWorkSeconds: 30,
  },
  expansion: {
    unlockCost: { wood: 80, ore: 50 },
    clearingWorkSeconds: 30
  },
  stockpile: { capacity: 10, upgradedCapacity: 50, harvestSeconds: 2.8, harvestAmount: 1, carryCapacity: 10 },
  roads: ROAD_CONFIG,
  demolition: { workSeconds: 15, refundFraction: 0.5 }
} as const;

const DEFAULT_PRODUCTION_SETTINGS: PrototypeProductionSettings = {
  quota: { ...PROTOTYPE_CONFIG.production.initialQuota },
  priority: { wood: 2, ore: 2 }
};

export const productionPriorityLabel = (priority: number): string =>
  priority <= 1 ? 'низкий' : priority >= 3 ? 'высокий' : 'обычный';

function boundedProductionSettings(settings?: Partial<PrototypeProductionSettings>): PrototypeProductionSettings {
  const quota = settings?.quota;
  const priority = settings?.priority;
  const boundedPriority = (value: number | undefined): ProductionPriority =>
    Math.max(1, Math.min(3, Math.round(Number.isFinite(value) ? value! : 2))) as ProductionPriority;
  const boundedQuota = (resource: Resource, value: number | undefined): number =>
    Math.max(0, Math.min(PROTOTYPE_CONFIG.production.maxQuota,
      Math.round((Number.isFinite(value) ? value! : PROTOTYPE_CONFIG.production.initialQuota[resource]) /
        PROTOTYPE_CONFIG.production.quotaStep) * PROTOTYPE_CONFIG.production.quotaStep));
  return {
    quota: {
      wood: boundedQuota('wood', quota?.wood),
      ore: boundedQuota('ore', quota?.ore)
    },
    priority: {
      wood: boundedPriority(priority?.wood),
      ore: boundedPriority(priority?.ore)
    }
  };
}

const COST: Record<SiteKind, Record<Resource, number>> = {
  house: { wood: 60, ore: 50 },
  warehouse: { wood: 50, ore: 40 },
  sawmill: { wood: 50, ore: 40 },
  mine: { ...PROTOTYPE_CONFIG.ore.mineCost },
  'house-upgrade': { wood: 40, ore: 30 },
  road: ROAD_CONFIG.cost
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
export const costOf = (kind: SiteKind) => COST[kind];
export const resourceLabel = (resource: Resource): string =>
  resource === 'wood' ? 'древесина' : 'порода';
export const resourceLabelGenitive = (resource: Resource): string =>
  resource === 'wood' ? 'древесины' : 'породы';
export { landCellNumber };
export const cellBounds = (id: number) => {
  const cell = landCellById(id);
  return cell ? { left: cell.left, right: cell.right, top: cell.top, bottom: cell.bottom } : null;
};
export function materialFraction(site: PrototypeSite): number {
  const cost = COST[site.kind];
  const total = cost.wood + cost.ore;
  return total === 0 ? 1 : Math.min(1,
    (Math.min(cost.wood, site.deliveredWood) + Math.min(cost.ore, site.deliveredOre)) / total);
}
export function constructionSeconds(site: PrototypeSite): number {
  return site.kind === 'road' ? ROAD_CONFIG.constructionSeconds
    : site.kind === 'house-upgrade' ? 90 : PROTOTYPE_CONFIG.constructionSeconds;
}
export function demolitionRefund(kind: BuildingKind): { wood: number; ore: number } {
  const cost = COST[kind];
  return {
    wood: Math.floor(cost.wood * PROTOTYPE_CONFIG.demolition.refundFraction),
    ore: Math.floor(cost.ore * PROTOTYPE_CONFIG.demolition.refundFraction)
  };
}

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
  const initiallyPreparedColumns = new Set([1, 2, 3, 4, 5, 7]);
  return LAND_GRID_CELLS.map((cell) => {
    const prepared = cell.environment === 'air' ||
      (cell.environment === 'surface' &&
        (initiallyPreparedColumns.has(cell.column) || cell.role === 'reserved-resource'));
    return {
      id: cell.id, column: cell.column, row: cell.row, x: cell.centerX, y: cell.centerY,
      state: prepared ? 'prepared' : 'closed',
      clearingProgress: prepared ? 1 : 0,
      clearingPaused: false,
      clearerId: null
    };
  });
}

function initialLegacyLandCells(): PrototypeLandCell[] {
  return LEGACY_PLOTS.map((plot) => ({
    id: plot.id,
    x: plot.x,
    y: plot.y,
    state: plot.id < 4 || plot.id === 8 || plot.role === 'reserved-resource' ? 'prepared' : 'closed',
    clearingProgress: plot.id < 4 || plot.id === 8 || plot.role === 'reserved-resource' ? 1 : 0,
    clearingPaused: false,
    clearerId: null
  }));
}

function initialStockpiles(): PrototypeStockpile[] {
  return [
    { id: 'pile-wood-home', sourceId: 'home', resource: 'wood', x: PROTOTYPE_CONFIG.sources.homePileX, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity, treeId: 'tree-home' },
    { id: 'pile-ore-main', sourceId: 'ore', resource: 'ore', x: PROTOTYPE_CONFIG.sources.orePileX, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity },
    { id: 'pile-wood-eastern', sourceId: 'eastern', resource: 'wood', x: PROTOTYPE_CONFIG.sources.easternPileX, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity, treeId: 'tree-eastern' }
  ];
}

function initialTrees(includeEastern = false): PrototypeTree[] {
  const homeCell = landCellAtCoordinate(0, LAND_GRID_CONFIG.surfaceCellRow)!;
  const easternCell = landCellAtCoordinate(12, LAND_GRID_CONFIG.surfaceCellRow)!;
  const mature = (id: string, cellId: number, sourceId: WoodSourceId, x: number): PrototypeTree => ({
    id, cellId, sourceId, x, state: 'mature', growthSeconds: PROTOTYPE_CONFIG.trees.initialGrowthSeconds,
    cutProgress: 0, stateSeconds: 0, workerId: null, planted: false
  });
  return [mature('tree-home', homeCell.id, 'home', PROTOTYPE_CONFIG.sources.homeX),
    ...(includeEastern ? [mature('tree-eastern', easternCell.id, 'eastern', PROTOTYPE_CONFIG.easternSector.forestX)] : [])];
}

function anchorColumnForWorldX(x: number): number {
  const candidates = PLOTS.filter((plot) => plot.role === 'building');
  return candidates.reduce((closest, plot) =>
    Math.abs(plot.x - x) < Math.abs(closest.x - x) ? plot : closest
  ).column;
}

function normalizeStructureGrid(
  structure: PrototypeBuilding | PrototypeSite,
  kind: BuildingKind
): void {
  const footprint = structure.footprint && Number.isInteger(structure.footprint.widthCells) &&
      Number.isInteger(structure.footprint.heightCells) && structure.footprint.widthCells > 0 &&
      structure.footprint.heightCells > 0
    ? structure.footprint
    : footprintFor(kind);
  const column = Number.isInteger(structure.gridColumn)
    ? structure.gridColumn!
    : anchorColumnForWorldX(structure.x);
  const row = Number.isInteger(structure.gridRow)
    ? structure.gridRow!
    : LAND_GRID_CONFIG.surfaceCellRow;
  const cells = cellsForFootprint({ column, row }, footprint);
  if (!cells) return;
  structure.gridColumn = column;
  structure.gridRow = row;
  structure.footprint = { ...footprint };
  structure.x = footprintCenterX({ column, row }, footprint);
  structure.y = WORLD.groundY;
}

function structureCellIds(structure: PrototypeBuilding | PrototypeSite): number[] {
  if (structure.kind === 'road' || structure.kind === 'house-upgrade') return [];
  const kind = structure.kind;
  const footprint = structure.footprint ?? footprintFor(kind);
  const column = Number.isInteger(structure.gridColumn) ? structure.gridColumn! : anchorColumnForWorldX(structure.x);
  const row = Number.isInteger(structure.gridRow) ? structure.gridRow! : LAND_GRID_CONFIG.surfaceCellRow;
  return cellsForFootprint({ column, row }, footprint)?.map((cell) => cell.id) ?? [];
}

function occupiedCellIds(world: PrototypeWorld): number[] {
  const ids = new Set(world.occupiedPlots ?? []);
  for (const structure of [...world.buildings, ...world.sites]) {
    for (const id of structureCellIds(structure)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

function normalizeBuildingRecords(world: PrototypeWorld): void {
  const usedWarehouseIds = new Set<string>();
  for (const building of world.buildings) {
    if (building.kind === 'house') {
      building.level = Math.max(1, Math.min(2, Math.floor(building.level ?? 1)));
    } else {
      delete building.level;
    }
    if (building.kind === 'sawmill' && typeof building.sourceTreeId !== 'string') delete building.sourceTreeId;
    const saved = building.demolition;
    if (!saved || saved.state !== 'demolishing') {
      delete building.demolition;
      continue;
    }
    building.demolition = {
      state: 'demolishing',
      progress: Math.max(0, Math.min(1, Number.isFinite(saved.progress) ? saved.progress : 0)),
      workerId: typeof saved.workerId === 'string' ? saved.workerId : null,
      paused: Boolean(saved.paused),
      blockedReason: typeof saved.blockedReason === 'string' ? saved.blockedReason : null
    };
  }

  for (const store of world.stores) {
    const linked = world.buildings.find((building) => building.kind === 'warehouse' &&
      !usedWarehouseIds.has(building.id) &&
      (building.id === store.buildingId || Math.abs(building.x - store.x) < 1));
    if (linked) {
      store.buildingId = linked.id;
      if (linked.demolition) store.closedForDemolition = true;
      else delete store.closedForDemolition;
      usedWarehouseIds.add(linked.id);
      continue;
    }

    let id = typeof store.buildingId === 'string' ? store.buildingId : `warehouse:${store.id}`;
    if (world.buildings.some((building) => building.id === id)) id = `warehouse:${store.id}`;
    let suffix = 2;
    while (world.buildings.some((building) => building.id === id) || usedWarehouseIds.has(id)) {
      id = `warehouse:${store.id}:${suffix++}`;
    }
    const building: PrototypeBuilding = { id, kind: 'warehouse', x: store.x, y: WORLD.groundY };
    world.buildings.push(building);
    store.buildingId = id;
    delete store.closedForDemolition;
    usedWarehouseIds.add(id);
  }
  if (world.gridVersion === GRID_VERSION) {
    for (const building of world.buildings) normalizeStructureGrid(building, building.kind);
    for (const site of world.sites) {
      const structureKind = buildingKindForSite(site.kind);
      if (structureKind && site.kind !== 'house-upgrade') normalizeStructureGrid(site, structureKind);
    }
    world.occupiedPlots = occupiedCellIds(world);
  }
}

function restoreDemolitionWorkers(world: PrototypeWorld): void {
  const assigned = new Set<string>();
  for (const building of world.buildings) {
    const demolition = building.demolition;
    if (!demolition) continue;
    const worker = demolition.workerId
      ? world.residents.find((person) => person.id === demolition.workerId)
      : undefined;
    if (demolition.paused || !worker || worker.role !== 'builder' || worker.cargo || assigned.has(worker.id)) {
      demolition.paused = true;
      demolition.workerId = null;
      demolition.blockedReason ??= 'Нужен свободный строитель, чтобы продолжить снос.';
      if (worker && !worker.cargo && !assigned.has(worker.id)) {
        worker.targetX = null;
        worker.targetY = null;
        worker.targetSiteId = null;
        worker.targetStoreId = null;
        worker.pickupStoreId = null;
        worker.pickupResource = null;
        worker.pickupStockpileId = null;
        worker.pickupAmount = 0;
        worker.mode = 'idle';
        worker.task = 'Снос приостановлен';
        worker.blockedReason = null;
      }
      continue;
    }
    assigned.add(worker.id);
    worker.targetSiteId = null;
    worker.targetStoreId = null;
    worker.pickupStoreId = null;
    worker.pickupResource = null;
    worker.pickupStockpileId = null;
    worker.pickupAmount = 0;
    worker.targetX = building.x;
    worker.targetY = WORLD.groundY;
    worker.mode = Math.abs(worker.x - building.x) <= 1 ? 'building' : 'moving';
    worker.task = worker.mode === 'building' ? 'Разбирает здание' : 'Идёт к зданию для сноса';
    worker.blockedReason = null;
  }
}

function hasStoreCapacity(store: PrototypeStore, incomingReservations = 0, amount = 1): boolean {
	return store.id !== 'store-under-construction' && !store.closedForDemolition &&
		storeTotal(store) + incomingReservations + amount <= store.capacity;
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
  return { state: 'closed', clearingProgress: 0, clearingPaused: false, clearerId: null };
}

export function createNewWorld(): PrototypeWorld {
  const startWarehouse = PLOTS.find((plot) => plot.column === 3)!;
  const world: PrototypeWorld = {
    version: 1,
    economyVersion: ECONOMY_VERSION,
    sourceLayoutVersion: 1,
    mapVersion: MAP_VERSION,
    gridVersion: GRID_VERSION,
    elapsedSeconds: 0,
    oreSource: PROTOTYPE_CONFIG.ore.initialDeposit,
    trees: initialTrees(),
    // Keep the warehouse facade open at game start: two residents stand left
    // of its visible alpha bounds, the third to the right.
    residents: [resident('r1', 'Илья', 640), resident('r2', 'Мария', 760), resident('r3', 'Саша', 1180)],
    stores: [{ id: 'store-1', buildingId: 'warehouse:store-1', x: startWarehouse.x,
      ...PROTOTYPE_CONFIG.initialResources, capacity: PROTOTYPE_CONFIG.warehouseCapacity }],
    buildings: [{ id: 'warehouse:store-1', kind: 'warehouse', x: startWarehouse.x, y: WORLD.groundY,
      gridColumn: startWarehouse.column, gridRow: startWarehouse.row, footprint: footprintFor('warehouse') }],
    sites: [],
    roads: [],
    occupiedPlots: [startWarehouse.id],
    nextId: 2,
    easternSector: emptyEasternSector(),
    landCells: initialLandCells(),
    easternForestAvailable: false,
    stockpiles: initialStockpiles(),
    logisticsRequests: [],
    nextRequestSequence: 1,
    currentGoal: 'build-first-house',
    productionSettings: boundedProductionSettings(DEFAULT_PRODUCTION_SETTINGS)
  };
  world.currentGoal = developmentGoal(world);
  return world;
}

/** Convert legacy stone and boards once, while keeping physical overflow visible. */
function migrateEconomySave(input: PrototypeWorld): PrototypeWorld {
  const raw = input as unknown as Record<string, any>;
  if (raw.economyVersion === ECONOMY_VERSION) return input;
  const sourceVersion = Number(raw.economyVersion ?? 1);
  if (![1, 2, 3].includes(sourceVersion)) throw new Error('Unsupported economy version');
  const scale = sourceVersion === 1 ? 10 : 1;
  const amountOf = (value: unknown): number => Math.max(0, Number(value) || 0);
  const oldStores = Array.isArray(raw.stores) ? raw.stores as Array<Record<string, any>> : [];
  const oldSites = Array.isArray(raw.sites) ? raw.sites as Array<Record<string, any>> : [];
  const oldResidents = Array.isArray(raw.residents) ? raw.residents as Array<Record<string, any>> : [];
  const oldBuildings = Array.isArray(raw.buildings) ? raw.buildings as Array<Record<string, any>> : [];
  const oldRequests = Array.isArray(raw.logisticsRequests) ? raw.logisticsRequests as Array<Record<string, any>> : [];
  const oldPiles = Array.isArray(raw.stockpiles) ? raw.stockpiles as Array<Record<string, any>> : [];
  const mapResource = (resource: unknown): Resource | null => resource === 'wood' ? 'wood'
    : resource === 'stone' || resource === 'ore' ? 'ore'
      : resource === 'boards' ? 'wood' : null;
  const convertedAmount = (resource: unknown, amount: unknown): number =>
    amountOf(amount) * scale * (resource === 'boards' ? 2 : 1);
  const oldTrees = Array.isArray(raw.trees) ? raw.trees as Array<Record<string, any>> : [];
  const hasEasternTrees = Boolean(raw.easternForestAvailable || raw.easternSector?.state === 'prepared' ||
    raw.easternSector?.state === 'clearing');
  const trees: PrototypeTree[] = oldTrees.filter((tree) => tree && typeof tree.id === 'string' &&
    Number.isFinite(tree.x) && Number.isFinite(tree.cellId)).map((tree) => ({
      id: tree.id, cellId: Number(tree.cellId), sourceId: tree.sourceId === 'eastern' ? 'eastern' : 'home',
      x: Number(tree.x), state: ['growing', 'mature', 'falling', 'stump'].includes(tree.state) ? tree.state : 'mature',
      growthSeconds: Math.max(0, Math.min(PROTOTYPE_CONFIG.trees.initialGrowthSeconds, amountOf(tree.growthSeconds))),
      cutProgress: Math.max(0, Math.min(PROTOTYPE_CONFIG.trees.cuttingSeconds, amountOf(tree.cutProgress))),
      stateSeconds: Math.max(0, amountOf(tree.stateSeconds)),
      workerId: typeof tree.workerId === 'string' ? tree.workerId : null,
      planted: Boolean(tree.planted)
    }));
  if (!trees.some((tree) => tree.id === 'tree-home')) trees.unshift(initialTrees()[0]!);
  if (hasEasternTrees && !trees.some((tree) => tree.sourceId === 'eastern')) trees.push(initialTrees(true)[1]!);

  const buildings: PrototypeBuilding[] = oldBuildings.map((building) => {
    const { inputWood: _inputWood, productionProgress: _productionProgress, ...active } = building;
    const migrated = { ...active } as PrototypeBuilding;
    if (migrated.kind === 'house') migrated.level = Math.max(1, Math.min(2, Math.floor(Number(migrated.level) || 1)));
    else delete migrated.level;
    if (migrated.kind === 'sawmill') {
      const tree = trees.find((candidate) => candidate.id === migrated.sourceTreeId) ??
        [...trees].sort((a, b) => Math.abs(a.x - migrated.x) - Math.abs(b.x - migrated.x))[0];
      migrated.sourceTreeId = tree?.id ?? null;
    }
    return migrated;
  });
  const treeForBuilding = (building: PrototypeBuilding): PrototypeTree | undefined =>
    trees.find((tree) => tree.id === building.sourceTreeId) ??
    [...trees].sort((a, b) => Math.abs(a.x - building.x) - Math.abs(b.x - building.x))[0];
  for (const building of buildings) {
    if (building.kind !== 'sawmill') continue;
    const tree = treeForBuilding(building);
    if (tree) building.sourceTreeId = tree.id;
  }

  const world = {
    ...raw,
    economyVersion: ECONOMY_VERSION,
    oreSource: Math.max(0, Number(raw.oreSource ?? raw.stoneSource ?? PROTOTYPE_CONFIG.ore.initialDeposit) * scale),
    trees,
    residents: [] as PrototypeResident[],
    stores: [] as PrototypeStore[],
    buildings,
    sites: [] as PrototypeSite[],
    stockpiles: initialStockpiles(),
    logisticsRequests: [] as PrototypeLogisticsRequest[],
    productionSettings: boundedProductionSettings(),
    easternSector: {
      state: raw.easternSector?.state ?? 'closed',
      clearingProgress: Math.max(0, Math.min(1, Number(raw.easternSector?.clearingProgress) || 0)),
      clearingPaused: Boolean(raw.easternSector?.clearingPaused),
      clearerId: typeof raw.easternSector?.clearerId === 'string' ? raw.easternSector.clearerId : null
    } as PrototypeEasternSector
  } as PrototypeWorld;
  delete (world as unknown as Record<string, unknown>).woodSource;
  delete (world as unknown as Record<string, unknown>).stoneSource;
  delete (world as unknown as Record<string, unknown>).woodSourceRecoverySeconds;
  delete (world as unknown as Record<string, unknown>).stoneSourceRecoverySeconds;

  const pileIdMap = new Map<string, string>();
  const convertedPiles = new Map<string, PrototypeStockpile>();
  for (const old of oldPiles) {
    const resource = mapResource(old.resource);
    if (!resource || !Number.isFinite(old.x)) continue;
    const source = old.sourceId === 'stone' ? 'ore' : String(old.sourceId ?? 'migration');
    const defaultId = source === 'home' ? 'pile-wood-home' : source === 'eastern' ? 'pile-wood-eastern'
      : source === 'ore' ? 'pile-ore-main' : null;
    const pile = defaultId ? world.stockpiles.find((candidate) => candidate.id === defaultId) : undefined;
    if (pile) {
      pileIdMap.set(String(old.id), pile.id);
      const value = convertedAmount(old.resource, old.amount);
      pile.amount += value;
      continue;
    }
    const id = String(old.id ?? `pile-migration-${world.nextId++}`);
    const capacity = PROTOTYPE_CONFIG.stockpile.capacity;
    const treeId = typeof old.treeId === 'string' && trees.some((tree) => tree.id === old.treeId)
      ? old.treeId : undefined;
    convertedPiles.set(id, {
      id, sourceId: treeId ? `tree-${treeId}` : 'migration', resource, x: Number(old.x), amount: 0, capacity,
      ...(treeId ? { treeId } : {})
    });
    const target = convertedPiles.get(id)!;
    target.amount += convertedAmount(old.resource, old.amount);
    pileIdMap.set(String(old.id), id);
  }
  world.stockpiles.push(...convertedPiles.values());

  for (const building of buildings) {
    if (building.kind !== 'sawmill') continue;
    const old = oldBuildings.find((candidate) => candidate.id === building.id);
    const tree = treeForBuilding(building);
    const pile = world.stockpiles.find((candidate) => candidate.treeId === tree?.id) ??
      world.stockpiles.find((candidate) => candidate.sourceId === tree?.sourceId);
    if (pile) pile.capacity = PROTOTYPE_CONFIG.stockpile.upgradedCapacity;
    const bufferedWood = amountOf(old?.inputWood) * scale;
    if (pile) pile.amount += bufferedWood;
    if (amountOf(old?.productionProgress) > 0 && tree) {
      tree.cutProgress = Math.min(PROTOTYPE_CONFIG.trees.cuttingSeconds, amountOf(old?.productionProgress));
    }
  }
  if (buildings.some((building) => building.kind === 'mine')) {
    const orePile = world.stockpiles.find((pile) => pile.sourceId === 'ore');
    if (orePile) orePile.capacity = PROTOTYPE_CONFIG.stockpile.upgradedCapacity;
  }

  for (const old of oldStores) {
    const wood = convertedAmount('wood', old.wood) + convertedAmount('boards', old.boards);
    const ore = convertedAmount('stone', old.stone) + convertedAmount('ore', old.ore);
    const capacity = PROTOTYPE_CONFIG.warehouseCapacity;
    const keptWood = Math.min(wood, capacity);
    const keptOre = Math.min(ore, Math.max(0, capacity - keptWood));
    world.stores.push({
      id: String(old.id), buildingId: typeof old.buildingId === 'string' ? old.buildingId : undefined,
      closedForDemolition: Boolean(old.closedForDemolition), x: Number(old.x),
      wood: keptWood, ore: keptOre, capacity
    });
    addLooseMaterials(world, 'wood', wood - keptWood, Number(old.x), 'migration-storage-overflow');
    addLooseMaterials(world, 'ore', ore - keptOre, Number(old.x), 'migration-storage-overflow');
  }
  if (!world.stores.length) {
    const fallback = PLOTS.find((plot) => plot.column === 3)!;
    world.stores.push({ id: 'store-1', x: fallback.x, wood: 0, ore: 0, capacity: PROTOTYPE_CONFIG.warehouseCapacity });
  }

  for (const old of oldSites) {
    const { deliveredStone: stone, deliveredBoards: boards, ...active } = old;
    const deliveredWood = convertedAmount('wood', old.deliveredWood) + convertedAmount('boards', boards);
    const deliveredOre = convertedAmount('stone', stone) + convertedAmount('ore', old.deliveredOre);
    const site = { ...active, deliveredWood, deliveredOre } as PrototypeSite;
    const cost = COST[site.kind];
    if (site.deliveredWood > cost.wood) {
      addLooseMaterials(world, 'wood', site.deliveredWood - cost.wood, site.x, 'migration-site-overflow');
      site.deliveredWood = cost.wood;
    }
    if (site.deliveredOre > cost.ore) {
      addLooseMaterials(world, 'ore', site.deliveredOre - cost.ore, site.x, 'migration-site-overflow');
      site.deliveredOre = cost.ore;
    }
    site.progress = Math.min(Math.max(0, Number(site.progress) || 0), materialFraction(site));
    world.sites.push(site);
  }

  for (const old of oldResidents) {
    const { targetBuildingId: _targetBuildingId, ...legacyResident } = old;
    const role = old.role === 'sawmiller' ? 'woodcutter' : old.role;
    const cargo = mapResource(old.cargo);
    const oldCargoAmount = convertedAmount(old.cargo, old.cargoAmount ?? (old.cargo ? 1 : 0));
    const cargoAmount = Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity, oldCargoAmount);
    const person = {
      ...legacyResident,
      role,
      cargo,
      cargoAmount,
      pickupResource: mapResource(old.pickupResource),
      pickupAmount: Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity,
        convertedAmount(old.pickupResource, old.pickupAmount)),
      pickupStockpileId: old.pickupStockpileId ? pileIdMap.get(String(old.pickupStockpileId)) ?? old.pickupStockpileId : null,
      woodSource: old.woodSource === 'eastern' ? 'eastern' : 'home',
      targetStoreId: typeof old.targetStoreId === 'string' ? old.targetStoreId : null,
      targetSiteId: typeof old.targetSiteId === 'string' ? old.targetSiteId : null,
      targetX: old.targetX ?? null,
      targetY: old.targetY ?? null,
      logisticsMode: old.logisticsMode === 'independent' ? 'independent' : 'hauler',
      logisticsRequestId: typeof old.logisticsRequestId === 'string' ? old.logisticsRequestId : null
    } as PrototypeResident;
    world.residents.push(person);
    if (cargo && oldCargoAmount > cargoAmount) {
      addLooseMaterials(world, cargo, oldCargoAmount - cargoAmount, Number(old.x), 'migration-cargo-overflow');
    }
  }

  for (const old of oldRequests) {
    const { destinationBuildingId: _destinationBuildingId, ...legacyRequest } = old;
    const resource = mapResource(old.resource);
    if (!resource || !['PICKUP_RESOURCE', 'DELIVER_TO_CONSTRUCTION', 'DELIVER_TO_PRODUCTION'].includes(old.type)) continue;
    const amount = Math.max(0, convertedAmount(old.resource, old.amount));
    const request = {
      ...legacyRequest,
      type: old.type === 'DELIVER_TO_PRODUCTION' ? 'PICKUP_RESOURCE' : old.type,
      resource,
      amount: Math.max(1, Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity, amount)),
      pickupStockpileId: old.pickupStockpileId ? pileIdMap.get(String(old.pickupStockpileId)) ?? old.pickupStockpileId : null,
      status: old.type === 'DELIVER_TO_PRODUCTION' ? 'cancelled' : old.status,
      assignedHaulerId: typeof old.assignedHaulerId === 'string' ? old.assignedHaulerId : null
    } as PrototypeLogisticsRequest;
    world.logisticsRequests.push(request);
  }

  for (const pile of world.stockpiles) {
    const capacity = pile.treeId && buildings.some((building) =>
      building.kind === 'sawmill' && building.sourceTreeId === pile.treeId) ||
      pile.sourceId === 'ore' && buildings.some((building) => building.kind === 'mine')
      ? PROTOTYPE_CONFIG.stockpile.upgradedCapacity : PROTOTYPE_CONFIG.stockpile.capacity;
    if (pile.amount > capacity) {
      const excess = pile.amount - capacity;
      pile.amount = capacity;
      addLooseMaterials(world, pile.resource, excess, pile.x, 'migration-pile-overflow');
    }
    pile.capacity = capacity;
  }

  const oldQuota = raw.productionSettings?.quota ?? {};
  const oldPriority = raw.productionSettings?.priority ?? {};
  world.productionSettings = boundedProductionSettings({
    quota: {
      wood: amountOf(oldQuota.wood) + 2 * amountOf(oldQuota.boards),
      ore: amountOf(oldQuota.ore ?? oldQuota.stone)
    },
    priority: {
      wood: Math.max(Number(oldPriority.wood) || 2, Number(oldPriority.boards) || 2) as ProductionPriority,
      ore: (Number(oldPriority.ore ?? oldPriority.stone) || 2) as ProductionPriority
    }
  });
  for (const request of world.logisticsRequests) {
    const carrier = world.residents.find((person) => person.logisticsRequestId === request.id && person.cargo);
    if (carrier) request.amount = carrier.cargoAmount;
    if (request.status === 'cancelled') request.assignedHaulerId = null;
  }
  for (const person of world.residents) {
    if (person.logisticsRequestId && world.logisticsRequests.some((request) =>
      request.id === person.logisticsRequestId && request.status === 'cancelled')) {
      person.logisticsRequestId = null;
      if (!person.cargo) {
        person.mode = 'idle'; person.targetX = null; person.targetY = null;
        person.targetSiteId = null; person.targetStoreId = null;
      }
    }
  }
  return world;
}

export function isLooseMaterial(pile: PrototypeStockpile): boolean {
  return !pile.treeId && !['home', 'ore', 'eastern'].includes(pile.sourceId);
}

function addLooseMaterials(
  world: PrototypeWorld, resource: Resource, amount: number, x: number, sourceId: string
): void {
  while (amount > 0) {
    const batch = Math.min(PROTOTYPE_CONFIG.stockpile.capacity, amount);
    world.stockpiles.push({
      id: `pile-${sourceId}-${world.nextId++}`, sourceId, resource, x,
      amount: batch, capacity: PROTOTYPE_CONFIG.stockpile.capacity
    });
    amount -= batch;
  }
}

export function parseSavedWorld(raw: string | null): PrototypeWorld | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const input = value as PrototypeWorld & { mapVersion?: number; gridVersion?: number };
    if (input.version !== 1 || !Array.isArray(input.residents) || !Array.isArray(input.stores) ||
        !Array.isArray(input.buildings) || !Array.isArray(input.sites) || !Array.isArray(input.occupiedPlots) ||
        !Number.isFinite(input.nextId) || !Number.isFinite(input.elapsedSeconds)) return null;
    const world = migrateEconomySave(input);
    if (world.residents.length < 3 || world.residents.length > 8 ||
        world.residents.some((person) => !person.id || !Number.isFinite(person.x) ||
          !['idle', 'woodcutter', 'miner', 'builder', 'hauler'].includes(person.role) ||
          !['idle', 'moving', 'working', 'carrying', 'building', 'blocked'].includes(person.mode) ||
          (person.cargo !== null && person.cargo !== 'wood' && person.cargo !== 'ore'))) return null;
    if (!Number.isFinite(world.oreSource) || !Array.isArray(world.trees) ||
        world.stores.some((store) => !store.id || !Number.isFinite(store.x) ||
          !Number.isFinite(store.wood) || !Number.isFinite(store.ore) ||
          !Number.isFinite(store.capacity) || store.capacity < 0 ||
          store.wood < 0 || store.ore < 0 || storeTotal(store) > store.capacity)) return null;
    if (world.gridVersion === GRID_VERSION) return normalizeGridWorld(world);
    if (world.gridVersion === 1 || world.mapVersion === 8) return migrateCurrentGridVersionOne(world);
    const migrated = world.mapVersion === 7 || world.mapVersion === 6 || world.mapVersion === 5 || world.mapVersion === 4 || world.mapVersion === 3
      ? world
      : world.mapVersion === 2
        ? migrateDepthMapSave(world)
        : world.mapVersion === 1 || world.mapVersion === undefined
          ? migrateSideViewSave(world)
          : null;
    return migrated ? migrateWorldGrid(migrateExpansionSave(migrated)) : null;
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
    return oldPlot ? LEGACY_PLOTS.find((plot) => plot.id === oldPlot.id)?.x ?? scaleX(x) : scaleX(x);
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
      ? LEGACY_PLOTS.find((plot) => plot.id === oldPlot.id)?.x ?? mapX(x)
      : mapX(x);
  };

  world.residents = world.residents.map((person) => ({
    ...person,
    x: mapX(person.x),
    y: WORLD.groundY,
    targetX: person.targetX === null ? null : mapX(person.targetX),
    targetY: person.targetY === null ? null : WORLD.groundY
  }));
  world.stores = world.stores.map((savedStore) => {
    const { y: _legacyDepthY, ...store } = savedStore as PrototypeStore & { y?: number };
    return { ...store, x: mapX(store.x) };
  });
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
    const plot = LEGACY_PLOTS.find((candidate) => candidate.id < 4 && Math.abs(candidate.x - structure.x) < 90);
    if (plot) occupied.add(plot.id);
  }
  world.occupiedPlots = [...occupied];
  world.mapVersion = 1;
  return world;
}

function developmentGoal(world: PrototypeWorld): DevelopmentGoal {
  if (!world.buildings.some((building) => building.kind === 'house')) return 'build-first-house';
  const capacity = world.stores.reduce((sum, store) => sum + store.capacity, 0);
  if (capacity < 2 * PROTOTYPE_CONFIG.warehouseCapacity) return 'increase-storage';
  const next = frontierLandCell(world);
  if (!next || next.state === 'closed') return 'unlock-eastern-sector';
  if (next.state !== 'prepared') return 'prepare-eastern-sector';
  return 'build-in-eastern-sector';
}

function frontierLandCell(world: PrototypeWorld): PrototypeLandCell | undefined {
  return EXPANSION_CELL_ORDER.map((id) => world.landCells?.find((cell) => cell.id === id))
    .find((cell): cell is PrototypeLandCell => Boolean(cell && cell.state !== 'prepared'));
}

function syncLegacySector(world: PrototypeWorld): void {
  const frontier = frontierLandCell(world);
  const lastPrepared = [...EXPANSION_CELL_ORDER].reverse()
    .map((id) => world.landCells.find((cell) => cell.id === id))
    .find((cell): cell is PrototypeLandCell => Boolean(cell?.state === 'prepared'));
  const source = frontier ?? lastPrepared;
  if (!source) return;
  world.easternSector.state = source.state === 'occupied' || source.state === 'construction' ||
      source.state === 'prepared'
    ? 'prepared'
    : source.state === 'clearing' ? 'clearing'
      : source.state === 'unlocked' ? 'unlocked' : 'closed';
  world.easternSector.clearingProgress = source.clearingProgress;
  world.easternSector.clearingPaused = source.clearingPaused;
  world.easternSector.clearerId = source.clearerId;
}

function migrateExpansionSave(world: PrototypeWorld): PrototypeWorld {
  const savedSector = world.easternSector;
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
    clearerId: state === 'prepared' ? null : savedClearerId
  };
  const restored: PrototypeWorld = {
    ...world,
    easternSector: sector,
    landCells: migrateLandCells(world, sector),
    roads: Array.isArray(world.roads)
      ? world.roads.filter((road) => typeof road?.id === 'string' &&
          Number.isFinite(road.x) && Number.isFinite(road.builtAt))
        .map((road) => ({ id: road.id, x: road.x, builtAt: road.builtAt }))
      : [],
    easternForestAvailable: typeof world.easternForestAvailable === 'boolean'
      ? world.easternForestAvailable
      : sector.state === 'prepared',
    nextRequestSequence: Math.max(1, Number.isFinite(world.nextRequestSequence)
      ? world.nextRequestSequence : 1),
    currentGoal: 'build-first-house'
  };
  restored.mapVersion = 7;
  if (restored.sourceLayoutVersion !== 1) {
    const defaults = initialStockpiles();
    for (const pile of restored.stockpiles) {
      const sourcePile = defaults.find((candidate) => candidate.sourceId === pile.sourceId);
      if (sourcePile && ['home', 'ore', 'eastern'].includes(pile.sourceId)) pile.x = sourcePile.x;
    }
    for (const person of restored.residents) {
      if (person.pickupStockpileId && !person.cargo) {
        person.targetX = restored.stockpiles.find((pile) => pile.id === person.pickupStockpileId)?.x ?? person.targetX;
      } else if (person.role === 'woodcutter' && person.woodSource === 'eastern' &&
          !person.cargo && !person.targetSiteId && !person.pickupStoreId && person.targetX === 3200) {
        person.targetX = PROTOTYPE_CONFIG.easternSector.forestX;
        person.mode = 'moving';
      }
    }
    restored.sourceLayoutVersion = 1;
  }
  normalizeBuildingRecords(restored);
  restoreLogisticsRequests(restored);
  restoreLogisticsRoutes(restored);
  restoreDemolitionWorkers(restored);
  restored.currentGoal = developmentGoal(restored);
  return restored;
}

const MIGRATABLE_LAND_STATES = ['closed', 'unlocked', 'clearing', 'prepared'] as const;

function copyLandState(target: PrototypeLandCell, source: PrototypeLandCell): void {
  if (!MIGRATABLE_LAND_STATES.includes(source.state as typeof MIGRATABLE_LAND_STATES[number])) return;
  Object.assign(target, {
    state: source.state,
    clearingProgress: Math.max(0, Math.min(1, Number(source.clearingProgress) || 0)),
    clearingPaused: Boolean(source.clearingPaused),
    clearerId: typeof source.clearerId === 'string' ? source.clearerId : null
  });
}

function legacyColumnAt(x: number): number | undefined {
  const oldCell = LEGACY_LAND_GRID_CELLS.find((cell) =>
    cell.role === 'building' && x >= cell.left && x < cell.right
  );
  const mappedId = oldCell ? legacyLandCellIdToGridId(oldCell.id) : undefined;
  return mappedId === undefined ? undefined : landCellById(mappedId)?.column;
}

function nearestBuildablePlot(x: number, usedColumns: Set<number>): (typeof PLOTS)[number] | undefined {
  return PLOTS.filter((plot) => plot.role === 'building' && !usedColumns.has(plot.column))
    .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) || a.column - b.column)[0];
}

function migrateStructureToGrid(
  structure: PrototypeBuilding | PrototypeSite,
  kind: BuildingKind,
  usedColumns: Set<number>
): void {
  const preferredColumn = legacyColumnAt(structure.x);
  const preferredPlot = preferredColumn === undefined
    ? undefined
    : PLOTS.find((plot) => plot.column === preferredColumn && plot.role === 'building' && !usedColumns.has(plot.column));
  const plot = preferredPlot ?? nearestBuildablePlot(structure.x, usedColumns);
  if (!plot) {
    // Preserve the structure record even if a damaged save exceeds the old map.
    // A later grid expansion can place it; never drop an owned building here.
    structure.footprint = footprintFor(kind);
    structure.gridColumn = -1;
    structure.gridRow = LAND_GRID_CONFIG.surfaceCellRow;
    return;
  }
  const footprint = footprintFor(kind);
  structure.gridColumn = plot.column;
  structure.gridRow = LAND_GRID_CONFIG.surfaceCellRow;
  structure.footprint = { ...footprint };
  structure.x = footprintCenterX({ column: plot.column, row: LAND_GRID_CONFIG.surfaceCellRow }, footprint);
  structure.y = WORLD.groundY;
  usedColumns.add(plot.column);
}

function pauseDisabledRoadWork(world: PrototypeWorld): void {
  if (FEATURES.roadsEnabled) return;
  const roadSites = new Set(world.sites.filter((site) => site.kind === 'road').map((site) => site.id));
  for (const site of world.sites) if (site.kind === 'road') site.paused = true;

  const returnCargoToStore = (person: PrototypeResident): void => {
    person.targetSiteId = null;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.pickupStockpileId = null;
    person.pickupAmount = 0;
    if (!person.cargo) {
      person.targetStoreId = null;
      person.targetX = null;
      person.targetY = null;
      person.mode = 'idle';
      person.task = 'Дорожная работа приостановлена';
      person.blockedReason = null;
      person.logisticsRequestId = null;
      return;
    }
    const destination = nearestStoreWithCapacity(world.stores, person.x, () => 0,
      Math.max(1, person.cargoAmount));
    person.targetStoreId = destination?.id ?? null;
    person.targetX = destination?.x ?? null;
    person.targetY = destination ? WORLD.groundY : null;
    person.mode = destination ? 'carrying' : 'blocked';
    person.task = destination ? 'Возвращает груз на склад' : 'Груз сохранён; освободи место на складе';
    person.blockedReason = destination ? null : person.task;
    person.logisticsRequestId = null;
  };

  for (const request of world.logisticsRequests) {
    if (!request.destinationSiteId || !roadSites.has(request.destinationSiteId) ||
        ['completed', 'cancelled'].includes(request.status)) continue;
    const hauler = request.assignedHaulerId
      ? world.residents.find((person) => person.id === request.assignedHaulerId)
      : world.residents.find((person) => person.logisticsRequestId === request.id);
    if (hauler) returnCargoToStore(hauler);
    request.status = 'cancelled';
    request.assignedHaulerId = null;
  }
  for (const person of world.residents) {
    if (person.targetSiteId && roadSites.has(person.targetSiteId)) returnCargoToStore(person);
  }
}

function normalizeGridWorld(world: PrototypeWorld): PrototypeWorld {
  const savedLandCells = Array.isArray(world.landCells) ? world.landCells : [];
  const landCells = initialLandCells();
  for (const saved of savedLandCells) {
    const target = landCells.find((candidate) => candidate.id === saved.id);
    if (!target) continue;
    copyLandState(target, saved);
    target.column = landCellById(target.id)?.column;
    target.row = landCellById(target.id)?.row;
    target.x = landCellById(target.id)?.centerX ?? target.x;
    target.y = landCellById(target.id)?.centerY ?? target.y;
  }
  world.landCells = landCells;
  world.gridVersion = GRID_VERSION;
  world.mapVersion = MAP_VERSION;
  world.roads ??= [];
  world.occupiedPlots ??= [];
  world.sites ??= [];
  world.buildings ??= [];
  world.stores ??= [];
  world.residents ??= [];
  for (const person of world.residents) {
    person.woodSource = person.woodSource === 'eastern' ? 'eastern' : 'home';
  }
  for (const building of world.buildings) normalizeStructureGrid(building, building.kind);
  for (const site of world.sites) {
    const structureKind = buildingKindForSite(site.kind);
    if (structureKind && site.kind !== 'house-upgrade') normalizeStructureGrid(site, structureKind);
  }
  normalizeBuildingRecords(world);
  world.occupiedPlots = occupiedCellIds(world);
  for (const cell of landCells) {
    if (world.occupiedPlots.includes(cell.id) && cell.state !== 'prepared') {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
    if (landCellById(cell.id)?.role === 'reserved-resource') {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
    if (cell.state === 'clearing') {
      const clearer = cell.clearerId
        ? world.residents.find((person) => person.id === cell.clearerId)
        : undefined;
      if (!clearer) {
        cell.clearerId = null;
        cell.clearingPaused = true;
      } else if (clearer.cargo || !['builder', 'idle'].includes(clearer.role)) {
        cell.clearingPaused = true;
      }
    }
  }
  restoreLogisticsRequests(world);
  restoreLogisticsRoutes(world);
  restoreDemolitionWorkers(world);
  pauseDisabledRoadWork(world);
  syncLegacySector(world);
  world.currentGoal = developmentGoal(world);
  return world;
}

/** Move saves made on the intermediate grid down one row without changing world coordinates. */
function migrateCurrentGridVersionOne(world: PrototypeWorld): PrototypeWorld {
  const savedCells = Array.isArray(world.landCells) ? world.landCells : [];
  const landCells = initialLandCells();
  for (const oldCell of savedCells) {
    const column = Number.isInteger(oldCell.column) ? oldCell.column! : oldCell.id % LAND_GRID_CONFIG.columns;
    const oldRow = Number.isInteger(oldCell.row)
      ? oldCell.row!
      : Math.floor(oldCell.id / LAND_GRID_CONFIG.columns);
    const targetGeometry = landCellAtCoordinate(column, oldRow + 1);
    const target = targetGeometry && landCells.find((cell) => cell.id === targetGeometry.id);
    if (target) copyLandState(target, oldCell);
  }
  for (const building of world.buildings) {
    if (!Number.isInteger(building.gridColumn)) building.gridColumn = anchorColumnForWorldX(building.x);
    building.gridRow = LAND_GRID_CONFIG.surfaceCellRow;
  }
  for (const site of world.sites) {
    if (site.kind === 'road' || site.kind === 'house-upgrade') continue;
    if (!Number.isInteger(site.gridColumn)) site.gridColumn = anchorColumnForWorldX(site.x);
    site.gridRow = LAND_GRID_CONFIG.surfaceCellRow;
  }
  const oldOccupied = Array.isArray(world.occupiedPlots) ? world.occupiedPlots : [];
  world.occupiedPlots = [...new Set(oldOccupied.flatMap((id) => {
    const column = id % LAND_GRID_CONFIG.columns;
    const oldRow = Math.floor(id / LAND_GRID_CONFIG.columns);
    const target = landCellAtCoordinate(column, oldRow + 1);
    return target ? [target.id] : [];
  }))];
  world.landCells = landCells;
  world.gridVersion = GRID_VERSION;
  world.mapVersion = MAP_VERSION;
  return normalizeGridWorld(world);
}

/** Upgrade the one-dimensional mapVersion ≤ 7 without deleting owned state. */
function migrateWorldGrid(world: PrototypeWorld): PrototypeWorld {
  if (world.gridVersion === GRID_VERSION) return normalizeGridWorld(world);
  const oldCells = Array.isArray(world.landCells) ? world.landCells : [];
  const landCells = initialLandCells();
  for (const oldCell of oldCells) {
    const id = legacyLandCellIdToGridId(oldCell.id);
    if (id === undefined) continue;
    const target = landCells.find((candidate) => candidate.id === id);
    if (target) copyLandState(target, oldCell);
  }

  const usedColumns = new Set<number>();
  const oldXByStructure = new Map<string, number>();
  for (const building of [...world.buildings].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
    oldXByStructure.set(building.id, building.x);
    migrateStructureToGrid(building, building.kind, usedColumns);
  }
  for (const site of [...world.sites].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
    if (site.kind === 'road' || site.kind === 'house-upgrade') continue;
    oldXByStructure.set(site.id, site.x);
    migrateStructureToGrid(site, site.kind, usedColumns);
  }

  const oldOccupied = Array.isArray(world.occupiedPlots) ? world.occupiedPlots : [];
  world.occupiedPlots = [...new Set(oldOccupied.flatMap((oldId) => {
    const id = legacyLandCellIdToGridId(oldId);
    return id === undefined ? [] : [id];
  }))];
  world.landCells = landCells;
  world.gridVersion = GRID_VERSION;
  world.mapVersion = MAP_VERSION;

  for (const store of world.stores) {
    const linked = world.buildings.find((building) => building.kind === 'warehouse' &&
      (building.id === store.buildingId || Math.abs((oldXByStructure.get(building.id) ?? building.x) - store.x) < 1));
    if (linked) {
      store.buildingId = linked.id;
      store.x = linked.x;
    } else {
      const preferred = legacyColumnAt(store.x);
      const plot = preferred === undefined ? nearestBuildablePlot(store.x, new Set()) :
        PLOTS.find((candidate) => candidate.column === preferred && candidate.role === 'building');
      if (plot) store.x = plot.x;
    }
  }

  const defaultPiles = initialStockpiles();
  for (const pile of world.stockpiles ?? []) {
    const defaultPile = defaultPiles.find((candidate) => candidate.sourceId === pile.sourceId);
    if (defaultPile && ['home', 'stone', 'eastern'].includes(pile.sourceId)) pile.x = defaultPile.x;
  }
  for (const person of world.residents) {
    person.woodSource = person.woodSource === 'eastern' ? 'eastern' : 'home';
    person.targetY = person.targetY === null ? null : WORLD.groundY;
    const site = person.targetSiteId ? world.sites.find((candidate) => candidate.id === person.targetSiteId) : undefined;
    const store = person.targetStoreId || person.pickupStoreId
      ? world.stores.find((candidate) => candidate.id === (person.targetStoreId ?? person.pickupStoreId))
      : undefined;
    const pile = person.pickupStockpileId
      ? world.stockpiles.find((candidate) => candidate.id === person.pickupStockpileId)
      : undefined;
    if (site && site.kind !== 'road') {
      person.targetX = site.x;
      person.targetY = WORLD.groundY;
    } else if (store) {
      person.targetX = store.x;
      person.targetY = WORLD.groundY;
    } else if (pile) {
      person.targetX = pile.x;
      person.targetY = WORLD.groundY;
    } else if (person.role === 'miner' && !person.cargo) {
      person.targetX = PROTOTYPE_CONFIG.sources.oreX;
      person.targetY = WORLD.groundY;
    } else if (person.role === 'woodcutter' && !person.cargo) {
      person.targetX = person.woodSource === 'eastern'
        ? PROTOTYPE_CONFIG.easternSector.forestX : PROTOTYPE_CONFIG.sources.homeX;
      person.targetY = WORLD.groundY;
    }
  }
  for (const cell of landCells) {
    if (cell.clearerId) {
      const worker = world.residents.find((person) => person.id === cell.clearerId);
      if (worker) {
        worker.targetX = cell.x;
        worker.targetY = WORLD.groundY;
      }
    }
  }

  normalizeBuildingRecords(world);
  world.occupiedPlots = occupiedCellIds(world);
  for (const cell of landCells) {
    if (world.occupiedPlots.includes(cell.id) && cell.state !== 'prepared') {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
    if (landCellById(cell.id)?.role === 'reserved-resource') {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
  }
  let furthestPrepared = -1;
  for (let index = 0; index < EXPANSION_CELL_ORDER.length; index += 1) {
    const cell = landCells.find((candidate) => candidate.id === EXPANSION_CELL_ORDER[index]);
    if (cell?.state === 'prepared' || world.occupiedPlots.includes(cell?.id ?? -1)) furthestPrepared = index;
  }
  for (let index = 0; index <= furthestPrepared; index += 1) {
    const cell = landCells.find((candidate) => candidate.id === EXPANSION_CELL_ORDER[index]);
    if (cell) {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
  }

  restoreLogisticsRequests(world);
  restoreLogisticsRoutes(world);
  restoreDemolitionWorkers(world);
  pauseDisabledRoadWork(world);
  syncLegacySector(world);
  world.currentGoal = developmentGoal(world);
  return world;
}

function migrateLandCells(world: PrototypeWorld, savedSector: PrototypeEasternSector): PrototypeLandCell[] {
  const migrated = initialLegacyLandCells();
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

  // The v1.0 map adds one cell in the gap before old plot 4. If an older save
  // had already opened that eastern frontier, prepare the inserted connector
  // so the previous land claim remains reachable without moving any building.
  const insertedConnector = migrated.find((candidate) => candidate.id === 9);
  const connectorState = insertedConnector?.state;
  const firstExpansion = migrated.find((candidate) => candidate.id === LEGACY_LAND_GRID_EXPANSION_ORDER[0]);
  // Map v4 briefly used the existing stone-source cell as its first expansion.
  // Carry that land claim to old plot 4 before restoring the resource cell.
  const savedMapVersion = (world as PrototypeWorld).mapVersion;
  if (savedMapVersion === 4 && insertedConnector && firstExpansion && firstExpansion.state === 'closed' &&
      connectorState && connectorState !== 'closed') {
    firstExpansion.state = connectorState;
    firstExpansion.clearingProgress = insertedConnector.clearingProgress;
    firstExpansion.clearingPaused = insertedConnector.clearingPaused;
    firstExpansion.clearerId = insertedConnector.clearerId;
  }
  const oldFrontier = Array.isArray(savedCells)
    ? savedCells.find((candidate) => candidate.id === 4)
    : savedSector.state !== 'closed' ? { state: savedSector.state } : undefined;
  if (insertedConnector && oldFrontier && oldFrontier.state !== 'closed') {
    insertedConnector.state = 'prepared';
    insertedConnector.clearingProgress = 1;
    insertedConnector.clearingPaused = false;
    insertedConnector.clearerId = null;
  }
  const occupiedIds = new Set(world.occupiedPlots);
  for (const structure of [...world.buildings, ...world.sites]) {
    const candidate = LEGACY_PLOTS.find((plot) => Math.abs(plot.x - structure.x) < 90);
    if (candidate) occupiedIds.add(candidate.id);
  }
  for (const cell of migrated) {
    if (cell.id < 4 || cell.id === 8 || occupiedIds.has(cell.id)) {
      cell.state = 'prepared';
      cell.clearingProgress = 1;
      cell.clearingPaused = false;
      cell.clearerId = null;
    }
  }
  if (insertedConnector) {
    insertedConnector.state = 'prepared';
    insertedConnector.clearingProgress = 1;
    insertedConnector.clearingPaused = false;
    insertedConnector.clearerId = null;
  }
  for (const cell of migrated) {
    if (legacyLandCellById(cell.id)?.role !== 'reserved-resource') continue;
    cell.state = 'prepared';
    cell.clearingProgress = 1;
    cell.clearingPaused = false;
    cell.clearerId = null;
  }
  // Remove unreachable openings from old data; the eastward frontier follows
  // world position even though legacy cell IDs remain stable.
  let connected = true;
  for (const id of LEGACY_LAND_GRID_EXPANSION_ORDER) {
    const cell = migrated.find((candidate) => candidate.id === id)!;
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
	const reserveIncoming = (storeId: string, amount: number) => {
		incomingByStore.set(storeId, (incomingByStore.get(storeId) ?? 0) + amount);
	};
	const incomingReservations = (storeId: string) => incomingByStore.get(storeId) ?? 0;

  for (const person of world.residents) {
    const site = person.targetSiteId
      ? world.sites.find((candidate) => candidate.id === person.targetSiteId)
      : undefined;
    const request = person.logisticsRequestId
      ? world.logisticsRequests.find((candidate) => candidate.id === person.logisticsRequestId &&
        candidate.assignedHaulerId === person.id && !['completed', 'cancelled'].includes(candidate.status))
      : undefined;
    if (person.cargo) {
      const cargoAmount = Math.max(1, person.cargoAmount || 1);
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
        store.id === person.targetStoreId && hasStoreCapacity(store, incomingReservations(store.id), cargoAmount))
        : undefined;
		const destination = savedDestination ??
      nearestStoreWithCapacity(world.stores, person.x, incomingReservations, cargoAmount);
      if (destination) {
      person.cargoAmount = cargoAmount;
      reserveIncoming(destination.id, cargoAmount);
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

    const savedStoreId = person.targetStoreId;
    person.targetStoreId = null;
		const stockpileId = person.pickupStockpileId ?? request?.pickupStockpileId;
		const stockpile = stockpileId
			? world.stockpiles.find((candidate) => candidate.id === stockpileId && candidate.amount > 0)
			: undefined;
		if (stockpile) {
			person.pickupStockpileId = stockpile.id;
			person.pickupResource = stockpile.resource;
			person.pickupAmount = Math.max(1, person.pickupAmount || request?.amount || 1);
			person.targetSiteId = request?.destinationSiteId ?? site?.id ?? null;
			person.targetStoreId = request?.destinationStoreId ?? (isLooseMaterial(stockpile) ? savedStoreId : null);
			person.targetX = stockpile.x;
			person.targetY = WORLD.groundY;
			person.mode = 'moving';
			person.task = 'Продолжает путь к местной куче';
			person.blockedReason = null;
			continue;
		}
    const pickup = person.pickupStoreId
      ? world.stores.find((store) => store.id === person.pickupStoreId)
      : undefined;
    if (site && pickup && person.pickupResource) {
      person.targetSiteId = site?.id ?? null;
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
  public readonly activity = {
    harvested: { wood: 0, ore: 0 },
    produced: { wood: 0, ore: 0 },
    delivered: { wood: 0, ore: 0 }
  };
  private progressSignature = '';
  private lastProgressAt = 0;
  public diagnostics: { stalledSeconds: number; issues: string[] } = { stalledSeconds: 0, issues: [] };
  constructor(public world: PrototypeWorld, private readonly onChange: (message?: string) => void = () => {}) {
    if (world.gridVersion !== GRID_VERSION) {
      if (world.gridVersion === 1 || world.mapVersion === 8) {
        this.world = migrateCurrentGridVersionOne(world);
      } else {
        const legacy = world.mapVersion === 7 ? world : migrateExpansionSave(world);
        this.world = migrateWorldGrid(legacy);
      }
      world = this.world;
    }
    world.productionSettings = boundedProductionSettings(world.productionSettings);
    if (!Array.isArray(world.landCells)) world.landCells = initialLandCells();
    if (!Array.isArray(world.roads)) world.roads = [];
    for (const site of world.sites ?? []) {
      site.priority = Math.max(1, Math.min(3, Math.round(site.priority ?? 2))) as ProductionPriority;
      site.paused = site.paused === true;
    }
    if (!Array.isArray(world.stockpiles)) world.stockpiles = initialStockpiles();
    if (!Array.isArray(world.logisticsRequests)) world.logisticsRequests = [];
    if (!Number.isFinite(world.nextRequestSequence)) world.nextRequestSequence = 1;
    normalizeBuildingRecords(world);
    // Compatibility for callers that set the legacy sector summary directly.
    if (world.easternSector?.state === 'prepared' &&
        !EXPANSION_CELL_ORDER.some((id) => world.landCells.find((cell) => cell.id === id)?.state === 'prepared')) {
      for (const id of EXPANSION_CELL_ORDER.slice(0, 2)) {
        const cell = world.landCells.find((candidate) => candidate.id === id);
        if (cell) { cell.state = 'prepared'; cell.clearingProgress = 1; }
      }
    } else if (world.easternSector && world.easternSector.state !== 'closed') {
      const cell = world.landCells.find((candidate) => candidate.id === EXPANSION_CELL_ORDER[0]);
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
    restoreDemolitionWorkers(world);
    pauseDisabledRoadWork(world);
    this.refreshLogisticsRequests();
  }

  replaceWorld(world: PrototypeWorld): void {
    const replacement = new PrototypeSimulation(world, this.onChange);
    this.world = replacement.world;
    this.progressSignature = '';
    this.lastProgressAt = 0;
    this.diagnostics = { stalledSeconds: 0, issues: [] };
    for (const resource of ['wood', 'ore'] as const) {
      this.activity.harvested[resource] = 0;
      this.activity.produced[resource] = 0;
      this.activity.delivered[resource] = 0;
    }
  }

  assign(residentId: string, role: WorkRole): boolean {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person) return false;
    const demolition = this.world.buildings.find((building) =>
      building.demolition?.workerId === residentId && !building.demolition.paused);
    if (demolition?.demolition && role === 'builder') return true;
    if (demolition?.demolition) {
      demolition.demolition = {
        ...demolition.demolition,
        workerId: null,
        paused: true,
        blockedReason: 'Строитель сменил профессию; прогресс сохранён.'
      };
    }
    if (person.role !== role) {
      if (person.role === 'woodcutter') {
        for (const tree of this.world.trees) if (tree.workerId === person.id) tree.workerId = null;
      }
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
    this.refreshLogisticsRequests();
    this.onChange(`${person.name}: ${ROLE_LABEL[role]}`);
    return true;
  }

  setLogisticsMode(residentId: string, mode: LogisticsMode): boolean {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person || person.role === 'idle' || person.role === 'hauler') return false;
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
    this.refreshLogisticsRequests();
    if (!person.cargo && (person.mode === 'blocked' || person.mode === 'idle') &&
        !this.isActiveClearingWorker(person) && !this.world.buildings.some((building) =>
          building.demolition?.workerId === person.id && !building.demolition.paused)) {
      this.clearHaulerRoute(person);
      person.mode = 'idle';
      if (person.role === 'builder') this.planDelivery(person);
      else this.planHarvest(person);
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

  setProductionQuota(resource: Resource, quota: number): number {
    const settings = this.world.productionSettings ??= boundedProductionSettings();
    settings.quota[resource] = boundedProductionSettings({ quota: { ...settings.quota, [resource]: quota },
      priority: settings.priority }).quota[resource];
    const updated = settings.quota[resource];
    for (const person of this.world.residents) {
      const worksResource = resource === 'wood' ? person.role === 'woodcutter' : person.role === 'miner';
      if (!worksResource || person.cargo || !person.blockedReason?.startsWith('Лимит добычи')) continue;
      person.mode = 'idle';
      person.blockedReason = null;
      this.planHarvest(person);
    }
    this.onChange(`Лимит ${resourceLabelGenitive(resource)} установлен: ${updated} ед.`);
    return updated;
  }

  setProductionPriority(resource: Resource, priority: number): ProductionPriority {
    const settings = this.world.productionSettings ??= boundedProductionSettings();
    settings.priority[resource] = boundedProductionSettings({ quota: settings.quota,
      priority: { ...settings.priority, [resource]: priority } }).priority[resource];
    const updated = settings.priority[resource];
    this.refreshLogisticsRequests();
    this.onChange(`Приоритет перевозки ${resourceLabelGenitive(resource)}: ${productionPriorityLabel(updated)}.`);
    return updated;
  }

  setSitePriority(siteId: string, priority: number): boolean {
    const site = this.world.sites.find((candidate) => candidate.id === siteId);
    if (!site || site.kind === 'road' && !FEATURES.roadsEnabled) return false;
    site.priority = Math.max(1, Math.min(3, Math.round(Number.isFinite(priority) ? priority : 2))) as ProductionPriority;
    this.refreshLogisticsRequests();
    for (const person of this.world.residents.filter((candidate) => candidate.role === 'builder' && !candidate.cargo)) {
      if (person.mode === 'idle' || person.mode === 'blocked') this.planDelivery(person);
    }
    this.onChange(`Приоритет стройки ${site.kind === 'house' ? 'дома' : site.kind === 'road' ? 'дороги' : 'склада'}: ${productionPriorityLabel(site.priority)}.`);
    return true;
  }

  toggleSitePaused(siteId: string): boolean {
    const site = this.world.sites.find((candidate) => candidate.id === siteId);
    if (!site || site.kind === 'road' && !FEATURES.roadsEnabled) return false;
    site.paused = !site.paused;
    if (site.paused) {
      for (const request of this.world.logisticsRequests.filter((candidate) =>
        candidate.type === 'DELIVER_TO_CONSTRUCTION' && candidate.destinationSiteId === site.id &&
        ['queued', 'assigned', 'blocked'].includes(candidate.status))) this.cancelUnpickedRequest(request);
      for (const person of this.world.residents.filter((candidate) => candidate.role === 'builder' &&
        candidate.targetSiteId === site.id && !candidate.cargo)) {
        person.targetSiteId = null;
        person.targetX = null;
        person.targetY = null;
        person.pickupStoreId = null;
        person.pickupResource = null;
        person.pickupStockpileId = null;
        person.pickupAmount = 0;
        person.mode = 'blocked';
        person.blockedReason = 'Стройка приостановлена игроком.';
        person.task = person.blockedReason;
      }
    } else {
      for (const person of this.world.residents.filter((candidate) => candidate.role === 'builder' && !candidate.cargo &&
        (candidate.mode === 'blocked' || candidate.mode === 'idle'))) {
        person.blockedReason = null;
        person.mode = 'idle';
        this.planDelivery(person);
      }
    }
    this.refreshLogisticsRequests();
    this.onChange(site.paused ? 'Стройка приостановлена. Прогресс сохранён.' : 'Стройка возобновлена.');
    return true;
  }

  unlockEasternSector(): { ok: true } | { ok: false; reason: string } {
    const cell = frontierLandCell(this.world);
    if (!cell || cell.state !== 'closed') return { ok: false, reason: 'Нет соседней закрытой клетки для открытия.' };
    if (!this.world.buildings.some((building) => building.kind === 'house')) {
      return { ok: false, reason: 'Сначала построй первый дом.' };
    }
    const cost = PROTOTYPE_CONFIG.expansion.unlockCost;
    const availableWood = this.spendableResource('wood');
    const availableOre = this.spendableResource('ore');
    if (availableWood < cost.wood || availableOre < cost.ore) {
      const missing: string[] = [];
      if (availableWood < cost.wood) missing.push(`дерева ${availableWood}/${cost.wood}`);
      if (availableOre < cost.ore) missing.push(`породы ${availableOre}/${cost.ore}`);
      return { ok: false, reason: `Не хватает на открытие: ${missing.join(', ')}.` };
    }
    this.spendFromStores('wood', cost.wood);
    this.spendFromStores('ore', cost.ore);
    cell.state = 'unlocked';
    cell.clearingProgress = 0;
    cell.clearingPaused = false;
    cell.clearerId = null;
    syncLegacySector(this.world);
    this.syncDevelopmentGoal();
    this.onChange(`Открыта земельная клетка ${landCellNumber(cell.id)}. Она примыкает к поселению; дальше потребуется отдельная расчистка.`);
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
    this.onChange(`${worker.name} направлен расчищать земельную клетку ${landCellNumber(cell.id)}.`);
    return { ok: true };
  }

  isPlotAvailable(plotId: number, kind: BuildingKind = 'house'): boolean {
    const cell = landCellById(plotId);
    if (!cell) return false;
    return this.canPlaceFootprint(
      { column: cell.column, row: cell.row }, footprintFor(kind), kind
    ).ok;
  }

  canPlaceFootprint(
    anchor: { column: number; row: number }, footprint: GridFootprint, kind?: BuildingKind
  ): { ok: true; cellIds: number[] } | { ok: false; reason: string; cellIds: number[] } {
    const cells = cellsForFootprint(anchor, footprint);
    if (!cells) return { ok: false, reason: 'Размер здания выходит за пределы сетки.', cellIds: [] };
    const baseCells = cells.filter((cell) => cell.row === anchor.row);
    if (baseCells.length !== footprint.widthCells || baseCells.some((cell) => cell.environment !== 'surface')) {
      return { ok: false, reason: 'Опора здания должна целиком стоять на поверхности.', cellIds: cells.map((cell) => cell.id) };
    }
    if (cells.some((cell) => cell.row < anchor.row && cell.environment !== 'air')) {
      return { ok: false, reason: 'Над зданием должно оставаться воздушное пространство.', cellIds: cells.map((cell) => cell.id) };
    }
    const anchorCell = landCellAtCoordinate(anchor.column, anchor.row);
    const kindForFootprint = kind ?? (footprint.widthCells === 2 && footprint.heightCells === 1 ? 'sawmill' : undefined);
    const anchorTree = this.world.trees.find((tree) => tree.cellId === anchorCell?.id);
    const sawmillPlacement = kindForFootprint === 'sawmill';
    const minePlacement = kindForFootprint === 'mine';
    const oreCell = anchorCell?.resource === 'ore-main';
    if (sawmillPlacement && (!anchorTree || anchorTree.state !== 'mature')) {
      return { ok: false, reason: 'Лесопилка строится на клетке взрослого дерева.', cellIds: cells.map((cell) => cell.id) };
    }
    if (minePlacement && (!oreCell || this.world.buildings.some((building) => building.kind === 'mine') ||
        this.world.sites.some((site) => site.kind === 'mine'))) {
      return { ok: false, reason: 'Шахту можно построить только на свободной клетке залежи породы.', cellIds: cells.map((cell) => cell.id) };
    }
    for (const cell of baseCells) {
      const specialAnchor = cell.id === anchorCell?.id &&
        (sawmillPlacement && anchorTree || minePlacement && oreCell);
      if (cell.role === 'reserved-resource' && !specialAnchor) {
        return { ok: false, reason: 'Часть опоры занята природным источником.', cellIds: cells.map((candidate) => candidate.id) };
      }
      const tree = this.world.trees.find((candidate) => candidate.cellId === cell.id);
      if (tree && !(sawmillPlacement && tree.id === anchorTree?.id)) {
        return { ok: false, reason: 'Клетка занята деревом. Лесопилку можно строить только на взрослом дереве.', cellIds: cells.map((candidate) => candidate.id) };
      }
      const state = this.landCellState(cell.id);
      if (state !== 'prepared' && !specialAnchor) {
        const reason = state === 'occupied' || state === 'construction'
          ? 'Одна из опорных клеток уже занята.'
          : state === 'closed'
            ? 'Эта территория закрыта. Сначала открой соседнюю клетку.'
            : state === 'unlockable'
              ? 'Сначала открой клетку, затем полностью расчисти её.'
              : baseCells.length === 1
                ? 'Сначала полностью расчисти эту клетку.'
                : 'Сначала полностью расчисти все опорные клетки.';
        return { ok: false, reason, cellIds: cells.map((candidate) => candidate.id) };
      }
    }
    const blocked = new Set(this.world.occupiedPlots);
    for (const structure of [...this.world.buildings, ...this.world.sites]) {
      if (structure.kind === 'road') continue;
      for (const id of structureCellIds(structure)) blocked.add(id);
    }
    if (cells.some((cell) => blocked.has(cell.id))) {
      return { ok: false, reason: 'Часть этого footprint уже занята зданием или площадкой.', cellIds: cells.map((cell) => cell.id) };
    }
    return { ok: true, cellIds: cells.map((cell) => cell.id) };
  }

  landCellState(plotId: number): LandCellState | null {
    const geometry = landCellById(plotId);
    const stored = this.world.landCells.find((candidate) => candidate.id === plotId);
    if (!geometry || !stored) return null;
    if (this.world.trees.some((tree) => tree.cellId === plotId)) return 'occupied';
    if (geometry.role === 'reserved-resource') {
      return geometry.resource === 'home-wood' || geometry.resource === 'ore-main' || this.hasEasternForest()
        ? 'occupied' : 'closed';
    }
    if (this.world.sites.some((site) => site.kind !== 'road' && structureCellIds(site).includes(plotId))) return 'construction';
    if (this.world.buildings.some((building) => structureCellIds(building).includes(plotId)) ||
        this.world.occupiedPlots.includes(plotId)) return 'occupied';
    if (geometry.environment === 'air') return 'prepared';
    if (geometry.environment === 'soil') return stored.state;
    if (stored.state === 'closed' && frontierLandCell(this.world)?.id === plotId) return 'unlockable';
    return stored.state;
  }

  place(
    kind: BuildingKind, plotId: number, requestedFootprint: GridFootprint = footprintFor(kind)
  ): { ok: true } | { ok: false; reason: string } {
    const plot = landCellById(plotId);
    if (!plot || plot.environment !== 'surface') {
      return { ok: false, reason: 'Выбери опорную клетку на поверхности земли.' };
    }
    const placement = this.canPlaceFootprint(
      { column: plot.column, row: plot.row }, requestedFootprint, kind
    );
    if (!placement.ok) return { ok: false, reason: placement.reason };
    if (this.world.sites.filter((site) => site.kind !== 'road').length >= 2) {
      return { ok: false, reason: 'Сначала заверши или отмени одну из площадок.' };
    }
    const anchor = { column: plot.column, row: plot.row };
    const id = `site-${this.world.nextId++}`;
    this.world.occupiedPlots = [...new Set([...this.world.occupiedPlots, ...placement.cellIds])].sort((a, b) => a - b);
    this.world.sites.push({
      id, kind, x: footprintCenterX(anchor, requestedFootprint), y: WORLD.groundY,
      gridColumn: anchor.column, gridRow: anchor.row, footprint: { ...requestedFootprint },
      deliveredWood: 0, deliveredOre: 0,
      ...(kind === 'sawmill' ? { sourceTreeId: this.world.trees.find((tree) => tree.cellId === plot.id)?.id ?? null } : {}),
      progress: 0, stage: 0, priority: 2, paused: false
    });
    this.syncDevelopmentGoal();
    this.onChange(kind === 'house' ? 'Площадка дома готова. Назначь строителя и добывай материалы.'
      : kind === 'warehouse' ? 'Площадка склада готова. Строитель доставит материалы.'
        : kind === 'sawmill' ? 'Лесопилка привязана к дереву и займет соседнюю клетку.'
          : 'Шахта будет построена на залежи породы.');
    return { ok: true };
  }

  plantTree(cellId: number): { ok: true; treeId: string } | { ok: false; reason: string } {
    const cell = landCellById(cellId);
    if (!cell || cell.environment !== 'surface' || this.landCellState(cellId) !== 'prepared') {
      return { ok: false, reason: 'Выбери подготовленную свободную клетку на поверхности.' };
    }
    const cost = PROTOTYPE_CONFIG.trees.plantingCost;
    const available = this.spendableResource('wood');
    if (available < cost) return { ok: false, reason: `Для посадки нужно ${cost} древесины; доступно ${available}.` };
    this.spendFromStores('wood', cost);
    const sourceId: WoodSourceId = cell.centerX > PROTOTYPE_CONFIG.easternSector.boundaryX ? 'eastern' : 'home';
    const id = `tree-${this.world.nextId++}`;
    this.world.trees.push({ id, cellId, sourceId, x: cell.centerX, state: 'growing', growthSeconds: 0,
      cutProgress: 0, stateSeconds: 0, workerId: null, planted: true });
    this.world.stockpiles.push({ id: `pile-wood-${id}`, sourceId: `tree-${id}`, resource: 'wood',
      x: cell.centerX, amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity, treeId: id });
    this.onChange(`Дерево посажено. До взросления потребуется ${PROTOTYPE_CONFIG.trees.initialGrowthSeconds} секунд игрового времени.`);
    return { ok: true, treeId: id };
  }

  removeTree(treeId: string): { ok: true } | { ok: false; reason: string } {
    const tree = this.world.trees.find((candidate) => candidate.id === treeId);
    if (!tree || !tree.planted) return { ok: false, reason: 'Удалять можно только посаженное дерево.' };
    if (this.world.buildings.some((building) => building.kind === 'sawmill' &&
        !building.demolition && building.sourceTreeId === tree.id) ||
        this.world.sites.some((site) => site.kind === 'sawmill' && site.sourceTreeId === tree.id)) {
      return { ok: false, reason: 'Сначала убери лесопилку, привязанную к этому дереву.' };
    }
    if (tree.workerId) {
      const worker = this.world.residents.find((person) => person.id === tree.workerId);
      if (worker && !worker.cargo) {
        worker.mode = 'idle'; worker.progress = 0; worker.targetX = null; worker.targetY = null;
        worker.blockedReason = null; worker.task = 'Источник древесины удалён';
      }
      tree.workerId = null;
    }
    const pile = this.world.stockpiles.find((candidate) => candidate.treeId === tree.id);
    if (pile) {
      if (pile.amount > 0) {
        delete pile.treeId;
        pile.sourceId = 'removed-tree';
        pile.capacity = PROTOTYPE_CONFIG.stockpile.capacity;
      } else this.world.stockpiles = this.world.stockpiles.filter((candidate) => candidate.id !== pile.id);
    }
    this.world.trees = this.world.trees.filter((candidate) => candidate.id !== tree.id);
    this.onChange('Посаженное дерево удалено; его клетка снова свободна. Остаток древесины сохранён на земле.');
    return { ok: true };
  }

  startHouseUpgrade(buildingId: string): { ok: true } | { ok: false; reason: string } {
    const building = this.world.buildings.find((candidate) => candidate.id === buildingId && candidate.kind === 'house');
    if (!building) return { ok: false, reason: 'Дом больше не найден.' };
    if ((building.level ?? 1) >= 2) return { ok: false, reason: 'Этот дом уже улучшен до второго уровня.' };
    if (building.demolition) return { ok: false, reason: 'Сначала останови снос дома.' };
    const cost = COST['house-upgrade'];
    const missing: string[] = [];
    for (const resource of ['wood', 'ore'] as const) {
      const available = this.spendableResource(resource);
      if (available < cost[resource]) missing.push(`${resourceLabelGenitive(resource)} ${available}/${cost[resource]}`);
    }
    if (missing.length) return { ok: false, reason: `Для улучшения нужны ${missing.join(' и ')} на складе.` };
    if (this.world.sites.some((site) => site.upgradeBuildingId === building.id)) {
      return { ok: false, reason: 'Улучшение этого дома уже идёт.' };
    }
    if (this.world.sites.filter((site) => site.kind !== 'road').length >= 2) {
      return { ok: false, reason: 'Сначала заверши или отмени одну из площадок.' };
    }
    const id = `site-${this.world.nextId++}`;
    this.world.sites.push({
      id, kind: 'house-upgrade', x: building.x, y: building.y,
      gridColumn: building.gridColumn, gridRow: building.gridRow,
      footprint: { ...(building.footprint ?? footprintFor('house')) },
      upgradeBuildingId: building.id,
      deliveredWood: 0, deliveredOre: 0,
      progress: 0, stage: 0, priority: 2, paused: false
    });
    this.refreshLogisticsRequests();
    this.onChange('Улучшение начато: грузчики доставят древесину и породу к дому.');
    return { ok: true };
  }

  roadPositionAt(worldX: number): number | null {
    if (!FEATURES.roadsEnabled) return null;
    return snapRoadPosition(worldX, WORLD.width);
  }

  roadPlacementError(worldX: number): string | null {
    if (!FEATURES.roadsEnabled) return 'Дорожная механика временно отключена.';
    const x = this.roadPositionAt(worldX);
    if (x === null) return 'Дорожный сегмент должен целиком находиться в пределах мира.';
    const half = ROAD_CONFIG.segmentLength / 2;
    const left = x - half, right = x + half;
    const covered = LAND_GRID_CELLS.filter((cell) =>
      cell.environment === 'surface' && cell.left < right && cell.right > left);
    const inaccessible = covered.find((cell) => {
      const state = this.landCellState(cell.id);
      return state !== 'prepared' && state !== 'occupied' && state !== 'construction';
    });
    if (inaccessible) {
      const state = this.landCellState(inaccessible.id);
      return state === 'closed' || state === 'unlockable'
        ? 'Нельзя прокладывать дорогу в закрытом лесу. Сначала освой эту территорию.'
        : 'Дорогу можно прокладывать только на подготовленной территории.';
    }
    if (this.world.roads.some((road) => Math.abs(road.x - x) < ROAD_CONFIG.segmentLength - 1e-8) ||
        this.world.sites.some((site) => site.kind === 'road' && Math.abs(site.x - x) < ROAD_CONFIG.segmentLength - 1e-8)) {
      return 'На этом участке уже есть дорожный сегмент или задание.';
    }
    if (this.world.roads.length + this.world.sites.filter((site) => site.kind === 'road').length >= 80) {
      return 'Достигнут предел дорожных сегментов в этом поселении.';
    }
    return null;
  }

  placeRoad(worldX: number): { ok: true; x: number } | { ok: false; reason: string } {
    if (!FEATURES.roadsEnabled) return { ok: false, reason: 'Дорожная механика временно отключена.' };
    const reason = this.roadPlacementError(worldX);
    const x = this.roadPositionAt(worldX);
    if (reason || x === null) return { ok: false, reason: reason ?? 'Выбери участок поверхности.' };
    const id = `road-site-${this.world.nextId++}`;
    this.world.sites.push({
      id, kind: 'road', x, y: WORLD.groundY, deliveredWood: 0, deliveredOre: 0, progress: 0, stage: 0,
      priority: 2, paused: false
    });
    this.refreshLogisticsRequests();
    this.onChange(`Дорожный сегмент поставлен на клетке мира ${Math.round(x)}. Материалы доставят к месту работ.`);
    return { ok: true, x };
  }

  removeRoad(roadId: string): { ok: true } | { ok: false; reason: string } {
    if (!FEATURES.roadsEnabled) return { ok: false, reason: 'Дорожная механика временно отключена.' };
    const road = this.world.roads.find((candidate) => candidate.id === roadId);
    if (!road) return { ok: false, reason: 'Дорожный сегмент уже удалён.' };
    this.world.roads = this.world.roads.filter((candidate) => candidate.id !== roadId);
    addLooseMaterials(this.world, 'wood', Math.floor(ROAD_CONFIG.cost.wood * ROAD_CONFIG.demolitionRefund), road.x, 'road-demolition');
    addLooseMaterials(this.world, 'ore', Math.floor(ROAD_CONFIG.cost.ore * ROAD_CONFIG.demolitionRefund), road.x, 'road-demolition');
    this.onChange('Дорожный сегмент удалён. Часть материалов оставлена на земле для вывоза.');
    return { ok: true };
  }

  demolitionRestriction(buildingId: string): string | null {
    const building = this.world.buildings.find((candidate) => candidate.id === buildingId);
    if (!building) return 'Здание не найдено.';
    if (building.demolition) return 'Снос уже начат. Продолжи работу или отмени её.';
    return this.demolitionConstraint(building, true);
  }

  resumeDemolitionRestriction(buildingId: string): string | null {
    const building = this.world.buildings.find((candidate) => candidate.id === buildingId);
    if (!building?.demolition) return 'Активный снос не найден.';
    return this.demolitionConstraint(building, false) ??
      (this.freeDemolitionBuilder() ? null : 'Освободи строителя, чтобы продолжить снос.');
  }

  startDemolition(buildingId: string): { ok: true } | { ok: false; reason: string } {
    const building = this.world.buildings.find((candidate) => candidate.id === buildingId);
    if (!building) return { ok: false, reason: 'Здание не найдено.' };
    if (building.demolition) return { ok: false, reason: 'Снос уже начат.' };
    const reason = this.demolitionConstraint(building, true);
    if (reason) return { ok: false, reason };
    const worker = this.freeDemolitionBuilder();
    if (!worker) return { ok: false, reason: 'Нужен свободный строитель.' };

    building.demolition = {
      state: 'demolishing', progress: 0, workerId: worker.id, paused: false, blockedReason: null
    };
    const store = this.storeForBuilding(building);
    if (store) store.closedForDemolition = true;
    this.assignDemolitionWorker(building, worker);
    this.onChange(`${worker.name} идёт к зданию для сноса.`);
    return { ok: true };
  }

  resumeDemolition(buildingId: string): { ok: true } | { ok: false; reason: string } {
    const building = this.world.buildings.find((candidate) => candidate.id === buildingId);
    if (!building?.demolition) return { ok: false, reason: 'Активный снос не найден.' };
    if (!building.demolition.paused) return { ok: false, reason: 'Снос уже продолжается.' };
    const reason = this.demolitionConstraint(building, false);
    if (reason) return { ok: false, reason };
    const worker = this.freeDemolitionBuilder();
    if (!worker) return { ok: false, reason: 'Освободи строителя, чтобы продолжить снос.' };

    building.demolition = {
      ...building.demolition,
      workerId: worker.id,
      paused: false,
      blockedReason: null
    };
    const store = this.storeForBuilding(building);
    if (store) store.closedForDemolition = true;
    this.assignDemolitionWorker(building, worker);
    this.onChange(`${worker.name} продолжил разборку здания.`);
    return { ok: true };
  }

  cancelDemolition(buildingId: string): boolean {
    const building = this.world.buildings.find((candidate) => candidate.id === buildingId);
    if (!building?.demolition) return false;
    const worker = building.demolition.workerId
      ? this.world.residents.find((person) => person.id === building.demolition!.workerId)
      : undefined;
    if (worker && !worker.cargo) this.releaseDemolitionWorker(worker, 'Снос отменён');
    const store = this.storeForBuilding(building);
    if (store) delete store.closedForDemolition;
    delete building.demolition;
    this.onChange('Снос отменён. Здание целое, ресурсы не возвращались, строитель свободен.');
    return true;
  }

  private storeForBuilding(building: PrototypeBuilding): PrototypeStore | undefined {
    return building.kind === 'warehouse'
      ? this.world.stores.find((store) => store.buildingId === building.id)
      : undefined;
  }

  private demolitionConstraint(building: PrototypeBuilding, requireFreeBuilder: boolean): string | null {
    if (this.world.sites.some((site) => site.kind !== 'road' && Math.abs(site.x - building.x) < 1)) {
      return 'На этой земельной клетке уже идёт строительство.';
    }
    if (building.kind === 'house') {
      const housingAfter = this.totals().housing - 1;
      if (housingAfter < this.world.residents.length) {
        return `После сноса будет ${housingAfter} мест жилья на ${this.world.residents.length} жителей. Сначала построй другой дом.`;
      }
    } else if (building.kind === 'warehouse') {
      const store = this.storeForBuilding(building);
      if (!store) return 'У склада не найдены запасы. Снос пока невозможен.';
      const otherStores = this.world.stores.filter((candidate) => candidate.id !== store.id &&
        candidate.id !== 'store-under-construction' && !candidate.closedForDemolition);
      if (otherStores.length === 0) return 'Нельзя снести единственный действующий склад.';
      if (storeTotal(store) > 0) {
        return `Сначала освободи склад: древесина ${store.wood}, порода ${store.ore}. Ресурсы не будут удалены.`;
      }
      const activeStatuses = new Set<LogisticsRequestStatus>(['queued', 'assigned', 'in_progress', 'blocked']);
      const activeRequest = this.world.logisticsRequests.some((request) => activeStatuses.has(request.status) &&
        (request.pickupStoreId === store.id || request.destinationStoreId === store.id));
      const activeResidentRoute = this.world.residents.some((person) =>
        person.pickupStoreId === store.id || person.targetStoreId === store.id);
      if (activeRequest || activeResidentRoute) {
        return 'Дождись завершения перевозок со склада или на него. Существующий маршрут не будет перенаправлен телепортацией.';
      }
    }
    if (requireFreeBuilder && !this.freeDemolitionBuilder()) return 'Нужен свободный строитель.';
    return null;
  }

  private freeDemolitionBuilder(): PrototypeResident | undefined {
    const assigned = new Set(this.world.buildings.flatMap((building) =>
      building.demolition?.workerId && !building.demolition.paused ? [building.demolition.workerId] : []));
    const clearing = new Set(this.world.landCells.filter((cell) =>
      cell.state === 'clearing' && !cell.clearingPaused && cell.clearerId).map((cell) => cell.clearerId!));
    return this.world.residents.find((person) => person.role === 'builder' && !person.cargo &&
      !assigned.has(person.id) && !clearing.has(person.id) && (person.mode === 'idle' || person.mode === 'blocked'));
  }

  private assignDemolitionWorker(building: PrototypeBuilding, worker: PrototypeResident): void {
    worker.targetSiteId = null;
    worker.targetStoreId = null;
    worker.pickupStoreId = null;
    worker.pickupResource = null;
    worker.pickupStockpileId = null;
    worker.pickupAmount = 0;
    worker.targetX = building.x;
    worker.targetY = WORLD.groundY;
    worker.progress = 0;
    worker.blockedReason = null;
    worker.mode = Math.abs(worker.x - building.x) <= 1 ? 'building' : 'moving';
    worker.task = worker.mode === 'building' ? 'Разбирает здание' : 'Идёт к зданию для сноса';
  }

  private releaseDemolitionWorker(worker: PrototypeResident, task: string): void {
    worker.targetX = null;
    worker.targetY = null;
    worker.targetSiteId = null;
    worker.targetStoreId = null;
    worker.pickupStoreId = null;
    worker.pickupResource = null;
    worker.pickupStockpileId = null;
    worker.pickupAmount = 0;
    worker.mode = 'idle';
    worker.progress = 0;
    worker.task = task;
    worker.blockedReason = null;
  }

  cancelSite(siteId: string): boolean {
    const index = this.world.sites.findIndex((site) => site.id === siteId);
    if (index < 0) return false;
    const [site] = this.world.sites.splice(index, 1);
    const releasedCells = structureCellIds(site!);
    addLooseMaterials(this.world, 'wood', site!.deliveredWood, site!.x, 'cancelled-construction');
    addLooseMaterials(this.world, 'ore', site!.deliveredOre, site!.x, 'cancelled-construction');
    for (const cellId of releasedCells) {
      const stillOccupied = [...this.world.buildings, ...this.world.sites]
        .some((structure) => structure.kind !== 'road' && structureCellIds(structure).includes(cellId));
      if (!stillOccupied) this.world.occupiedPlots = this.world.occupiedPlots.filter((id) => id !== cellId);
    }
    for (const person of this.world.residents) {
      if (person.targetSiteId !== siteId) continue;
      person.targetSiteId = null;
      if (person.cargo) {
        this.routeCargoToStore(person);
      } else {
        person.pickupStoreId = null;
        person.pickupResource = null;
        person.pickupStockpileId = null;
        person.pickupAmount = 0;
        person.mode = 'idle';
        person.task = 'Площадка отменена';
        person.targetX = null;
        person.targetY = null;
        person.targetStoreId = null;
        person.blockedReason = null;
      }
    }
    this.syncDevelopmentGoal();
    this.refreshLogisticsRequests();
    this.onChange('Стройка отменена. Доставленные материалы лежат рядом и доступны для вывоза.');
    return true;
  }

  step(deltaSeconds: number): void {
    this.advanceStep(deltaSeconds, true);
  }

  /** Run the same economic transition without rebuilding whole-world diagnostics every 100 ms. */
  stepOffline(deltaSeconds: number): void {
    this.advanceStep(deltaSeconds, false);
  }

  /** Refresh diagnostics at offline checkpoints and after catch-up completes. */
  refreshProgressDiagnostics(): void {
    this.updateProgressDiagnostics();
  }

  private advanceStep(deltaSeconds: number, updateDiagnostics: boolean): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.world.elapsedSeconds += dt;
    this.advanceTreeStates(dt);
    this.syncSourcePileCapacities();
    this.refreshLogisticsRequests();
    for (const person of this.world.residents) this.updateResident(person, dt);
    this.assignLogisticsRequests();
    syncLegacySector(this.world);
    this.syncDevelopmentGoal();
    if (updateDiagnostics) this.updateProgressDiagnostics();
    if (this.world.logisticsRequests.length > 200) {
      const terminal = this.world.logisticsRequests.filter((request) =>
        request.status === 'completed' || request.status === 'cancelled').slice(-100);
      const keep = new Set(terminal.map((request) => request.id));
      this.world.logisticsRequests = this.world.logisticsRequests.filter((request) =>
        !['completed', 'cancelled'].includes(request.status) || keep.has(request.id));
    }
  }

  logisticsQueueFor(residentId: string): PrototypeLogisticsRequest[] {
    return this.world.logisticsRequests.filter((request) => request.status === 'queued' ||
      request.status === 'assigned' || request.status === 'in_progress' || request.status === 'blocked')
      .sort((a, b) => a.sequence - b.sequence)
      .filter((request) => request.initiatorId === residentId || request.assignedHaulerId === residentId);
  }

  totals() {
    const count = (resource: Resource) =>
      this.world.stores.reduce((sum, store) => sum + storeAmount(store, resource), 0) +
      this.world.stockpiles.filter((pile) => pile.resource === resource).reduce((sum, pile) => sum + pile.amount, 0) +
      this.world.residents.filter((person) => person.cargo === resource).reduce((sum, person) => sum + person.cargoAmount, 0);
    const wood = count('wood');
    const ore = count('ore');
    const capacity = this.world.stores.reduce((sum, store) => sum + store.capacity, 0);
    const housing = 3 + this.world.buildings.filter((building) => building.kind === 'house')
      .reduce((sum, building) => sum + (building.level ?? 1), 0);
    const stored = this.world.stores.reduce((sum, store) => sum + storeTotal(store), 0);
    return { wood, ore, capacity, stored, population: this.world.residents.length, housing };
  }

  availableInStores(resource: Resource): number {
    return this.spendableResource(resource);
  }

  reservedInWarehouses(resource: Resource): number {
    return this.world.stores.reduce((sum, store) => sum + this.reservedPickups(store.id, resource), 0);
  }

  reservedForConstruction(resource: Resource): number {
    return this.world.sites.reduce((sum, site) => sum + this.reservedForSite(site.id, resource), 0);
  }

  reservedSiteMaterials(siteId: string, resource: Resource): number {
    return this.reservedForSite(siteId, resource);
  }

  reservedInboundStorage(): number {
    return this.world.stores.reduce((sum, store) => sum + this.reservedInboundCapacityForStore(store.id), 0);
  }

  residentDiagnosis(person: PrototypeResident): { code: string; reason: string; resume: string } {
    if (person.role === 'idle' && !person.cargo && !this.isActiveClearingWorker(person)) return {
      code: 'unassigned', reason: person.task, resume: 'Выбери профессию, чтобы житель начал работу.'
    };
    if (person.mode !== 'blocked') return { code: person.mode, reason: person.task, resume: '' };
    if (person.cargo) return {
      code: 'storage_full', reason: 'Ожидает свободное место на складе',
      resume: `Нужно ${person.cargoAmount} свободных мест. Строительство или дополнительный склад освободят место.`
    };
    if (person.role === 'woodcutter' || person.role === 'miner') {
      if (person.blockedReason?.startsWith('Лимит добычи')) return {
        code: 'production_quota', reason: person.blockedReason,
        resume: 'Увеличь лимит добычи у источника, чтобы продолжить.'
      };
      const pile = this.stockpileFor(person);
      const tree = person.role === 'woodcutter' ? this.treeForResident(person) : undefined;
      const stock = person.role === 'miner' ? this.world.oreSource : tree ? 1 : 0;
      if (pile.amount >= pile.capacity) return {
        code: 'stockpile_full', reason: `Местная куча заполнена: ${pile.amount}/${pile.capacity}`,
        resume: this.hasHaulers() && person.logisticsMode === 'hauler'
          ? 'Грузчик вывезет партию, когда освободится место на складе. Можно выбрать самостоятельную перевозку.'
          : 'Житель сам вывезет партию при наличии места на складе.'
      };
      if (stock <= 0) return {
        code: 'source_exhausted', reason: person.role === 'miner'
          ? 'Начальная залежь истощена' : 'Нет взрослого дерева для рубки',
        resume: person.role === 'miner'
          ? 'Построй шахту на залежи, чтобы включить бесконечную добычу.'
          : 'Посади дерево и дождись полного роста или выбери доступный лесной источник.'
      };
    }
    if (person.role === 'builder') return {
      code: person.blockedReason?.includes('пути') ? 'materials_in_transit' : 'materials_missing',
      reason: person.blockedReason ?? person.task,
      resume: 'Строитель работает в пределах доставленных материалов. Новая партия позволит продолжить.'
    };
    return { code: 'state_error', reason: person.blockedReason ?? person.task,
      resume: 'Проверяется маршрут и состояние заявки.' };
  }

  private updateProgressDiagnostics(): void {
    // Observe actual movement, work and transfers. Never reset residents on a timer.
    const signature = JSON.stringify([
      this.world.residents.map((person) => [person.x, person.mode, person.progress, person.cargo, person.cargoAmount]),
      this.world.stores.map((store) => [store.wood, store.ore]),
      this.world.stockpiles.map((pile) => pile.amount),
      this.world.sites.map((site) => [site.deliveredWood, site.deliveredOre, site.progress]),
      this.world.landCells.map((cell) => cell.clearingProgress),
      this.world.buildings.map((building) => [building.id, building.demolition?.progress]),
      this.world.oreSource, this.world.trees.map((tree) => [tree.id, tree.state, tree.growthSeconds, tree.cutProgress])
    ]);
    if (signature !== this.progressSignature) {
      this.progressSignature = signature;
      this.lastProgressAt = this.world.elapsedSeconds;
    }
    this.diagnostics.stalledSeconds = Math.max(0, this.world.elapsedSeconds - this.lastProgressAt);
    this.diagnostics.issues = [];
    for (const request of this.world.logisticsRequests) {
      if (['completed', 'cancelled'].includes(request.status)) continue;
      if (request.assignedHaulerId && !this.world.residents.some((person) =>
        person.id === request.assignedHaulerId && person.logisticsRequestId === request.id)) {
        this.diagnostics.issues.push(`stale_request:${request.id}`);
      }
    }
    for (const store of this.world.stores) {
      for (const item of ['wood', 'ore'] as const) {
        if (this.reservedPickups(store.id, item) > storeAmount(store, item)) {
          this.diagnostics.issues.push(`reservation_error:${store.id}:${item}`);
        }
      }
    }
    if (this.diagnostics.stalledSeconds >= PROTOTYPE_CONFIG.diagnosticSeconds) {
      for (const person of this.world.residents.filter((resident) => resident.role !== 'idle')) {
        const issue = this.residentDiagnosis(person);
        this.diagnostics.issues.push(`${person.id}:${issue.code}`);
      }
      if (this.world.sites.length && !this.world.residents.some((person) => person.role === 'builder')) {
        this.diagnostics.issues.push('builder_missing');
      }
      if (!this.hasHaulers() && this.world.residents.some((person) => person.logisticsMode === 'hauler')) {
        this.diagnostics.issues.push('hauler_missing:autonomous_fallback');
      }
    }
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
    for (const request of this.world.logisticsRequests) {
      if (request.status === 'completed' || request.status === 'cancelled') continue;
      const carrier = this.world.residents.find((person) => person.id === request.assignedHaulerId &&
        person.logisticsRequestId === request.id);
      if (carrier?.cargo) {
        // A picked load is physically owned by its carrier even after reassignment.
        request.status = 'in_progress';
        request.amount = carrier.cargoAmount;
        request.destinationStoreId = carrier.targetStoreId;
        request.destinationSiteId = carrier.targetSiteId;
        continue;
      }
      const initiator = this.world.residents.find((person) => person.id === request.initiatorId);
      const pile = this.world.stockpiles.find((candidate) => candidate.id === request.pickupStockpileId);
      const site = this.world.sites.find((candidate) => candidate.id === request.destinationSiteId);
      const relevant = request.type === 'DELIVER_TO_CONSTRUCTION'
        ? initiator?.role === 'builder' && initiator.logisticsMode === 'hauler' && site && !site.paused &&
          this.siteDelivered(site, request.resource) < COST[site.kind][request.resource]
        : pile && pile.amount > 0 && (isLooseMaterial(pile) || initiator &&
          initiator.logisticsMode === 'hauler' &&
          (initiator.role === 'woodcutter' || initiator.role === 'miner') && this.stockpileFor(initiator).id === pile.id);
      if (!this.hasHaulers() || !relevant) {
        this.cancelUnpickedRequest(request);
      } else if (request.assignedHaulerId && (!carrier || carrier.role !== 'hauler')) {
        request.assignedHaulerId = null;
        request.status = 'queued';
      }
      if (request.type === 'PICKUP_RESOURCE' && !['completed', 'cancelled'].includes(request.status) &&
          !this.requestReady(request)) {
        request.status = 'blocked';
        request.assignedHaulerId = null;
        if (carrier && !carrier.cargo) {
          carrier.logisticsRequestId = null;
          this.clearHaulerRoute(carrier);
          carrier.mode = 'idle';
        }
      }
    }
    for (const person of [...this.world.residents].sort((a, b) => Number(b.role === 'builder') - Number(a.role === 'builder'))) {
      if (!this.delegatesToHauler(person)) continue;
      if (person.role === 'woodcutter' || person.role === 'miner') {
        const pile = this.stockpileFor(person);
        if (pile.amount > 0) this.createStockpileRequest(person, pile);
      } else if (person.role === 'builder') {
        const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId && !candidate.paused) ??
          this.orderedActiveSites().find((candidate) => !this.siteHasAllMaterials(candidate));
        if (site) {
          for (const resource of ['wood', 'ore'] as const) {
            if (!this.siteHasResource(site, resource)) this.createConstructionRequest(person, site, resource);
          }
        }
      }
    }
    if (this.hasHaulers()) {
      const initiator = this.world.residents.find((person) => person.role !== 'idle') ?? this.world.residents[0];
      if (initiator) {
        for (const pile of this.world.stockpiles.filter((candidate) =>
          isLooseMaterial(candidate) && candidate.amount > 0)) {
          this.createStockpileRequest(initiator, pile);
        }
      }
    }
  }

  private cancelUnpickedRequest(request: PrototypeLogisticsRequest): void {
    const carrier = this.world.residents.find((person) => person.logisticsRequestId === request.id);
    if (carrier?.cargo) return;
    request.status = 'cancelled';
    request.assignedHaulerId = null;
    if (carrier) {
      carrier.logisticsRequestId = null;
      this.clearHaulerRoute(carrier);
      carrier.mode = 'idle'; carrier.blockedReason = null; carrier.task = 'Заявка отменена; выбирает новую задачу';
    }
  }

  private assignLogisticsRequests(): void {
    for (const request of this.world.logisticsRequests) {
      if (request.type !== 'PICKUP_RESOURCE' ||
          (request.status !== 'queued' && request.status !== 'blocked') ||
          !request.destinationStoreId) continue;
      const store = this.world.stores.find((candidate) => candidate.id === request.destinationStoreId);
      const availableSpace = store
        ? store.capacity - storeTotal(store) -
          this.reservedInboundCapacity(store.id, undefined, request.id)
        : 0;
      if (availableSpace < 1) request.destinationStoreId = null;
    }

    for (const hauler of this.world.residents.filter((person) => person.role === 'hauler')) {
      if (hauler.logisticsRequestId) {
        const active = this.requestById(hauler.logisticsRequestId);
        const higherPriority = !hauler.cargo && active?.type === 'PICKUP_RESOURCE' &&
          this.world.logisticsRequests.some((request) =>
            request.type === 'DELIVER_TO_CONSTRUCTION' &&
            !request.assignedHaulerId && ['queued', 'blocked'].includes(request.status) && this.requestReady(request));
        if (higherPriority) this.cancelUnpickedRequest(active!);
        else if (active && active.assignedHaulerId === hauler.id && active.status !== 'completed' && active.status !== 'cancelled') continue;
        hauler.logisticsRequestId = null;
      }
      if (hauler.cargo) continue;
      const available = this.world.logisticsRequests.filter((request) =>
        request.assignedHaulerId === null &&
        (request.status === 'queued' || request.status === 'blocked' && this.requestReady(request)) &&
        this.requestReady(request))
        .sort((a, b) => {
          const priorityOf = (request: PrototypeLogisticsRequest): number => request.type === 'DELIVER_TO_CONSTRUCTION'
            ? 10 + (this.world.sites.find((candidate) => candidate.id === request.destinationSiteId)?.priority ?? 2)
            : (this.world.productionSettings ?? DEFAULT_PRODUCTION_SETTINGS).priority[request.resource];
          return priorityOf(b) - priorityOf(a) || a.sequence - b.sequence;
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
          const space = Math.max(0, store.capacity - storeTotal(store) -
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
        ? `Идёт за ${resourceLabelGenitive(request.resource)} для стройки`
        : `Идёт за ${resourceLabelGenitive(request.resource)} у источника`;
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
        ['queued', 'assigned', 'in_progress'].includes(candidate.status))
        .reduce((sum, candidate) => sum + candidate.amount, 0);
      return pile.amount > this.reservedStockpileAmount(pile.id, request.id) &&
        storeTotal(store) + residentReservations + otherRequests < store.capacity;
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
      ['queued', 'assigned'].includes(candidate.status))
      .reduce((sum, candidate) => sum + candidate.amount, 0) : 0;
    const availableAtStore = Boolean(sourceStore &&
      storeAmount(sourceStore, request.resource) > residentPickups + otherRequestPickups);
    return Boolean(site && (availableAtStore ||
      pile && pile.amount > this.reservedStockpileAmount(pile.id, request.id)));
  }

  private reservedStockpileAmount(pileId: string, exceptRequestId?: string, exceptResidentId?: string): number {
    const requestReservations = this.world.logisticsRequests.filter((request) => request.id !== exceptRequestId &&
      request.pickupStockpileId === pileId && ['queued', 'assigned'].includes(request.status))
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
          ? Math.max(0, store.capacity - storeTotal(store) -
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
    if (site.paused) return;
    const active = this.activeRequestFor((request) => request.type === 'DELIVER_TO_CONSTRUCTION' &&
      request.initiatorId === initiator.id && request.destinationSiteId === site.id && request.resource === resource);
    if (active) return;
    const need = this.costOfSite(site, resource) - this.siteDelivered(site, resource) - this.reservedForSite(site.id, resource);
    if (need < 1) return;
    const stores = this.world.stores.filter((store) => !store.closedForDemolition &&
      storeAmount(store, resource) > this.reservedPickups(store.id, resource))
      .sort((a, b) => Math.abs(a.x - site.x) - Math.abs(b.x - site.x));
    const store = stores[0];
    if (!store) {
      // Construction may reclaim unpicked lower-priority pile reservations.
      for (const request of this.world.logisticsRequests.filter((candidate) =>
        candidate.type === 'PICKUP_RESOURCE' && candidate.resource === resource &&
        ['queued', 'assigned', 'blocked'].includes(candidate.status))) {
        this.cancelUnpickedRequest(request);
      }
    }
    const pile = store ? undefined : this.world.stockpiles.filter((candidate) => candidate.resource === resource &&
      candidate.amount > this.reservedStockpileAmount(candidate.id))
      .sort((a, b) => Math.abs(a.x - site.x) - Math.abs(b.x - site.x))[0];
    const available = store
      ? storeAmount(store, resource) - this.reservedPickups(store.id, resource)
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
    return siteDeliveredAmount(site, resource);
  }

  private siteHasResource(site: PrototypeSite, resource: Resource): boolean {
    return this.siteDelivered(site, resource) + this.reservedForSite(site.id, resource) >= this.costOfSite(site, resource);
  }

  private spendFromStores(resource: Resource, amount: number): void {
    let remaining = amount;
    for (const store of this.world.stores) {
      const availableInStore = Math.max(0, storeAmount(store, resource) - this.reservedPickups(store.id, resource));
      const available = Math.min(availableInStore, remaining);
      store[resource] = storeAmount(store, resource) - available;
      remaining -= available;
      if (remaining <= 0) return;
    }
  }

  private spendableResource(resource: Resource): number {
    return this.world.stores.reduce((sum, store) =>
      sum + Math.max(0, storeAmount(store, resource) - this.reservedPickups(store.id, resource)), 0);
  }

  private productionInventory(resource: Resource): number {
    const inventory = this.totals()[resource];
    const committed = this.world.sites.reduce((sum, site) =>
      sum + siteDeliveredAmount(site, resource), 0);
    return inventory + committed;
  }

  private reservedPickups(storeId: string, resource: Resource, exceptResidentId?: string): number {
    const residentReservations = this.world.residents.filter((person) => person.id !== exceptResidentId &&
      !person.logisticsRequestId && person.pickupStoreId === storeId && person.pickupResource === resource)
      .reduce((sum, person) => sum + Math.max(1, person.pickupAmount), 0);
    const requestReservations = this.world.logisticsRequests.filter((request) =>
      request.pickupStoreId === storeId && request.resource === resource &&
      ['queued', 'assigned'].includes(request.status))
      .reduce((sum, request) => sum + request.amount, 0);
    return residentReservations + requestReservations;
  }

  private reservedForSite(siteId: string, resource: Resource): number {
    const residentReservations = this.world.residents.filter((person) => person.targetSiteId === siteId &&
      !person.logisticsRequestId && (person.cargo === resource || person.pickupResource === resource))
      .reduce((sum, person) => sum + (person.cargo === resource ? Math.max(1, person.cargoAmount) : Math.max(1, person.pickupAmount)), 0);
    const requestReservations = this.world.logisticsRequests.filter((request) =>
      request.destinationSiteId === siteId && request.resource === resource &&
      ['queued', 'assigned', 'in_progress'].includes(request.status))
      .reduce((sum, request) => sum + request.amount, 0);
    return residentReservations + requestReservations;
  }

	private reservedInboundCapacityForStore(storeId: string): number {
		return this.reservedInboundCapacity(storeId);
	}

	private reservedInboundCapacity(storeId: string, exceptResidentId?: string, exceptRequestId?: string): number {
		const residentReservations = this.world.residents.filter((person) => person.id !== exceptResidentId &&
			!person.logisticsRequestId && person.cargo !== null && person.targetSiteId === null && person.targetStoreId === storeId)
			.reduce((sum, person) => sum + Math.max(1, person.cargoAmount), 0);
		const requestReservations = this.world.logisticsRequests.filter((request) => request.type === 'PICKUP_RESOURCE' &&
			request.id !== exceptRequestId && request.destinationStoreId === storeId &&
			['queued', 'assigned', 'in_progress'].includes(request.status))
			.reduce((sum, request) => sum + request.amount, 0);
		return residentReservations + requestReservations;
	}

	private hasCapacityForDelivery(
		store: PrototypeStore, exceptResidentId?: string, exceptRequestId?: string, amount = 1
	): boolean {
		return hasStoreCapacity(store, this.reservedInboundCapacity(store.id, exceptResidentId, exceptRequestId), amount);
	}

  private advanceTreeStates(dt: number): void {
    for (const tree of this.world.trees) {
      if (tree.state === 'falling' || tree.state === 'stump') {
        tree.stateSeconds += dt;
        const transitionAt = tree.state === 'falling'
          ? PROTOTYPE_CONFIG.trees.fallSeconds : PROTOTYPE_CONFIG.trees.stumpSeconds;
        if (tree.stateSeconds >= transitionAt) {
          const overflow = tree.stateSeconds - transitionAt;
          tree.stateSeconds = 0;
          if (tree.state === 'falling') tree.state = 'stump';
          else { tree.state = 'growing'; tree.growthSeconds = 0; }
          if (overflow > 0 && tree.state === 'growing') tree.growthSeconds += overflow;
        }
      }
      if (tree.state === 'growing') {
        const required = tree.planted ? PROTOTYPE_CONFIG.trees.initialGrowthSeconds : PROTOTYPE_CONFIG.trees.regrowthSeconds;
        tree.growthSeconds = Math.min(required, tree.growthSeconds + dt);
        if (tree.growthSeconds >= required) {
          tree.state = 'mature';
          tree.growthSeconds = PROTOTYPE_CONFIG.trees.initialGrowthSeconds;
          tree.stateSeconds = 0;
          for (const person of this.world.residents.filter((candidate) => candidate.role === 'woodcutter' &&
            candidate.woodSource === tree.sourceId && !candidate.cargo && candidate.mode === 'blocked')) {
            person.mode = 'idle'; person.blockedReason = null; this.planHarvest(person);
          }
        }
      }
    }
  }

  private treeForResident(person: PrototypeResident, claim = false): PrototypeTree | undefined {
    const tree = this.world.trees.find((candidate) => candidate.sourceId === person.woodSource &&
      candidate.state === 'mature' && (!candidate.workerId || candidate.workerId === person.id));
    if (tree && claim) tree.workerId = person.id;
    return tree;
  }

  private treePile(tree: PrototypeTree): PrototypeStockpile {
    let pile = this.world.stockpiles.find((candidate) => candidate.treeId === tree.id);
    if (!pile) {
      pile = { id: `pile-wood-${tree.id}`, sourceId: `tree-${tree.id}`, resource: 'wood', x: tree.x,
        amount: 0, capacity: PROTOTYPE_CONFIG.stockpile.capacity, treeId: tree.id };
      this.world.stockpiles.push(pile);
    }
    return pile;
  }

  private syncSourcePileCapacities(): void {
    for (const pile of this.world.stockpiles) {
      const forestUpgrade = pile.treeId && this.world.buildings.some((building) =>
        building.kind === 'sawmill' && !building.demolition && building.sourceTreeId === pile.treeId);
      const mineUpgrade = pile.sourceId === 'ore' && this.world.buildings.some((building) =>
        building.kind === 'mine' && !building.demolition);
      const capacity = forestUpgrade || mineUpgrade ? PROTOTYPE_CONFIG.stockpile.upgradedCapacity
        : pile.treeId || pile.sourceId === 'ore' || pile.sourceId === 'home' || pile.sourceId === 'eastern'
          ? PROTOTYPE_CONFIG.stockpile.capacity : pile.capacity;
      if (pile.amount > capacity) {
        const excess = pile.amount - capacity;
        pile.amount = capacity;
        addLooseMaterials(this.world, pile.resource, excess, pile.x, 'source-capacity-overflow');
      }
      pile.capacity = capacity;
    }
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
      this.advanceResidentPosition(person, targetX, dt);
      person.targetX = targetX;
      person.targetY = WORLD.groundY;
      person.mode = 'moving';
      person.task = 'Идёт расчищать Восточную опушку';
      return;
    }

    person.x = targetX;
    person.targetX = targetX;
    person.targetY = WORLD.groundY;
    person.mode = 'working';
    person.task = `Расчищает клетку ${landCellNumber(cell.id)} · ${Math.round(cell.clearingProgress * 100)}%`;
    person.progress += dt;
    cell.clearingProgress = Math.min(1, cell.clearingProgress + dt / PROTOTYPE_CONFIG.expansion.clearingWorkSeconds);
    if (cell.clearingProgress >= 1) {
      cell.state = 'prepared';
      cell.clearerId = null;
      cell.clearingPaused = false;
      person.mode = 'idle';
      person.task = `Клетка ${landCellNumber(cell.id)} расчищена`;
      person.targetX = null;
      person.targetY = null;
      person.progress = 0;
      if (cell.id === 6) {
        this.world.easternForestAvailable = true;
        if (!this.world.trees.some((tree) => tree.sourceId === 'eastern')) {
          const tree = initialTrees(true)[1]!;
          this.world.trees.push(tree);
          this.treePile(tree);
        }
      }
      syncLegacySector(this.world);
      this.syncDevelopmentGoal();
      this.onChange(`Клетка ${landCellNumber(cell.id)} подготовлена: открыта ровно одна строительная площадка.`);
    }
  }

  private updateResident(person: PrototypeResident, dt: number): void {
    if (this.isActiveClearingWorker(person)) {
      this.updateClearingWorker(person, dt);
      return;
    }
    const demolition = this.world.buildings.find((building) =>
      building.demolition?.workerId === person.id && !building.demolition.paused);
    if (demolition?.demolition) {
      this.updateDemolitionWorker(demolition, person, dt);
      return;
    }
    if (person.role === 'hauler') {
      this.updateHauler(person, dt);
      return;
    }
    if (person.cargo && !this.ensureCargoDestination(person)) return;
    if (person.mode === 'blocked') {
      if (person.cargo) this.tryResumeCargo(person);
      else if (this.planDemolitionHaul(person)) return;
      else if (person.role === 'builder') this.planDelivery(person);
      else if (person.role === 'woodcutter' || person.role === 'miner') this.planHarvest(person);
      return;
    }
    if (person.mode === 'moving' || person.mode === 'carrying') {
      if (person.targetX === null) { person.mode = 'idle'; return; }
      const targetX = person.targetX;
      if (this.advanceResidentPosition(person, targetX, dt)) {
        if (person.pickupStockpileId && !person.cargo) this.arriveAtStockpilePickup(person);
        else if (person.pickupStoreId && !person.cargo) this.arriveAtPickup(person);
        else if (person.cargo) this.arriveAtDestination(person);
        else if (person.role === 'builder' && person.targetSiteId) {
          const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId);
          if (site && site.progress < materialFraction(site)) {
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
          person.task = person.role === 'woodcutter' ? 'Рубит дерево' : person.role === 'miner' ? 'Добывает породу' : 'Осматривает площадку';
        }
      }
      return;
    }
    if (person.mode === 'working') {
      if (person.role === 'woodcutter') {
        const tree = this.treeForResident(person, true);
        if (!tree) { person.mode = 'idle'; this.planHarvest(person); return; }
        tree.cutProgress = Math.min(PROTOTYPE_CONFIG.trees.cuttingSeconds, tree.cutProgress + dt);
        person.progress = tree.cutProgress;
        person.task = `Рубит дерево · ${Math.round(tree.cutProgress / PROTOTYPE_CONFIG.trees.cuttingSeconds * 100)}%`;
        if (tree.cutProgress >= PROTOTYPE_CONFIG.trees.cuttingSeconds) this.finishHarvest(person);
      } else {
        person.progress += dt;
        if (person.progress >= PROTOTYPE_CONFIG.stockpile.harvestSeconds) this.finishHarvest(person);
      }
      return;
    }
    if (person.mode === 'building') {
      const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId);
      if (!site) { person.mode = 'idle'; person.task = 'Ждёт площадку'; return; }
      if (site.paused) {
        person.mode = 'blocked';
        person.blockedReason = 'Стройка приостановлена игроком.';
        person.task = person.blockedReason;
        return;
      }
      const limit = materialFraction(site);
      if (site.progress >= limit - 1e-8) {
        person.mode = 'blocked';
        person.blockedReason = `Достигнут предел материалов: ${Math.round(limit * 100)}%. Ждёт доставку.`;
        person.task = person.blockedReason;
        return;
      }
      person.progress += dt;
      site.progress = Math.min(limit, site.progress + dt / constructionSeconds(site));
      if (limit - site.progress < 1e-8) site.progress = limit;
      site.stage = Math.min(2, Math.floor(site.progress * 3));
      person.task = `Строит: этап ${site.stage + 1} из 3`;
      if (site.progress >= 1 && this.siteHasAllMaterials(site)) this.completeBuilding(site);
      return;
    }
    if (person.mode === 'idle') {
      if (person.cargo) { this.tryResumeCargo(person); return; }
      if (this.planDemolitionHaul(person)) return;
      if (person.role === 'woodcutter' || person.role === 'miner') this.planHarvest(person);
      else if (person.role === 'builder') this.planDelivery(person);
    }
  }

  private planDemolitionHaul(person: PrototypeResident): boolean {
    if (this.hasHaulers() || person.role === 'idle' || person.role === 'hauler' || person.cargo) return false;
    if (person.role === 'builder' && this.world.sites.some((site) => site.progress < 1)) return false;
    const pile = this.world.stockpiles.filter((candidate) => isLooseMaterial(candidate) && candidate.amount > 0)
      .sort((a, b) => Math.abs(a.x - person.x) - Math.abs(b.x - person.x) || a.id.localeCompare(b.id))
      .find((candidate) => candidate.amount > this.reservedStockpileAmount(candidate.id));
    if (!pile) return false;
    const store = this.findStoreForDeposit(pile.x, person.id);
    if (!store) return false;
    const available = pile.amount - this.reservedStockpileAmount(pile.id);
    const storeSpace = store.capacity - storeTotal(store) - this.reservedInboundCapacity(store.id, person.id);
    const amount = Math.min(available, storeSpace, PROTOTYPE_CONFIG.stockpile.carryCapacity);
    if (amount < 1) return false;

    person.pickupStockpileId = pile.id;
    person.pickupAmount = amount;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.targetSiteId = null;
    person.targetStoreId = store.id;
    person.targetX = pile.x;
    person.targetY = WORLD.groundY;
    person.mode = 'moving';
    person.task = `Идёт вывезти ${amount} ед. ${pile.resource === 'wood' ? 'дерева' : 'породы'} на склад`;
    person.blockedReason = null;
    return true;
  }

  private updateDemolitionWorker(building: PrototypeBuilding, person: PrototypeResident, dt: number): void {
    const demolition = building.demolition;
    if (!demolition || demolition.paused || demolition.workerId !== person.id) return;
    if (person.role !== 'builder' || person.cargo) {
      demolition.workerId = null;
      demolition.paused = true;
      demolition.blockedReason = person.cargo
        ? 'Строитель несёт груз; снос приостановлен.'
        : 'Строитель сменил профессию; прогресс сохранён.';
      if (!person.cargo) this.releaseDemolitionWorker(person, 'Снос приостановлен');
      return;
    }
    const distance = Math.abs(building.x - person.x);
    if (distance > 1) {
      this.advanceResidentPosition(person, building.x, dt);
      person.targetX = building.x;
      person.targetY = WORLD.groundY;
      person.mode = 'moving';
      person.task = 'Идёт к зданию для сноса';
      return;
    }

    person.x = building.x;
    person.targetX = building.x;
    person.targetY = WORLD.groundY;
    person.mode = 'building';
    person.task = `Разбирает здание · ${Math.round(demolition.progress * 100)}%`;
    demolition.progress = Math.min(1, demolition.progress + dt / PROTOTYPE_CONFIG.demolition.workSeconds);
    person.progress = demolition.progress * PROTOTYPE_CONFIG.demolition.workSeconds;
    person.task = `Разбирает здание · ${Math.round(demolition.progress * 100)}%`;
    if (demolition.progress >= 1) this.completeDemolition(building);
  }

  private completeDemolition(building: PrototypeBuilding): void {
    const demolition = building.demolition;
    if (!demolition || demolition.progress < 1) return;
    const restriction = this.demolitionConstraint(building, false);
    if (restriction) {
      const worker = demolition.workerId
        ? this.world.residents.find((person) => person.id === demolition.workerId)
        : undefined;
      if (worker && !worker.cargo) this.releaseDemolitionWorker(worker, 'Снос приостановлен');
      demolition.workerId = null;
      demolition.paused = true;
      demolition.blockedReason = restriction;
      this.onChange(`Снос приостановлен: ${restriction}`);
      return;
    }

    const releasedCells = structureCellIds(building);
    const refund = demolitionRefund(building.kind);
    addLooseMaterials(this.world, 'wood', refund.wood, building.x, 'demolition');
    addLooseMaterials(this.world, 'ore', refund.ore, building.x, 'demolition');

    const worker = demolition.workerId
      ? this.world.residents.find((person) => person.id === demolition.workerId)
      : undefined;
    if (worker && !worker.cargo) this.releaseDemolitionWorker(worker, 'Разборка завершена');
    const store = this.storeForBuilding(building);
    if (store) this.world.stores = this.world.stores.filter((candidate) => candidate.id !== store.id);
    this.world.buildings = this.world.buildings.filter((candidate) => candidate.id !== building.id);
    for (const cellId of releasedCells) {
      const stillOccupied = [...this.world.buildings, ...this.world.sites]
        .some((structure) => structure.kind !== 'road' && structureCellIds(structure).includes(cellId));
      if (!stillOccupied) this.world.occupiedPlots = this.world.occupiedPlots.filter((id) => id !== cellId);
    }
    this.syncDevelopmentGoal();
    this.onChange(`Здание разобрано. Возвращённые материалы лежат у площадки: древесина ${refund.wood}, порода ${refund.ore}.`);
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
    const resource: Resource = wood ? 'wood' : 'ore';
    const tree = wood ? this.treeForResident(person, true) : undefined;
    const quota = (this.world.productionSettings ?? DEFAULT_PRODUCTION_SETTINGS).quota[resource];
    const inventory = this.productionInventory(resource);
    if (inventory >= quota) {
      if (tree?.workerId === person.id) tree.workerId = null;
      person.mode = 'blocked';
      person.blockedReason = `Лимит добычи достигнут: ${inventory}/${quota} ед. ${resourceLabelGenitive(resource)}.`;
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      return;
    }
    // A woodcutter must still clear stored logs when its tree is growing or
    // temporarily unavailable. Keep the tree's pile addressable by source ID.
    const pile = wood ? (tree ? this.treePile(tree) : this.stockpileFor(person))
      : this.world.stockpiles.find((candidate) => candidate.sourceId === 'ore')!;
    this.clearHaulerRoute(person);
    const infiniteOre = this.world.buildings.some((building) => building.kind === 'mine' && !building.demolition);
    const remaining = wood ? (tree ? 1 : 0) : infiniteOre ? 1 : this.world.oreSource;
    const available = Math.max(0, pile.amount - this.reservedStockpileAmount(pile.id));
    const site = this.world.sites.find((candidate) => COST[candidate.kind][pile.resource] -
      this.siteDelivered(candidate, pile.resource) - this.reservedForSite(candidate.id, pile.resource) > 0);
    const store = this.findStoreForDeposit(pile.x, person.id);
    const batchTarget = site ? Math.min(PROTOTYPE_CONFIG.stockpile.carryCapacity,
      COST[site.kind][pile.resource] - this.siteDelivered(site, pile.resource) -
      this.reservedForSite(site.id, pile.resource)) : pile.capacity;
    // Never pick up a load without a destination, and keep producing while
    // local space remains even when all warehouses are full.
    if (!this.delegatesToHauler(person) && available > 0 &&
        (pile.amount >= batchTarget || remaining <= 0) && (site || store)) {
      const limit = site ? COST[site.kind][pile.resource] - this.siteDelivered(site, pile.resource) -
        this.reservedForSite(site.id, pile.resource) : store!.capacity - storeTotal(store!) -
          this.reservedInboundCapacity(store!.id, person.id);
      person.pickupStockpileId = pile.id;
      person.pickupAmount = Math.min(available, limit, PROTOTYPE_CONFIG.stockpile.carryCapacity);
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.targetSiteId = site?.id ?? null;
      person.targetStoreId = site ? null : store!.id;
      person.targetX = pile.x;
      person.targetY = WORLD.groundY;
      person.mode = 'moving';
      person.task = `Идёт забрать ${person.pickupAmount} ед. ${resourceLabelGenitive(resource)} у источника`;
      person.blockedReason = null;
      return;
    }
    if (pile.amount >= pile.capacity) {
      person.mode = 'blocked';
      person.blockedReason = `${wood ? 'Древесина' : 'Порода'} у источника: ${pile.amount}/${pile.capacity}. Ждёт вывоза${store || site ? '' : ': все склады заполнены'}.`;
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      return;
    }
    if (wood && !tree) {
      person.mode = 'blocked';
      person.blockedReason = easternWood && !this.hasEasternForest()
        ? 'Восточный лес станет доступен после подготовки территории.'
        : 'Нет взрослого дерева для рубки. Посади дерево и дождись его роста.';
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      return;
    }
    if (remaining <= 0) {
      person.mode = 'blocked';
      person.blockedReason = wood ? 'Нет взрослого дерева для рубки.'
        : 'Начальная залежь породы истощена. Построй шахту, чтобы продолжить добычу.';
      person.task = person.blockedReason; return;
    }
    const targetX = wood
      ? tree!.x
      : this.world.buildings.find((building) => building.kind === 'mine' && !building.demolition)?.x ?? PROTOTYPE_CONFIG.sources.oreX;
    person.mode = 'moving'; person.targetX = targetX; person.targetY = WORLD.groundY;
    person.task = easternWood ? 'Идёт к лесу Восточной опушки' : wood ? 'Идёт к дереву' :
      infiniteOre ? 'Идёт к шахте' : 'Идёт к залежи породы';
    person.blockedReason = null;
  }

  private stockpileFor(person: PrototypeResident): PrototypeStockpile {
    if (person.role === 'miner') return this.world.stockpiles.find((pile) => pile.sourceId === 'ore') ?? this.world.stockpiles[0]!;
    const tree = this.treeForResident(person);
    return (tree ? this.world.stockpiles.find((pile) => pile.treeId === tree.id) : undefined) ??
      this.world.stockpiles.find((pile) => pile.sourceId === person.woodSource) ?? this.world.stockpiles[0]!;
  }

  private finishHarvest(person: PrototypeResident): void {
    const item: Resource = person.role === 'woodcutter' ? 'wood' : 'ore';
    const tree = item === 'wood' ? this.treeForResident(person, true) : undefined;
    if (item === 'wood' && !tree) { person.mode = 'idle'; this.planHarvest(person); return; }
    const pile = item === 'wood' ? this.treePile(tree!) : this.stockpileFor(person);
    const quota = (this.world.productionSettings ?? DEFAULT_PRODUCTION_SETTINGS).quota[item];
    const quotaRemaining = quota - this.productionInventory(item);
    if (quotaRemaining <= 0) {
      person.mode = 'blocked';
      person.blockedReason = `Лимит добычи достигнут: ${this.productionInventory(item)}/${quota} ед. ${resourceLabelGenitive(item)}.`;
      person.task = person.blockedReason;
      return;
    }
    if (pile.amount >= pile.capacity) {
      person.mode = 'blocked';
      person.blockedReason = `Куча заполнена: ${pile.amount}/${pile.capacity}.`;
      person.task = person.blockedReason;
      return;
    }
    const infiniteOre = item === 'ore' && this.world.buildings.some((building) => building.kind === 'mine' && !building.demolition);
    const remaining = item === 'wood' || infiniteOre ? Number.POSITIVE_INFINITY : this.world.oreSource;
    const harvested = Math.min(item === 'wood' ? PROTOTYPE_CONFIG.trees.woodPerCut : PROTOTYPE_CONFIG.stockpile.harvestAmount,
      pile.capacity - pile.amount, remaining, quotaRemaining);
    if (harvested <= 0) { person.mode = 'idle'; this.planHarvest(person); return; }
    if (item === 'ore' && !infiniteOre) this.world.oreSource = Math.max(0, this.world.oreSource - harvested);
    pile.amount += harvested;
    this.activity.harvested[item] += harvested;
    person.progress = 0;
    if (tree) {
      tree.state = 'falling'; tree.stateSeconds = 0; tree.growthSeconds = 0;
      tree.cutProgress = 0; tree.workerId = null; tree.planted = false;
    }
    if (this.delegatesToHauler(person)) {
      this.createStockpileRequest(person, pile);
      person.mode = item === 'wood' || pile.amount >= pile.capacity ? 'blocked' : 'working';
      person.blockedReason = item === 'wood' ? 'Дерево восстанавливается после рубки.'
        : pile.amount >= pile.capacity ? 'Ждёт, пока грузчик освободит кучу.' : null;
      person.task = person.blockedReason ?? `Добывает породу · куча ${pile.amount}/${pile.capacity}`;
      if (item === 'wood') person.targetX = null;
      if (item === 'wood') this.onChange(`Дерево срублено: ${harvested} древесины у источника.`);
      return;
    }
    person.mode = item === 'wood' ? 'blocked' : 'idle';
    person.blockedReason = item === 'wood' ? 'Дерево восстанавливается после рубки.' : null;
    if (item === 'wood') {
      person.task = person.blockedReason!; person.targetX = null;
      this.onChange(`Дерево срублено: ${harvested} древесины у источника.`);
    } else this.planHarvest(person);
  }

  private planDelivery(person: PrototypeResident): void {
    // A replanned route must not reserve its own abandoned pickup.
    this.clearHaulerRoute(person);
    const site = this.orderedActiveSites().find((candidate) => {
      const needsMaterials = !this.siteHasAllMaterials(candidate);
      return needsMaterials || (person.role === 'builder' && this.siteHasAllMaterials(candidate) && candidate.progress < 1);
    });
    if (!site) {
      const paused = this.world.sites.length > 0 && this.world.sites.every((candidate) => candidate.paused);
      if (paused) {
        person.mode = 'blocked';
        person.task = 'Все строительные площадки на паузе.';
        person.blockedReason = person.task;
        person.targetSiteId = null;
        person.targetX = null;
        person.targetY = null;
        return;
      }
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
    if (site.progress < materialFraction(site) - 1e-8) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.pickupStockpileId = null;
      person.pickupAmount = 0;
      if (person.role === 'builder') {
        person.mode = 'moving'; person.targetX = site.x; person.targetY = WORLD.groundY;
        person.task = 'Материалы доставлены, идёт к строительной площадке';
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
    for (const resource of ['wood', 'ore'] as const) {
      if (!this.siteHasResource(site, resource)) needs.push(resource);
    }
    const item = needs.find((resource) => this.world.stores.some((store) =>
      store.id !== 'store-under-construction' && storeAmount(store, resource) > this.reservedPickups(store.id, resource)) ||
      this.world.stockpiles.some((pile) => pile.resource === resource &&
        pile.amount > this.reservedStockpileAmount(pile.id)));
    if (!item) {
      const missing = needs.map(resourceLabelGenitive).join(' и ');
      person.mode = 'blocked';
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = needs.length === 0
        ? 'Материалы зарезервированы и находятся в пути; ожидает физическую доставку'
        : `Не хватает ${missing}. Назначь лесоруба или каменщика.`;
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
    const pile = store ? undefined : this.world.stockpiles.filter((candidate) =>
      candidate.resource === item &&
      candidate.amount > this.reservedStockpileAmount(candidate.id))
      .sort((a, b) => Math.abs(a.x - person.x) - Math.abs(b.x - person.x))[0];
    if (!store && !pile) {
      const missing = resourceLabelGenitive(item);
      person.mode = 'blocked'; person.targetX = null; person.targetY = null;
      person.blockedReason = `Не хватает ${missing}. Назначь добытчика.`;
      person.task = person.blockedReason;
      return;
    }
    person.cargo = null;
    person.cargoAmount = 0;
    const available = store
      ? storeAmount(store, item) - this.reservedPickups(store.id, item)
      : pile!.amount - this.reservedStockpileAmount(pile!.id);
    person.pickupAmount = Math.min(needs.includes(item) ? cost[item] - this.siteDelivered(site, item) -
      this.reservedForSite(site.id, item) : 0, available, PROTOTYPE_CONFIG.stockpile.carryCapacity);
    if (person.pickupAmount <= 0) {
      this.clearHaulerRoute(person);
      person.mode = 'blocked'; person.blockedReason = 'Материалы в пути; ожидает доставку';
      person.task = person.blockedReason;
      return;
    }
    person.pickupStoreId = store?.id ?? null;
    person.pickupResource = item;
    person.pickupStockpileId = pile?.id ?? null;
    person.mode = 'moving';
    person.targetX = store?.x ?? pile!.x;
    person.targetY = WORLD.groundY;
    person.task = store
      ? `Идёт за ${person.pickupAmount} ед. ${resourceLabelGenitive(item)} на склад`
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
    if (this.advanceResidentPosition(person, person.targetX, dt)) {
      if (onArrival) onArrival();
      else this.arriveAtDestination(person);
    }
  }

  private advanceResidentPosition(person: PrototypeResident, targetX: number, dt: number): boolean {
    person.x = advanceOnRoads(person.x, targetX, dt, FEATURES.roadsEnabled ? this.world.roads : []);
    return person.x === targetX;
  }

  private arriveAtDestination(person: PrototypeResident): void {
    const item = person.cargo;
    if (!item) return;
    const amount = Math.max(1, person.cargoAmount || 1);
    const site = person.targetSiteId ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId) : undefined;
    if (site) {
      const accepted = Math.min(amount, Math.max(0, COST[site.kind][item] - this.siteDelivered(site, item)));
      if (item === 'wood') site.deliveredWood += accepted;
      else site.deliveredOre += accepted;
      this.activity.delivered[item] += accepted;
      addLooseMaterials(this.world, item, amount - accepted, site.x, 'overflow');
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
      this.onChange(`${accepted} ед. ${resourceLabelGenitive(item)} доставлено на стройку.`);
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
    const accepted = Math.min(amount, Math.max(0, store.capacity - storeTotal(store)));
    if (accepted < amount) {
      this.routeCargoToStore(person);
      return;
    }
    store[item] = storeAmount(store, item) + accepted;
    this.activity.delivered[item] += accepted;
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
    this.onChange(`${accepted} ед. ${resourceLabelGenitive(item)} принято на склад.`);
  }

  private completeCurrentRequest(person: PrototypeResident): void {
    const request = this.requestById(person.logisticsRequestId);
    if (request) {
      request.status = 'completed';
      request.assignedHaulerId = null;
      const initiator = this.world.residents.find((candidate) => candidate.id === request.initiatorId);
      if (initiator && initiator.id !== person.id) {
        initiator.blockedReason = null;
        initiator.task = request.type === 'PICKUP_RESOURCE' ? 'Куча вывезена; продолжает добычу'
          : 'Материалы доставлены; приступает к стройке';
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
    const destinationStoreId = request?.destinationStoreId ?? person.targetStoreId;
    const store = destinationStoreId
      ? this.world.stores.find((candidate) => candidate.id === destinationStoreId)
      : undefined;
    const capacity = store
      ? Math.max(0, store.capacity - storeTotal(store) -
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
    person.targetStoreId = request?.destinationStoreId ?? store?.id ?? null;
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
    person.task = `Несёт ${amount} ед. ${resourceLabelGenitive(pile.resource)}`;
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
    const request = this.requestById(person.logisticsRequestId);
    if (!resource || !store || !site) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.targetSiteId = null;
      person.mode = 'idle';
      person.task = 'Назначение больше недоступно';
      person.targetX = null;
      person.targetY = null;
      return;
    }

    const requestReserved = this.world.logisticsRequests.filter((candidate) => candidate.id !== request?.id &&
      candidate.pickupStoreId === store.id && candidate.resource === resource &&
      ['queued', 'assigned'].includes(candidate.status))
      .reduce((sum, candidate) => sum + candidate.amount, 0);
    const residentReserved = this.world.residents.filter((candidate) => candidate.id !== person.id &&
      !candidate.logisticsRequestId && candidate.pickupStoreId === store.id && candidate.pickupResource === resource)
      .reduce((sum, candidate) => sum + Math.max(1, candidate.pickupAmount), 0);
    const unreserved = storeAmount(store, resource) - requestReserved - residentReserved;
    if (unreserved < 1) {
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.mode = 'blocked';
      person.blockedReason = `На складе больше нет ${resourceLabelGenitive(resource)}; ищет другой доступный запас.`;
      person.task = person.blockedReason;
      person.targetX = null;
      person.targetY = null;
      this.onChange(person.blockedReason);
      return;
    }

    const amount = Math.min(unreserved, person.pickupAmount || request?.amount || 1);
    if (amount < 1) return;
    store[resource] = storeAmount(store, resource) - amount;
    person.cargo = resource;
    person.cargoAmount = amount;
    person.pickupStoreId = null;
    person.pickupAmount = 0;
    person.pickupResource = null;
    person.targetStoreId = null;
    person.targetSiteId = site?.id ?? null;
    if (request) {
      request.amount = amount;
      request.status = 'in_progress';
    }
    person.mode = 'carrying';
    person.targetX = site!.x;
    person.targetY = WORLD.groundY;
    person.task = `Несёт ${amount} ед. ${resourceLabelGenitive(resource)} на стройку`;
    person.blockedReason = null;
    this.onChange(`${person.name} забрал ${amount} ед. ${resourceLabelGenitive(resource)} со склада.`);
  }

	private findStoreForDeposit(fromX: number, residentId: string, amount = 1): PrototypeStore | undefined {
		return nearestStoreWithCapacity(this.world.stores, fromX,
			(storeId) => this.reservedInboundCapacity(storeId, residentId), amount);
  }

  private findStoreForPickup(resource: Resource, fromX: number): PrototypeStore | undefined {
    return this.world.stores.filter((store) => store.id !== 'store-under-construction' &&
      !store.closedForDemolition &&
      storeAmount(store, resource) > this.reservedPickups(store.id, resource))
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
    if (person.role === 'builder' || this.world.sites.length > 0) {
      const item = person.cargo;
      const neededSite = this.world.sites.find((candidate) =>
        COST[candidate.kind][item] - this.siteDelivered(candidate, item) - this.reservedForSite(candidate.id, item) > 0);
      if (neededSite) {
        const need = COST[neededSite.kind][item] - this.siteDelivered(neededSite, item) -
          this.reservedForSite(neededSite.id, item);
        const amount = Math.min(person.cargoAmount, need);
        addLooseMaterials(this.world, item, person.cargoAmount - amount, person.x, 'overflow');
        person.cargoAmount = amount;
        person.targetSiteId = neededSite.id;
        person.targetStoreId = null;
        person.targetX = neededSite.x; person.targetY = WORLD.groundY;
        person.mode = 'carrying'; person.blockedReason = null;
        person.task = 'Несёт имеющийся груз на строительную площадку';
        return true;
      }
      if (person.role === 'builder' && this.world.sites.length > 0 && !this.findStoreForDeposit(person.x, person.id, person.cargoAmount)) {
        // Keep the load physically on the ground so the only builder can free storage.
        addLooseMaterials(this.world, item, person.cargoAmount, person.x, 'overflow');
        const request = this.requestById(person.logisticsRequestId);
        if (request) { request.status = 'cancelled'; request.assignedHaulerId = null; }
        person.cargo = null; person.cargoAmount = 0; person.logisticsRequestId = null;
        this.clearHaulerRoute(person); person.mode = 'idle'; person.blockedReason = null;
        person.task = 'Груз оставлен у маршрута; освобождает склад для строительства';
        return false;
      }
    }
    return this.routeCargoToStore(person);
  }

  private siteHasAllMaterials(site: PrototypeSite): boolean {
    return (['wood', 'ore'] as const).every((resource) =>
      this.siteDelivered(site, resource) >= COST[site.kind][resource]);
  }

  private orderedActiveSites(): PrototypeSite[] {
    return this.world.sites.filter((site) => !site.paused)
      .sort((a, b) => (b.priority ?? 2) - (a.priority ?? 2) || a.id.localeCompare(b.id));
  }

  private completeBuilding(site: PrototypeSite): void {
    if (site.kind === 'road' && !FEATURES.roadsEnabled) {
      site.paused = true;
      return;
    }
    if (site.kind === 'house-upgrade' &&
        !this.world.buildings.some((building) => building.id === site.upgradeBuildingId && building.kind === 'house')) {
      site.paused = true;
      return;
    }
    this.world.sites = this.world.sites.filter((candidate) => candidate.id !== site.id);
    if (site.kind === 'road') {
      this.world.roads.push({ id: `road-${this.world.nextId++}`, x: site.x, builtAt: this.world.elapsedSeconds });
    } else if (site.kind === 'house-upgrade') {
      const house = this.world.buildings.find((building) => building.id === site.upgradeBuildingId && building.kind === 'house');
      if (!house) return;
      house.level = 2;
      const housing = this.totals().housing;
      while (this.world.residents.length < housing && this.world.residents.length < 8) {
        const index = this.world.residents.length;
        this.world.residents.push(resident(`r${this.world.nextId++}`, NEW_NAMES[(index - 3) % NEW_NAMES.length]!, house.x + 32));
      }
    } else {
      const buildingId = `building-${this.world.nextId++}`;
      const building: PrototypeBuilding = {
        id: buildingId, kind: site.kind, x: site.x, y: site.y,
        gridColumn: site.gridColumn, gridRow: site.gridRow,
        footprint: { ...(site.footprint ?? footprintFor(site.kind)) },
        ...(site.kind === 'house' ? { level: 1 } : {}),
        ...(site.kind === 'sawmill' ? { sourceTreeId: site.sourceTreeId ?? null } : {})
      };
      this.world.buildings.push(building);
      if (site.kind === 'warehouse') {
        this.world.stores.push({ id: `store-${this.world.nextId++}`, buildingId, x: site.x, wood: 0, ore: 0,
          capacity: PROTOTYPE_CONFIG.warehouseCapacity });
      } else if (site.kind === 'sawmill') {
        const tree = this.world.trees.find((candidate) => candidate.id === building.sourceTreeId);
        if (tree) this.treePile(tree).capacity = PROTOTYPE_CONFIG.stockpile.upgradedCapacity;
      } else if (site.kind === 'mine') {
        const orePile = this.world.stockpiles.find((pile) => pile.sourceId === 'ore');
        if (orePile) orePile.capacity = PROTOTYPE_CONFIG.stockpile.upgradedCapacity;
      } else if (site.kind === 'house') {
        const housing = this.totals().housing;
        while (this.world.residents.length < housing && this.world.residents.length < 8) {
          const index = this.world.residents.length;
          this.world.residents.push(resident(`r${this.world.nextId++}`, NEW_NAMES[(index - 3) % NEW_NAMES.length]!, site.x + 32));
        }
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
    this.onChange(site.kind === 'road' ? 'Дорожный сегмент построен: передвижение по нему ускоряется.' :
      site.kind === 'house-upgrade' ? 'Дом улучшен до второго уровня: поселение получает ещё одно место для жителя.' :
        site.kind === 'house' ? 'Дом готов! Вместимость жилья выросла, поселение встречает нового жителя.' :
          site.kind === 'sawmill' ? 'Лесопилка открыта: местная куча древесины увеличена до 50 единиц.' :
            'Новый склад открыт: вместимость поселения выросла.');
  }
}
