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
export const WORLD = { width: 1120, height: 510, groundY: 414 };
export const PLOTS = [
  { id: 0, x: 300, y: WORLD.groundY },
  { id: 1, x: 420, y: WORLD.groundY },
  { id: 2, x: 680, y: WORLD.groundY },
  { id: 3, x: 810, y: WORLD.groundY }
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
    elapsedSeconds: 0,
    woodSource: 32,
    stoneSource: 30,
    residents: [resident('r1', 'Илья', 475), resident('r2', 'Мария', 535), resident('r3', 'Саша', 595)],
    stores: [{ id: 'store-1', x: 535, wood: 3, stone: 2, capacity: 12 }],
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
    return world;
  } catch {
    return null;
  }
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
      person.targetX = destination?.x ?? person.x;
      person.targetY = WORLD.groundY;
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
    const plotId = PLOTS.find((plot) => plot.x === site!.x)?.id;
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
      if (person.targetX === null) { person.mode = 'idle'; return; }
      const dx = person.targetX - person.x;
      const distance = Math.abs(dx);
      const movement = 78 * dt;
      if (distance <= movement) {
        person.x = person.targetX;
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
    const remaining = wood ? this.world.woodSource : this.world.stoneSource;
    if (remaining <= 0) {
      person.mode = 'blocked'; person.blockedReason = wood ? 'Лесной участок выработан.' : 'Каменный выход выработан.';
      person.task = person.blockedReason; return;
    }
    const targetX = wood ? 130 : 985;
    person.mode = 'moving'; person.targetX = targetX; person.targetY = WORLD.groundY;
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
    person.targetX = store.x;
    person.targetY = WORLD.groundY;
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
        person.mode = 'moving'; person.targetX = site.x; person.targetY = WORLD.groundY; person.task = 'Идёт к стройке';
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
    person.targetX = site.x;
    person.targetY = WORLD.groundY;
    person.task = `Несёт ${item === 'wood' ? 'бревно' : 'камень'} на стройку`;
    this.onChange(`${person.name} забрал ${item === 'wood' ? 'бревно' : 'камень'} со склада.`);
  }

  private tryResumeCargo(person: PrototypeResident): void {
    if (!person.cargo) return;
    if (person.targetSiteId && this.world.sites.some((site) => site.id === person.targetSiteId)) {
      const site = this.world.sites.find((candidate) => candidate.id === person.targetSiteId)!;
      person.mode = 'carrying'; person.targetX = site.x; person.task = 'Продолжает доставку на площадку'; person.blockedReason = null;
      return;
    }
    const store = this.findStoreForDeposit(person.cargo);
    if (!store) {
      person.blockedReason = 'Все склады заполнены. Построй ещё один склад или освободи место.';
      person.task = person.blockedReason; return;
    }
    person.mode = 'carrying'; person.targetX = store.x; person.task = 'Несёт груз на склад'; person.blockedReason = null;
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
      .sort((a, b) => Math.abs(a.x - 535) - Math.abs(b.x - 535))[0];
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
        person.targetSiteId = null; person.cargo = null; person.mode = 'idle'; person.progress = 0;
        person.task = 'Стройка завершена';
        person.blockedReason = null;
      }
    }
    this.onChange(site.kind === 'house' ? 'Дом готов! Вместимость жилья выросла, поселение встречает нового жителя.' : 'Новый склад открыт: вместимость поселения выросла.');
  }
}
