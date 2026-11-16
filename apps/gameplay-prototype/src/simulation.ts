export type Resource = 'wood' | 'stone';
export type BuildingKind = 'house' | 'warehouse';
export type WorkRole = 'idle' | 'woodcutter' | 'miner' | 'builder' | 'hauler';
export type ResidentMode = 'idle' | 'moving' | 'working' | 'carrying' | 'building' | 'blocked';

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
  progress: number;
}

export interface PrototypeStore {
  id: string;
  x: number;
  y: number;
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

export interface PrototypeWorld {
  version: 1;
  mapVersion: 2;
  elapsedSeconds: number;
  woodSource: number;
  stoneSource: number;
  residents: PrototypeResident[];
  stores: PrototypeStore[];
  buildings: PrototypeBuilding[];
  sites: PrototypeSite[];
  occupiedPlots: number[];
  nextId: number;
}

export const STORAGE_KEY = 'avanpost:gameplay-prototype:v01';
export const WORLD = { width: 1700, height: 1800, groundY: 860, depthBack: 500, depthFront: 1450 };
export const RESOURCE_NODES = {
  wood: { x: 200, y: 850 },
  stone: { x: 1495, y: 790 }
} as const;
export const PLOTS = [
  { id: 0, x: 455, y: 700 },
  { id: 1, x: 638, y: 1050 },
  { id: 2, x: 1032, y: 720 },
  { id: 3, x: 1230, y: 1040 },
  { id: 4, x: 600, y: 1380 },
  { id: 5, x: 850, y: 1450 },
  { id: 6, x: 1080, y: 1330 },
  { id: 7, x: 1450, y: 1280 }
] as const;

const LEGACY_WORLD = { width: 1120, groundY: 414 };
const LEGACY_PLOTS = [
  { id: 0, x: 300 },
  { id: 1, x: 420 },
  { id: 2, x: 680 },
  { id: 3, x: 810 }
] as const;

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
    blockedReason: null, cargo: null, targetX: null, targetY: null, targetSiteId: null, progress: 0
  };
}

export function createNewWorld(): PrototypeWorld {
  return {
    version: 1,
    mapVersion: 2,
    elapsedSeconds: 0,
    woodSource: 32,
    stoneSource: 30,
    residents: [
      { ...resident('r1', 'Илья', 730), y: WORLD.groundY - 12 },
      resident('r2', 'Мария', 812),
      { ...resident('r3', 'Саша', 894), y: WORLD.groundY + 12 }
    ],
    stores: [{ id: 'store-1', x: 812, y: WORLD.groundY, wood: 3, stone: 2, capacity: 12 }],
    buildings: [],
    sites: [],
    occupiedPlots: [],
    nextId: 2
  };
}

export function parseSavedWorld(raw: string | null): PrototypeWorld | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const world = value as PrototypeWorld;
    if (world.version !== 1 || !Array.isArray(world.residents) || !Array.isArray(world.stores) ||
        !Array.isArray(world.buildings) || !Array.isArray(world.sites) || !Array.isArray(world.occupiedPlots) ||
        !Number.isFinite(world.woodSource) || !Number.isFinite(world.stoneSource)) return null;
    if (world.residents.length < 3 || world.residents.length > 8 ||
        world.residents.some((person) => !person.id || !Number.isFinite(person.x) ||
          !['idle', 'woodcutter', 'miner', 'builder', 'hauler'].includes(person.role) ||
          !['idle', 'moving', 'working', 'carrying', 'building', 'blocked'].includes(person.mode))) return null;
    if (world.stores.some((store) => !Number.isFinite(store.wood) || !Number.isFinite(store.stone) ||
        store.wood < 0 || store.stone < 0 || store.wood + store.stone > store.capacity)) return null;
    if (!Number.isFinite(world.nextId) || !Number.isFinite(world.elapsedSeconds)) return null;
    if (world.mapVersion === undefined) return migrateLegacyWorld(world);
    if (world.mapVersion !== 2) return null;
    if (world.stores.some((store) => !Number.isFinite(store.y)) ||
        world.buildings.some((building) => !Number.isFinite(building.x) || !Number.isFinite(building.y)) ||
        world.sites.some((site) => !Number.isFinite(site.x) || !Number.isFinite(site.y)) ||
        world.residents.some((person) => !Number.isFinite(person.y))) return null;
    return world;
  } catch {
    return null;
  }
}

function migrateLegacyWorld(world: PrototypeWorld): PrototypeWorld {
  const scaleX = WORLD.width / LEGACY_WORLD.width;
  const moveY = (y: number): number => y + WORLD.groundY - LEGACY_WORLD.groundY;
  const moveX = (x: number): number => x * scaleX;
  const migrated = world as PrototypeWorld & { mapVersion?: number };
  migrated.mapVersion = 2;
  migrated.residents = migrated.residents.map((person) => ({
    ...person,
    x: moveX(person.x),
    y: moveY(Number.isFinite(person.y) ? person.y : LEGACY_WORLD.groundY),
    targetX: person.targetX == null ? null : moveX(person.targetX),
    targetY: person.targetY == null ? null : moveY(person.targetY)
  }));
  migrated.stores = migrated.stores.map((store) => ({
    ...store,
    x: moveX(store.x),
    y: moveY(Number.isFinite(store.y) ? store.y : LEGACY_WORLD.groundY)
  }));

  const migratePlotPosition = (x: number, y: number): { x: number; y: number } => {
    const legacyPlot = LEGACY_PLOTS.find((plot) => Math.abs(plot.x - x) < 1);
    const newPlot = legacyPlot && PLOTS.find((plot) => plot.id === legacyPlot.id);
    return newPlot ? { x: newPlot.x, y: newPlot.y } : { x: moveX(x), y: moveY(y) };
  };
  migrated.buildings = migrated.buildings.map((building) => ({
    ...building,
    ...migratePlotPosition(building.x, building.y)
  }));
  migrated.sites = migrated.sites.map((site) => ({
    ...site,
    ...migratePlotPosition(site.x, site.y)
  }));
  return migrated;
}

function storeApproach(store: PrototypeStore, fromX: number, fromY: number): { x: number; y: number } {
  const side = fromX <= store.x ? -1 : 1;
  return {
    x: store.x + side * 185,
    y: store.y + (fromY <= store.y ? 42 : -42)
  };
}

function siteApproach(site: PrototypeSite, fromX: number, fromY: number): { x: number; y: number } {
  const side = fromX <= site.x ? -1 : 1;
  return {
    x: site.x + side * 190,
    y: site.y + (fromY <= site.y ? 58 : -58)
  };
}

export class PrototypeSimulation {
  constructor(public world: PrototypeWorld, private readonly onChange: (message?: string) => void = () => {}) {}

  assign(residentId: string, role: WorkRole): boolean {
    const person = this.world.residents.find((candidate) => candidate.id === residentId);
    if (!person) return false;
    person.role = role;
    person.blockedReason = null;
    person.progress = 0;
    if (person.cargo) {
      person.mode = person.targetSiteId && this.world.sites.some((site) => site.id === person.targetSiteId) ? 'carrying' : 'carrying';
      person.task = person.targetSiteId ? 'Доставляет материал на площадку' : 'Несёт груз на склад';
      const destination = person.targetSiteId
        ? this.world.sites.find((site) => site.id === person.targetSiteId)
        : this.findStoreForDeposit(person.cargo);
      const approach = destination
        ? person.targetSiteId
          ? siteApproach(destination as PrototypeSite, person.x, person.y)
          : storeApproach(destination as PrototypeStore, person.x, person.y)
        : { x: person.x, y: person.y };
      person.targetX = approach.x;
      person.targetY = approach.y;
    } else {
      person.mode = 'idle';
      person.task = role === 'idle' ? 'Ждёт назначения' : `${ROLE_LABEL[role]}: готовится к работе`;
      person.targetSiteId = null;
      person.targetX = null;
      person.targetY = null;
    }
    this.onChange(`${person.name}: ${ROLE_LABEL[role]}`);
    return true;
  }

  place(kind: BuildingKind, plotId: number): { ok: true } | { ok: false; reason: string } {
    const plot = PLOTS.find((candidate) => candidate.id === plotId);
    if (!plot) return { ok: false, reason: 'Выбери отмеченное место на карте.' };
    if (this.world.occupiedPlots.includes(plotId)) return { ok: false, reason: 'Это место уже занято.' };
    if (this.world.sites.length >= 2) return { ok: false, reason: 'Сначала заверши или отмени одну из площадок.' };
    const id = `site-${this.world.nextId++}`;
    this.world.occupiedPlots.push(plotId);
    this.world.sites.push({
      id, kind, x: plot.x, y: plot.y, deliveredWood: 0, deliveredStone: 0, progress: 0, stage: 0
    });
    this.onChange(kind === 'house' ? 'Площадка дома готова. Назначь строителя и добывай материалы.' : 'Площадка склада готова. Строитель доставит материалы.');
    return { ok: true };
  }

  cancelSite(siteId: string): boolean {
    const index = this.world.sites.findIndex((site) => site.id === siteId);
    if (index < 0) return false;
    const [site] = this.world.sites.splice(index, 1);
    const plotId = PLOTS.find((plot) => plot.x === site!.x && plot.y === site!.y)?.id;
    if (plotId !== undefined) this.world.occupiedPlots = this.world.occupiedPlots.filter((id) => id !== plotId);
    for (const person of this.world.residents) {
      if (person.targetSiteId === siteId && !person.cargo) {
        person.mode = 'idle'; person.task = 'Площадка отменена'; person.targetSiteId = null; person.targetX = null;
      }
    }
    this.onChange('Стройка отменена. Доставленные материалы остались на площадке.');
    return true;
  }

  step(deltaSeconds: number): void {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1);
    this.world.elapsedSeconds += dt;
    for (const person of this.world.residents) this.updateResident(person, dt);
  }

  totals() {
    const wood = this.world.stores.reduce((sum, store) => sum + store.wood, 0);
    const stone = this.world.stores.reduce((sum, store) => sum + store.stone, 0);
    const capacity = this.world.stores.reduce((sum, store) => sum + store.capacity, 0);
    const housing = 3 + this.world.buildings.filter((building) => building.kind === 'house').length;
    return { wood, stone, capacity, stored: wood + stone, population: this.world.residents.length, housing };
  }

  private updateResident(person: PrototypeResident, dt: number): void {
    if (person.mode === 'blocked') {
      if (person.cargo) this.tryResumeCargo(person);
      else if (person.role === 'builder' || person.role === 'hauler') this.planDelivery(person);
      else if (person.role === 'woodcutter' || person.role === 'miner') this.planHarvest(person);
      return;
    }
    if (person.mode === 'moving' || person.mode === 'carrying') {
      if (person.targetX === null || person.targetY === null) { person.mode = 'idle'; return; }
      const dx = person.targetX - person.x;
      const dy = person.targetY - person.y;
      const distance = Math.hypot(dx, dy);
      const movement = 78 * dt;
      if (distance <= movement) {
        person.x = person.targetX;
        person.y = person.targetY;
        if (person.cargo) this.arriveAtDestination(person);
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
        person.x += dx / distance * movement;
        person.y += dy / distance * movement;
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
    const remaining = wood ? this.world.woodSource : this.world.stoneSource;
    if (remaining <= 0) {
      person.mode = 'blocked'; person.blockedReason = wood ? 'Лесной участок выработан.' : 'Каменный выход выработан.';
      person.task = person.blockedReason; return;
    }
    const node = RESOURCE_NODES[wood ? 'wood' : 'stone'];
    const side = person.x <= node.x ? 1 : -1;
    person.mode = 'moving';
    person.targetX = node.x + side * 72;
    person.targetY = node.y + (person.y <= node.y ? 34 : -34);
    person.task = wood ? 'Идёт к лесу' : 'Идёт к каменному выходу';
    person.blockedReason = null;
  }

  private finishHarvest(person: PrototypeResident): void {
    const item: Resource = person.role === 'woodcutter' ? 'wood' : 'stone';
    if (item === 'wood' && this.world.woodSource > 0) this.world.woodSource--;
    else if (item === 'stone' && this.world.stoneSource > 0) this.world.stoneSource--;
    else { person.mode = 'idle'; return; }
    person.cargo = item;
    person.progress = 0;
    person.mode = 'carrying';
    person.task = `Несёт ${item === 'wood' ? 'бревно' : 'камень'} на склад`;
    const store = this.findStoreForDeposit(item);
    if (!store) {
      person.mode = 'blocked';
      person.blockedReason = 'Все склады заполнены. Построй ещё один склад или освободи место.';
      person.task = person.blockedReason;
      this.onChange(person.blockedReason);
      return;
    }
    const approach = storeApproach(store, person.x, person.y);
    person.targetX = approach.x;
    person.targetY = approach.y;
    this.onChange(`${person.name} добыл ${item === 'wood' ? 'дерево' : 'камень'} и несёт его на склад.`);
  }

  private planDelivery(person: PrototypeResident): void {
    const site = this.world.sites.find((candidate) => !this.siteHasAllMaterials(candidate) ||
      (person.role === 'builder' && candidate.progress < 1));
    if (!site) {
      person.mode = 'idle';
      person.task = 'Нет активных строительных заказов';
      person.blockedReason = null;
      person.targetSiteId = null;
      return;
    }
    person.blockedReason = null;
    person.targetSiteId = site.id;
    if (this.siteHasAllMaterials(site)) {
      if (person.role === 'builder') {
        const approach = siteApproach(site, person.x, person.y);
        person.mode = 'moving'; person.targetX = approach.x; person.targetY = approach.y; person.task = 'Идёт к стройке';
      } else {
        person.mode = 'idle'; person.task = 'Материалы доставлены; нужен строитель';
      }
      return;
    }
    const needs: Resource[] = [];
    const cost = COST[site.kind];
    if (site.deliveredWood < cost.wood) needs.push('wood');
    if (site.deliveredStone < cost.stone) needs.push('stone');
    const item = needs.find((resource) => this.world.stores.some((store) => store[resource] > 0));
    if (!item) {
      const missing = needs.map((resource) => resource === 'wood' ? 'дерева' : 'камня').join(' и ');
      person.mode = 'blocked';
      person.blockedReason = `Не хватает ${missing}. Назначь лесоруба или каменщика.`;
      person.task = person.blockedReason;
      return;
    }
    const store = this.world.stores.find((candidate) => candidate[item] > 0)!;
    store[item]--;
    person.cargo = item;
    person.mode = 'carrying';
    const approach = siteApproach(site, person.x, person.y);
    person.targetX = approach.x;
    person.targetY = approach.y;
    person.task = `Несёт ${item === 'wood' ? 'бревно' : 'камень'} на стройку`;
    this.onChange(`${person.name} забрал ${item === 'wood' ? 'бревно' : 'камень'} со склада.`);
  }

  private tryResumeCargo(person: PrototypeResident): void {
    if (!person.cargo) return;
    if (person.targetSiteId && this.world.sites.some((site) => site.id === person.targetSiteId)) {
      const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId)!;
      const approach = siteApproach(site, person.x, person.y);
      person.mode = 'carrying'; person.targetX = approach.x; person.targetY = approach.y;
      person.task = 'Продолжает доставку на площадку'; person.blockedReason = null;
      return;
    }
    const store = this.findStoreForDeposit(person.cargo);
    if (!store) {
      person.blockedReason = 'Все склады заполнены. Построй ещё один склад или освободи место.';
      person.task = person.blockedReason; return;
    }
    const approach = storeApproach(store, person.x, person.y);
    person.mode = 'carrying'; person.targetX = approach.x; person.targetY = approach.y;
    person.task = 'Несёт груз на склад'; person.blockedReason = null;
  }

  private arriveAtDestination(person: PrototypeResident): void {
    const item = person.cargo!;
    const site = person.targetSiteId ? this.world.sites.find((candidate) => candidate.id === person.targetSiteId) : undefined;
    if (site) {
      if (item === 'wood') site.deliveredWood++;
      else site.deliveredStone++;
      person.cargo = null;
      person.mode = 'idle';
      person.task = 'Материал доставлен';
      person.progress = 0;
      this.onChange(`${item === 'wood' ? 'Дерево' : 'Камень'} доставлено на стройку.`);
      return;
    }
    const store = this.world.stores.find((candidate) => candidate.id !== 'store-under-construction' &&
      candidate.wood + candidate.stone < candidate.capacity);
    if (!store) {
      person.mode = 'blocked'; person.blockedReason = 'Все склады заполнены. Построй ещё один склад или освободи место.';
      person.task = person.blockedReason; return;
    }
    store[item]++;
    person.cargo = null;
    person.mode = 'idle';
    person.task = `${item === 'wood' ? 'Дерево' : 'Камень'} доставлено на склад`;
    person.progress = 0;
    this.onChange(`${item === 'wood' ? 'Дерево' : 'Камень'} принят на склад.`);
  }

  private findStoreForDeposit(_item: Resource): PrototypeStore | undefined {
    return this.world.stores.filter((store) => store.wood + store.stone < store.capacity)
      .sort((a, b) => Math.hypot(a.x - 812, a.y - WORLD.groundY) - Math.hypot(b.x - 812, b.y - WORLD.groundY))[0];
  }

  private siteHasAllMaterials(site: PrototypeSite): boolean {
    const cost = COST[site.kind];
    return site.deliveredWood >= cost.wood && site.deliveredStone >= cost.stone;
  }

  private completeBuilding(site: PrototypeSite): void {
    this.world.buildings.push({ id: `building-${this.world.nextId++}`, kind: site.kind, x: site.x, y: site.y });
    this.world.sites = this.world.sites.filter((candidate) => candidate.id !== site.id);
    if (site.kind === 'warehouse') {
       this.world.stores.push({ id: `store-${this.world.nextId++}`, x: site.x, y: site.y, wood: 0, stone: 0, capacity: 12 });
    } else {
      const housing = 3 + this.world.buildings.filter((building) => building.kind === 'house').length;
      while (this.world.residents.length < housing && this.world.residents.length < 8) {
        const index = this.world.residents.length;
         this.world.residents.push({
           ...resident(`r${this.world.nextId++}`, NEW_NAMES[(index - 3) % NEW_NAMES.length]!, site.x + 32),
           y: site.y + 34
         });
      }
    }
    for (const person of this.world.residents) {
      if (person.targetSiteId === site.id) {
        person.targetSiteId = null; person.cargo = null; person.mode = 'idle'; person.progress = 0;
        person.task = 'Стройка завершена';
        person.blockedReason = null;
      }
    }
    this.onChange(site.kind === 'house' ? 'Дом готов! Вместимость жилья выросла, поселение встречает нового жителя.' : 'Новый склад открыт: вместимость поселения выросла.');
  }
}
