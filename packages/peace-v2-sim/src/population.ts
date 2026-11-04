import type { PeaceResident, PeaceWorldSnapshot } from '@avanpost/peace-v2-shared';
import { G7_1_POPULATION_BALANCE } from './g7-population-config.js';
import { findSurfacePath } from './layout.js';

const names = ['Арина', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Зоя', 'Илья', 'Кира', 'Лев'];
const appearances = ['migrant-amber', 'migrant-teal', 'migrant-russet', 'migrant-olive', 'migrant-blue'];

export function ensurePopulationState(world: PeaceWorldSnapshot): PeaceWorldSnapshot {
  world.populationMigration ??= {
    progressTicks: 0, progressRequired: G7_1_POPULATION_BALANCE.migrationProgressTicks,
    nextResidentSequence: 1, pendingResidentId: null, attraction: 'no_housing', lastArrivalTick: null
  };
  for (const building of world.buildings) {
    building.housingCapacity = building.kind === 'cabin'
      ? building.housingCapacity || G7_1_POPULATION_BALANCE.cabinCapacity : 0;
  }
  const nextSequence = Math.max(1, ...world.residents.map((resident) => {
    const match = /^resident-migrant-(\d+)$/.exec(resident.id);
    return match ? Number(match[1]) + 1 : 1;
  }));
  world.populationMigration.nextResidentSequence = Math.max(world.populationMigration.nextResidentSequence, nextSequence);
  redistributeResidentsToHousing(world);
  return world;
}

export function housingSummary(world: PeaceWorldSnapshot) {
  const housingPlaces = world.buildings.reduce((total, building) => total +
    (building.kind === 'cabin' && building.state === 'complete' ? building.housingCapacity : 0), 0);
  const occupied = world.residents.filter((resident) => resident.housingBuildingId !== null).length;
  const working = world.residents.filter((resident) => resident.task !== null && resident.task.kind !== 'arrival').length;
  const free = world.residents.filter((resident) => resident.arrivalState === 'settled' && resident.task === null).length;
  const migration = world.populationMigration;
  return {
    total: world.residents.length,
    working,
    free,
    unassigned: free,
    homeless: world.residents.length - occupied,
    housingPlaces,
    freeHousingPlaces: Math.max(0, housingPlaces - occupied),
    migrationState: migration.pendingResidentId ? 'arriving' as const
      : migration.progressTicks > 0 ? 'progress' as const : 'waiting' as const,
    migrationProgressTicks: migration.progressTicks,
    migrationProgressRequired: migration.progressRequired,
    attraction: migration.attraction,
    factors: migration.attraction === 'sufficient'
      ? ['Есть свободное жильё', 'Достаточно ресурсов', 'Есть работающие жители']
      : migration.attraction === 'no_housing' ? ['Нет свободного жилья']
        : ['Нужны базовые ресурсы и работающая экономика']
  };
}

export function residentHasWork(world: PeaceWorldSnapshot): boolean {
  return world.residents.filter((resident) => resident.arrivalState === 'settled' &&
    resident.task !== null && resident.task.kind !== 'arrival').length >= G7_1_POPULATION_BALANCE.minimumWorkingResidents;
}

export function populationCanAdvance(world: PeaceWorldSnapshot): boolean {
  if (world.residents.some((resident) => resident.task?.kind === 'arrival')) return true;
  const summary = housingSummary(world);
  return summary.freeHousingPlaces > 0 && residentHasWork(world) &&
    world.resources.wood >= G7_1_POPULATION_BALANCE.minimumWood && world.resources.stone >= G7_1_POPULATION_BALANCE.minimumStone;
}

export function advancePopulation(world: PeaceWorldSnapshot): boolean {
  let changed = redistributeResidentsToHousing(world);
  const migration = world.populationMigration;
  const pending = migration.pendingResidentId
    ? world.residents.find((resident) => resident.id === migration.pendingResidentId) : undefined;
  if (pending?.task?.kind === 'arrival') {
    const task = pending.task;
    if (task.phase === 'waiting_path' && world.revision.serverTick % 5 === 0) {
      const building = world.buildings.find((candidate) => candidate.id === task.targetBuildingId &&
        candidate.kind === 'cabin' && candidate.state === 'complete');
      const destination = building?.entrance;
      const path = destination ? findSurfacePath(world, pending.position, destination) : null;
      if (path) {
        task.path = path;
        task.pathIndex = 0;
        task.phase = 'commuting';
        task.blockedReason = null;
        pending.blockedReason = null;
        pending.visualState = 'walking_to_settlement';
        pending.state = 'working';
        changed = true;
      }
    }
    migration.attraction = 'sufficient';
    return changed;
  }
  if (migration.pendingResidentId) {
    migration.pendingResidentId = null;
    changed = true;
  }

  const summary = housingSummary(world);
  if (summary.freeHousingPlaces < 1) {
    if (migration.progressTicks !== 0 || migration.attraction !== 'no_housing') changed = true;
    migration.progressTicks = 0;
    migration.attraction = 'no_housing';
    return changed;
  }
  const eligible = residentHasWork(world) && world.resources.wood >= G7_1_POPULATION_BALANCE.minimumWood &&
    world.resources.stone >= G7_1_POPULATION_BALANCE.minimumStone;
  if (!eligible) {
    migration.attraction = 'insufficient';
    return true;
  }
  migration.attraction = 'sufficient';
  migration.progressTicks = Math.min(migration.progressRequired, migration.progressTicks + 1);
  changed = true;
  if (migration.progressTicks < migration.progressRequired) return changed;

  const home = homeWithFreePlace(world);
  const entry = home?.entrance ? arrivalEntry(world, home.entrance) : null;
  if (!home || !entry) {
    migration.attraction = home ? 'insufficient' : 'no_housing';
    migration.progressTicks = Math.max(0, migration.progressRequired - 1);
    return true;
  }
  const sequence = migration.nextResidentSequence++;
  const id = `resident-migrant-${sequence}`;
  const arrivalPath = home.entrance ? findSurfacePath(world, entry, home.entrance) : null;
  const traits = traitValues(sequence);
  const resident: PeaceResident = {
    id,
    name: names[(sequence - 1) % names.length]!,
    appearanceKey: appearances[(sequence - 1) % appearances.length]!,
    position: entry,
    facing: 'left', state: arrivalPath ? 'working' : 'waiting', workRole: 'none',
    visualState: arrivalPath ? 'walking_to_settlement' : 'waiting_path',
    cargo: 0, cargoItemId: null, preferredStorageId: null, preferredHaulSourceId: null,
    blockedReason: arrivalPath ? null : 'NO_PATH_TO_SETTLEMENT',
    createdAtTick: world.revision.serverTick, arrivedAtTick: null,
    civilianProfession: 'general_worker', civilianXp: 0, learningHistory: [], innateTraits: traits.traits,
    characteristics: traits.characteristics, housingBuildingId: home.id,
    arrivalState: 'commuting',
    task: {
      kind: 'arrival', id: `arrival-${id}`, phase: arrivalPath ? 'commuting' : 'waiting_path',
      targetBuildingId: home.id, path: arrivalPath ?? [], pathIndex: 0, progressTicks: 0,
      requiredTicks: Math.max(1, arrivalPath?.length ?? 1), blockedReason: arrivalPath ? null : 'NO_PATH_TO_SETTLEMENT'
    }
  };
  world.residents.push(resident);
  migration.pendingResidentId = resident.id;
  migration.progressTicks = 0;
  migration.lastArrivalTick = world.revision.serverTick;
  return true;
}

export function awardCivilianExperience(world: PeaceWorldSnapshot, residentIds: Iterable<string>): void {
  for (const id of residentIds) {
    const resident = world.residents.find((candidate) => candidate.id === id);
    if (resident) resident.civilianXp += G7_1_POPULATION_BALANCE.experiencePerWorkTick;
  }
}

export function redistributeResidentsToHousing(world: PeaceWorldSnapshot): boolean {
  let changed = false;
  const occupied = new Map<string, number>();
  for (const resident of world.residents) {
    const home = resident.housingBuildingId
      ? world.buildings.find((building) => building.id === resident.housingBuildingId && building.kind === 'cabin' &&
        building.state === 'complete') : undefined;
    if (!home) {
      if (resident.housingBuildingId !== null) { resident.housingBuildingId = null; changed = true; }
      continue;
    }
    const count = occupied.get(home.id) ?? 0;
    if (count >= home.housingCapacity) { resident.housingBuildingId = null; changed = true; continue; }
    occupied.set(home.id, count + 1);
  }
  const homes = world.buildings.filter((building) => building.kind === 'cabin' && building.state === 'complete');
  for (const resident of world.residents) {
    if (resident.housingBuildingId) continue;
    const home = homes.find((building) => (occupied.get(building.id) ?? 0) < building.housingCapacity);
    if (!home) continue;
    resident.housingBuildingId = home.id;
    occupied.set(home.id, (occupied.get(home.id) ?? 0) + 1);
    changed = true;
  }
  for (const resident of world.residents) {
    if (resident.task?.kind !== 'arrival') continue;
    const home = world.buildings.find((building) => building.id === resident.housingBuildingId &&
      building.kind === 'cabin' && building.state === 'complete');
    if (!home?.entrance || home.id === resident.task.targetBuildingId) continue;
    resident.task.targetBuildingId = home.id;
    const route = findSurfacePath(world, resident.position, home.entrance);
    resident.task.path = route ?? [];
    resident.task.pathIndex = 0;
    resident.task.phase = route ? 'commuting' : 'waiting_path';
    resident.task.blockedReason = route ? null : 'NO_PATH_TO_SETTLEMENT';
    resident.blockedReason = resident.task.blockedReason;
    resident.visualState = route ? 'walking_to_settlement' : 'waiting_path';
    changed = true;
  }
  return changed;
}

function homeWithFreePlace(world: PeaceWorldSnapshot) {
  const occupied = new Map<string, number>();
  for (const resident of world.residents) {
    if (resident.housingBuildingId) occupied.set(resident.housingBuildingId, (occupied.get(resident.housingBuildingId) ?? 0) + 1);
  }
  return world.buildings.find((building) => building.kind === 'cabin' && building.state === 'complete' &&
    (occupied.get(building.id) ?? 0) < building.housingCapacity);
}

function arrivalEntry(world: PeaceWorldSnapshot, destination: { x: number; y: number }) {
  const ownedSectorIds = new Set(world.sectors.filter((sector) => sector.ownerId !== null).map((sector) => sector.id));
  const occupied = new Set(world.residents.map((resident) => `${resident.position.x},${resident.position.y}`));
  const allWalkable = world.surfaceCells.filter((cell) => cell.position.y === 0 && cell.walkable);
  const owned = allWalkable.filter((cell) => cell.sectorId && ownedSectorIds.has(cell.sectorId));
  const available = owned.length ? owned : allWalkable;
  const maxX = Math.max(...available.map((cell) => cell.position.x));
  const edge = available.filter((cell) => cell.position.x >= maxX - G7_1_POPULATION_BALANCE.arrivalEdgeOffset)
    .sort((a, b) => b.position.x - a.position.x);
  const candidates = [...edge, ...available.filter((cell) => !edge.includes(cell))]
    .sort((a, b) => edge.includes(a) === edge.includes(b) ? b.position.x - a.position.x : edge.includes(a) ? -1 : 1);
  for (const candidate of candidates) {
    if (occupied.has(`${candidate.position.x},${candidate.position.y}`)) continue;
    if (world.buildings.some((building) => building.state !== 'demolished' && building.state !== 'cancelled' &&
      candidate.position.x >= building.anchor.x && candidate.position.x < building.anchor.x + building.footprint.width)) continue;
    if (findSurfacePath(world, candidate.position, destination)) return { ...candidate.position };
  }
  return null;
}

function traitValues(sequence: number) {
  const score = (offset: number) => 3 + ((sequence * (offset * 17 + 13) + offset * 11) % 6);
  return {
    traits: sequence % 2 ? ['early_riser'] : ['steady_hands'],
    characteristics: { strength: score(1), dexterity: score(2), endurance: score(3), intelligence: score(4) }
  };
}
