export type Resource = 'wood' | 'stone';
export type BuildingKind = 'house' | 'warehouse';
export type WorkRole = 'idle' | 'woodcutter' | 'miner' | 'builder' | 'hauler';
export type ResidentMode = 'idle' | 'moving' | 'working' | 'carrying' | 'building' | 'blocked';
export type WoodSourceId = 'home' | 'eastern';
export type EasternSectorState = 'closed' | 'unlocked' | 'clearing' | 'prepared';
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
  progress: number;
  woodSource: WoodSourceId;
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
  currentGoal: DevelopmentGoal;
}

export const STORAGE_KEY = 'avanpost:gameplay-prototype:v01';
export const WORLD = { width: 3600, height: 1750, groundY: 600 };
const LEGACY_WORLD_WIDTH = 1960;
export const PLOTS = [
  { id: 0, x: 350, y: WORLD.groundY },
  { id: 1, x: 690, y: WORLD.groundY },
  { id: 2, x: 1240, y: WORLD.groundY },
  { id: 3, x: 1590, y: WORLD.groundY },
  { id: 4, x: 2380, y: WORLD.groundY },
  { id: 5, x: 2780, y: WORLD.groundY }
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
  }
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
    targetStoreId: null, pickupStoreId: null, pickupResource: null, progress: 0,
    woodSource: 'home'
  };
}

function hasStoreCapacity(store: PrototypeStore, incomingReservations = 0): boolean {
	return store.id !== 'store-under-construction' &&
		store.wood + store.stone + incomingReservations < store.capacity;
}

function nearestStoreWithCapacity(
	stores: PrototypeStore[],
	fromX: number,
	incomingReservations: (storeId: string) => number = () => 0
): PrototypeStore | undefined {
	return stores.filter((store) => hasStoreCapacity(store, incomingReservations(store.id))).sort((a, b) =>
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
    const migrated = world.mapVersion === 2
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
  if (world.easternSector.state === 'closed') return 'unlock-eastern-sector';
  if (world.easternSector.state !== 'prepared') return 'prepare-eastern-sector';
  if (!world.buildings.some((building) => building.x >= PROTOTYPE_CONFIG.easternSector.boundaryX)) {
    return 'build-in-eastern-sector';
  }
  return 'settlement-growth';
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
      targetStoreId: typeof person.targetStoreId === 'string' ? person.targetStoreId : null,
      pickupStoreId: typeof person.pickupStoreId === 'string' ? person.pickupStoreId : null,
      pickupResource: person.pickupResource === 'wood' || person.pickupResource === 'stone'
        ? person.pickupResource : null,
      woodSource: person.woodSource === 'eastern' ? 'eastern' : 'home'
    })),
    easternSector: sector,
    currentGoal: 'build-first-house'
  };
  restoreLogisticsRoutes(restored);
  restored.currentGoal = developmentGoal(restored);
  return restored;
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
  constructor(public world: PrototypeWorld, private readonly onChange: (message?: string) => void = () => {}) {}

  assign(residentId: string, role: WorkRole): boolean {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person) return false;
    if (person.role !== role && this.world.easternSector.clearerId === residentId) {
      this.world.easternSector.clearingPaused = true;
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

  setWoodSource(residentId: string, source: WoodSourceId): { ok: true } | { ok: false; reason: string } {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person) return { ok: false, reason: 'Житель не найден.' };
    if (source === 'eastern' && this.world.easternSector.state !== 'prepared') {
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
    const sector = this.world.easternSector;
    if (sector.state !== 'closed') return { ok: false, reason: 'Восточная опушка уже открыта.' };
    if (!this.world.buildings.some((building) => building.kind === 'house')) {
      return { ok: false, reason: 'Сначала построй первый дом.' };
    }
    const cost = PROTOTYPE_CONFIG.easternSector.unlockCost;
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
    sector.state = 'unlocked';
    this.syncDevelopmentGoal();
    this.onChange('Восточная опушка открыта. Назначь строителя или свободного жителя на расчистку.');
    return { ok: true };
  }

  startEasternClearing(): { ok: true } | { ok: false; reason: string } {
    const sector = this.world.easternSector;
    if (sector.state === 'closed') return { ok: false, reason: 'Сначала открой Восточную опушку.' };
    if (sector.state === 'prepared') return { ok: false, reason: 'Территория уже подготовлена.' };
    if (!this.world.buildings.some((building) => building.kind === 'house')) {
      return { ok: false, reason: 'Сначала построй первый дом.' };
    }
    if (sector.state === 'clearing' && !sector.clearingPaused) {
      return { ok: true };
    }

    const assigned = sector.clearerId
      ? this.world.residents.find((person) => person.id === sector.clearerId)
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

    sector.state = 'clearing';
    sector.clearerId = worker.id;
    sector.clearingPaused = false;
    worker.targetSiteId = null;
    worker.targetX = PROTOTYPE_CONFIG.easternSector.clearingX;
    worker.targetY = WORLD.groundY;
    worker.blockedReason = null;
    worker.progress = 0;
    if (Math.abs(worker.x - PROTOTYPE_CONFIG.easternSector.clearingX) <= 1) {
      worker.x = PROTOTYPE_CONFIG.easternSector.clearingX;
      worker.mode = 'working';
      worker.task = 'Расчищает Восточную опушку';
    } else {
      worker.mode = 'moving';
      worker.task = 'Идёт расчищать Восточную опушку';
    }
    this.syncDevelopmentGoal();
    this.onChange(`${worker.name} направлен на расчистку Восточной опушки.`);
    return { ok: true };
  }

  isPlotAvailable(plotId: number): boolean {
    const plot = PLOTS.find((candidate) => candidate.id === plotId);
    if (!plot || this.world.occupiedPlots.includes(plotId)) return false;
    return plot.x < PROTOTYPE_CONFIG.easternSector.boundaryX ||
      this.world.easternSector.state === 'prepared';
  }

  place(kind: BuildingKind, plotId: number): { ok: true } | { ok: false; reason: string } {
    const plot = PLOTS.find((candidate) => candidate.id === plotId);
    if (!plot) return { ok: false, reason: 'Выбери отмеченное место на карте.' };
    if (this.world.occupiedPlots.includes(plotId)) return { ok: false, reason: 'Это место уже занято.' };
    if (!this.isPlotAvailable(plotId)) {
      return {
        ok: false,
        reason: this.world.easternSector.state === 'closed'
          ? 'Восточная опушка закрыта.'
          : 'Сначала физически подготовь землю на Восточной опушке.'
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
    for (const person of this.world.residents) this.updateResident(person, dt);
    this.syncDevelopmentGoal();
  }

  totals() {
    const wood = this.world.stores.reduce((sum, store) => sum + store.wood, 0);
    const stone = this.world.stores.reduce((sum, store) => sum + store.stone, 0);
    const capacity = this.world.stores.reduce((sum, store) => sum + store.capacity, 0);
    const housing = 3 + this.world.buildings.filter((building) => building.kind === 'house').length;
    return { wood, stone, capacity, stored: wood + stone, population: this.world.residents.length, housing };
  }

  private syncDevelopmentGoal(): void {
    this.world.currentGoal = developmentGoal(this.world);
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
    return this.world.residents.filter((person) => person.id !== exceptResidentId &&
      person.pickupStoreId === storeId && person.pickupResource === resource).length;
  }

  private reservedForSite(siteId: string, resource: Resource): number {
    return this.world.residents.filter((person) => person.targetSiteId === siteId &&
      (person.cargo === resource || person.pickupResource === resource)).length;
  }

	private reservedInboundCapacity(storeId: string, exceptResidentId?: string): number {
		return this.world.residents.filter((person) => person.id !== exceptResidentId &&
			person.cargo !== null && person.targetSiteId === null && person.targetStoreId === storeId).length;
	}

	private hasCapacityForDelivery(store: PrototypeStore, exceptResidentId?: string): boolean {
		return hasStoreCapacity(store, this.reservedInboundCapacity(store.id, exceptResidentId));
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
    if (sector.state !== 'prepared') {
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
    const sector = this.world.easternSector;
    return sector.state === 'clearing' && !sector.clearingPaused &&
      sector.clearerId === person.id && !person.cargo &&
      (person.role === 'builder' || person.role === 'idle');
  }

  private updateClearingWorker(person: PrototypeResident, dt: number): void {
    const sector = this.world.easternSector;
    if (person.role !== 'builder' && person.role !== 'idle') {
      sector.clearingPaused = true;
      return;
    }
    if (person.cargo) return;

    const targetX = PROTOTYPE_CONFIG.easternSector.clearingX;
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
    person.task = `Расчищает Восточную опушку · ${Math.round(sector.clearingProgress * 100)}%`;
    person.progress += dt;
    sector.clearingProgress = Math.min(1, sector.clearingProgress + dt / PROTOTYPE_CONFIG.easternSector.clearingWorkSeconds);
    if (sector.clearingProgress >= 1) {
      sector.state = 'prepared';
      sector.clearerId = null;
      sector.clearingPaused = false;
      person.mode = 'idle';
      person.task = 'Восточная опушка подготовлена';
      person.targetX = null;
      person.targetY = null;
      person.progress = 0;
      this.syncDevelopmentGoal();
      this.onChange('Восточная опушка готова. Новый лес открыт — найти его поможет указатель.');
    }
  }

  private updateResident(person: PrototypeResident, dt: number): void {
    if (this.isActiveClearingWorker(person)) {
      this.updateClearingWorker(person, dt);
      return;
    }
    if (person.cargo && !this.ensureCargoDestination(person)) return;
    if (person.mode === 'blocked') {
      if (person.cargo) this.tryResumeCargo(person);
      else if (person.role === 'builder' || person.role === 'hauler') this.planDelivery(person);
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
        if (person.pickupStoreId && !person.cargo) this.arriveAtPickup(person);
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
      else if (person.role === 'builder' || person.role === 'hauler') this.planDelivery(person);
    }
  }

  private planHarvest(person: PrototypeResident): void {
    const wood = person.role === 'woodcutter';
    const easternWood = wood && person.woodSource === 'eastern';
    if (easternWood && this.world.easternSector.state !== 'prepared') {
      person.mode = 'blocked';
      person.blockedReason = 'Восточный лес станет доступен после подготовки территории.';
      person.task = person.blockedReason;
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

  private finishHarvest(person: PrototypeResident): void {
    const item: Resource = person.role === 'woodcutter' ? 'wood' : 'stone';
    const easternWood = item === 'wood' && person.woodSource === 'eastern';
    if (easternWood && this.world.easternSector.state === 'prepared' && this.world.easternSector.woodStock > 0) {
      this.world.easternSector.woodStock--;
    } else if (item === 'wood' && !easternWood && this.world.woodSource > 0) {
      this.world.woodSource--;
    } else if (item === 'stone' && this.world.stoneSource > 0) {
      this.world.stoneSource--;
    }
    else { person.mode = 'idle'; return; }
    person.cargo = item;
    person.targetSiteId = null;
    person.targetStoreId = null;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.progress = 0;
    if (!this.routeCargoToStore(person)) {
      this.onChange(person.blockedReason ?? 'Все склады заполнены. Построй ещё один склад или освободи место.');
      return;
    }
    const sourceName = easternWood ? ' на Восточной опушке' : '';
    this.onChange(`${person.name} добыл ${item === 'wood' ? 'дерево' : 'камень'}${sourceName} и несёт его на склад.`);
  }

  private planDelivery(person: PrototypeResident): void {
    const site = this.world.sites.find((candidate) => {
      const cost = COST[candidate.kind];
      const needsMaterials = candidate.deliveredWood + this.reservedForSite(candidate.id, 'wood') < cost.wood ||
        candidate.deliveredStone + this.reservedForSite(candidate.id, 'stone') < cost.stone;
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
    if (site.deliveredWood + this.reservedForSite(site.id, 'wood') < cost.wood) needs.push('wood');
    if (site.deliveredStone + this.reservedForSite(site.id, 'stone') < cost.stone) needs.push('stone');
    const item = needs.find((resource) => this.world.stores.some((store) =>
      store.id !== 'store-under-construction' && store[resource] > this.reservedPickups(store.id, resource)));
    if (!item) {
      const missing = needs.map((resource) => resource === 'wood' ? 'дерева' : 'камня').join(' и ');
      person.mode = 'blocked';
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = `Не хватает ${missing}. Назначь лесоруба или каменщика.`;
      person.task = person.blockedReason;
      return;
    }
    const store = this.findStoreForPickup(item, person.x);
    if (!store) {
      const missing = item === 'wood' ? 'дерева' : 'камня';
      person.mode = 'blocked';
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = `Не хватает ${missing}. Назначь лесоруба или каменщика.`;
      person.task = person.blockedReason;
      return;
    }
    person.cargo = null;
    person.pickupStoreId = store.id;
    person.pickupResource = item;
    person.mode = 'moving';
    person.targetX = store.x;
    person.targetY = WORLD.groundY;
    person.task = `Идёт за ${item === 'wood' ? 'деревом' : 'камнем'} на склад`;
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

  private arriveAtDestination(person: PrototypeResident): void {
    const item = person.cargo;
    if (!item) return;
    const site = person.targetSiteId ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId) : undefined;
    if (site) {
      if (item === 'wood') site.deliveredWood++;
      else site.deliveredStone++;
      person.cargo = null;
      person.targetSiteId = null;
      person.targetStoreId = null;
      person.pickupStoreId = null;
      person.pickupResource = null;
      person.mode = 'idle';
      person.task = 'Материал доставлен';
      person.progress = 0;
      person.targetX = null;
      person.targetY = null;
      person.blockedReason = null;
      this.onChange(`${item === 'wood' ? 'Дерево' : 'Камень'} доставлено на стройку.`);
      return;
    }
    person.targetSiteId = null;
	const store = this.world.stores.find((candidate) =>
		candidate.id === person.targetStoreId && this.hasCapacityForDelivery(candidate, person.id));
    if (!store) {
      this.routeCargoToStore(person);
      return;
    }
    store[item]++;
    person.cargo = null;
    person.targetStoreId = null;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.mode = 'idle';
    person.task = `${item === 'wood' ? 'Дерево' : 'Камень'} доставлено на склад`;
    person.progress = 0;
    person.targetX = null;
    person.targetY = null;
    person.blockedReason = null;
    this.onChange(`${item === 'wood' ? 'Дерево' : 'Камень'} принят на склад.`);
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

    const unreserved = store[resource] - this.reservedPickups(store.id, resource, person.id);
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

    store[resource]--;
    person.cargo = resource;
    person.pickupStoreId = null;
    person.pickupResource = null;
    person.targetStoreId = null;
    person.mode = 'carrying';
    person.targetX = site.x;
    person.targetY = WORLD.groundY;
    person.task = `Несёт ${resource === 'wood' ? 'бревно' : 'камень'} на стройку`;
    person.blockedReason = null;
    this.onChange(`${person.name} забрал ${resource === 'wood' ? 'бревно' : 'камень'} со склада.`);
  }

	private findStoreForDeposit(fromX: number, residentId: string): PrototypeStore | undefined {
		return nearestStoreWithCapacity(this.world.stores, fromX,
			(storeId) => this.reservedInboundCapacity(storeId, residentId));
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
	const store = this.findStoreForDeposit(person.x, person.id);
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
			candidate.id === person.targetStoreId && this.hasCapacityForDelivery(candidate, person.id))
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
