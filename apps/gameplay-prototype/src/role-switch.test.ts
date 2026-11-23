import { describe, expect, it } from 'vitest';
import { createNewWorld, PrototypeSimulation, WORLD, type PrototypeWorld, type WorkRole } from './simulation.js';
import { LAND_GRID_CONFIG } from './land-grid.js';

const roles: WorkRole[] = ['idle', 'woodcutter', 'miner', 'builder', 'hauler', 'sawmiller'];

function physicalResources(world: PrototypeWorld): Record<'wood' | 'stone' | 'boards', number> {
  const resources = { wood: 0, stone: 0, boards: 0 };
  for (const store of world.stores) {
    resources.wood += store.wood;
    resources.stone += store.stone;
    resources.boards += store.boards ?? 0;
  }
  for (const pile of world.stockpiles) resources[pile.resource] += pile.amount;
  for (const person of world.residents) if (person.cargo) resources[person.cargo] += person.cargoAmount;
  for (const site of world.sites) {
    resources.wood += site.deliveredWood;
    resources.stone += site.deliveredStone;
    resources.boards += site.deliveredBoards ?? 0;
  }
  for (const building of world.buildings) resources.wood += building.inputWood ?? 0;
  return resources;
}

function makeInFlightConstruction(): PrototypeSimulation {
  const world = createNewWorld();
  const simulation = new PrototypeSimulation(world);
  expect(simulation.assign('r1', 'builder')).toBe(true);
  expect(simulation.place('house', 1).ok).toBe(true);
  const site = world.sites[0]!;
  site.x = 3000;
  site.progress = 0.12;
  site.deliveredWood = 10;
  site.deliveredStone = 4;
  world.stores[0]!.wood = world.stores[0]!.capacity;
  world.stores[0]!.stone = 0;
  world.stores[0]!.boards = 0;
  const carrier = world.residents.find((person) => person.id === 'r3')!;
  carrier.role = 'hauler';
  carrier.x = 0;
  carrier.cargo = 'stone';
  carrier.cargoAmount = 6;
  carrier.mode = 'carrying';
  carrier.logisticsRequestId = 'role-switch-active-delivery';
  carrier.targetSiteId = site.id;
  carrier.targetBuildingId = null;
  carrier.targetStoreId = null;
  carrier.targetX = site.x;
  carrier.targetY = site.y;
  carrier.task = 'Доставляет камень на площадку';
  const requestId = 'role-switch-active-delivery';
  carrier.logisticsRequestId = requestId;
  world.logisticsRequests.push({
    id: requestId,
    sequence: world.nextRequestSequence++,
    createdAt: world.elapsedSeconds,
    initiatorId: 'r1',
    type: 'DELIVER_TO_CONSTRUCTION',
    resource: 'stone',
    amount: carrier.cargoAmount,
    pickupStockpileId: null,
    pickupStoreId: null,
    destinationStoreId: null,
    destinationSiteId: site.id,
    destinationBuildingId: null,
    status: 'in_progress',
    assignedHaulerId: carrier.id
  });
  return simulation;
}

describe('profession changes under active work', () => {
  it('supports every transition, including repeated selections, with a full store and an in-flight construction load', () => {
    const simulation = makeInFlightConstruction();
    const carrier = simulation.world.residents.find((person) => person.id === 'r3')!;
    const site = simulation.world.sites[0]!;
    const request = simulation.world.logisticsRequests.find((item) => item.id === carrier.logisticsRequestId)!;
    const before = physicalResources(simulation.world);
    const progressBefore = site.progress;

    for (const from of roles) {
      for (const to of roles) {
        expect(simulation.assign(carrier.id, from)).toBe(true);
        expect(simulation.assign(carrier.id, to)).toBe(true);
        expect(carrier.role).toBe(to);
        expect(carrier.cargo).toBe('stone');
        expect(carrier.cargoAmount).toBe(6);
        expect(carrier.targetSiteId).toBe(site.id);
        expect(request.assignedHaulerId).toBe(carrier.id);
        expect(request.status).toBe('in_progress');
        expect(physicalResources(simulation.world)).toEqual(before);
        expect(site.progress).toBeGreaterThanOrEqual(progressBefore);
        expect(new Set(simulation.world.logisticsRequests.map((item) => item.id)).size)
          .toBe(simulation.world.logisticsRequests.length);
        simulation.step(0.01);
        const freeCapacity = simulation.world.stores.reduce((sum, store) =>
          sum + Math.max(0, store.capacity - store.wood - store.stone - (store.boards ?? 0)), 0);
        expect(simulation.reservedInboundStorage()).toBeLessThanOrEqual(freeCapacity + 1e-6);
      }
    }

    expect(simulation.world.elapsedSeconds).toBeGreaterThan(0.35);
    expect(simulation.world.stores[0]!.wood).toBe(simulation.world.stores[0]!.capacity);
    expect(carrier.cargoAmount).toBeLessThanOrEqual(10);
  });

  it('keeps the settlement step-capable for at least 120 rapid changes across all six roles', () => {
    const simulation = makeInFlightConstruction();
    const carrier = simulation.world.residents.find((person) => person.id === 'r3')!;
    const seen = new Set<string>();
    let previous = carrier.role;
    let switches = 0;
    const switchTo = (next: WorkRole) => {
      const before = physicalResources(simulation.world);
      expect(simulation.assign(carrier.id, next)).toBe(true);
      expect(carrier.role).toBe(next);
      expect(physicalResources(simulation.world)).toEqual(before);
      seen.add(`${previous}>${next}`);
      previous = next;
      switches++;
      simulation.step(0.01);
      expect(Number.isFinite(simulation.world.elapsedSeconds)).toBe(true);
      expect(simulation.world.stores.every((store) => store.wood + store.stone + (store.boards ?? 0) <= store.capacity))
        .toBe(true);
    };
    for (const from of roles) for (const to of roles) {
      switchTo(from);
      switchTo(to);
    }
    for (let index = 0; switches < 120; index++) switchTo(roles[index % roles.length]!);
    expect(switches).toBe(120);
    expect(seen.size).toBe(36);
    expect(simulation.world.elapsedSeconds).toBeGreaterThan(1.19);
  });

  it('pauses and resumes territory clearing without losing its saved progress on a role change', () => {
    const world = createNewWorld();
    world.buildings.push({ id: 'role-switch-existing-house', kind: 'house', x: 900, y: WORLD.groundY,
      gridColumn: 1, gridRow: LAND_GRID_CONFIG.surfaceCellRow,
      footprint: { widthCells: 1, heightCells: 1 }, level: 1 });
    const cell = world.landCells.find((candidate) => candidate.state === 'closed' && candidate.id === 4)!;
    cell.state = 'unlocked';
    const simulation = new PrototypeSimulation(world);
    const worker = world.residents[0]!;
    expect(simulation.assign(worker.id, 'builder')).toBe(true);
    worker.x = cell.x;
    expect(simulation.startEasternClearing().ok).toBe(true);
    for (let tick = 0; tick < 100; tick++) simulation.step(0.1);
    const savedProgress = cell.clearingProgress;
    expect(savedProgress).toBeGreaterThan(0);

    expect(simulation.assign(worker.id, 'miner')).toBe(true);
    expect(cell.clearingPaused).toBe(true);
    for (let tick = 0; tick < 30; tick++) simulation.step(0.1);
    expect(cell.clearingProgress).toBe(savedProgress);

    expect(simulation.assign(worker.id, 'builder')).toBe(true);
    expect(simulation.startEasternClearing().ok).toBe(true);
    for (let tick = 0; tick < 100; tick++) simulation.step(0.1);
    expect(cell.clearingProgress).toBeGreaterThan(savedProgress);
    expect(cell.clearingPaused).toBe(false);
  });
});
