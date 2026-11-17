import { describe, expect, it } from 'vitest';
import {
  createNewWorld, parseSavedWorld, PROTOTYPE_CONFIG, PrototypeSimulation, STORAGE_KEY, WORLD
} from './simulation.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames; index++) simulation.step(0.1);
}

describe('Gameplay prototype simulation', () => {
  it('starts with three residents and finite physical sources', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    expect(simulation.world.residents).toHaveLength(3);
    expect(simulation.world.woodSource).toBeGreaterThan(0);
    expect(simulation.world.stoneSource).toBeGreaterThan(0);
    expect(simulation.totals()).toMatchObject({ population: 3, housing: 3, capacity: 12 });
  });

  it('harvests one physical unit and deposits it at the warehouse after a visible trip', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const beforeSource = simulation.world.woodSource;
    const beforeStock = simulation.world.stores[0]!.wood;
    simulation.assign('r1', 'woodcutter');
    run(simulation, 15);
    expect(simulation.world.woodSource).toBeLessThan(beforeSource);
    expect(simulation.world.stores[0]!.wood).toBeGreaterThan(beforeStock);
  });

  it('physically supplies a house, builds it in stages, and welcomes the fourth resident', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'woodcutter');
    simulation.assign('r3', 'miner');
    run(simulation, 260);
    expect(simulation.world.sites).toHaveLength(0);
    expect(simulation.world.buildings.filter((building) => building.kind === 'house')).toHaveLength(1);
    expect(simulation.world.residents).toHaveLength(4);
    expect(simulation.totals().housing).toBe(4);
  });

  it('adds real storage capacity and restores the complete settlement from its isolated save key', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('warehouse', 0)).toEqual({ ok: true });
    simulation.assign('r1', 'builder');
    simulation.assign('r2', 'woodcutter');
    simulation.assign('r3', 'miner');
    run(simulation, 240);
    expect(simulation.world.stores).toHaveLength(2);
    expect(simulation.totals().capacity).toBe(24);
    const loaded = parseSavedWorld(JSON.stringify(simulation.world));
    expect(loaded).not.toBeNull();
    expect(loaded?.stores).toHaveLength(2);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('preserves and projects depth-map saves onto the side-view scene', () => {
    const fresh = createNewWorld();
    const depthSave = {
      ...fresh,
      mapVersion: 2,
      woodSource: 17,
      stoneSource: 21,
      residents: [
        { ...fresh.residents[0]!, x: 812, y: 980, role: 'builder' as const, targetX: 590, targetY: 1050 },
        ...fresh.residents.slice(1)
      ],
      stores: [{ id: 'store-1', x: 812, y: 860, wood: 4, stone: 3, capacity: 12 }],
      buildings: [{ id: 'house-1', kind: 'house' as const, x: 638, y: 1050 }],
      sites: [{
        id: 'site-2', kind: 'warehouse' as const, x: 1032, y: 720,
        deliveredWood: 2, deliveredStone: 1, progress: 0.4, stage: 1
      }],
      occupiedPlots: [1, 2]
    };
    const loaded = parseSavedWorld(JSON.stringify(depthSave));

    expect(loaded).not.toBeNull();
    expect(loaded?.mapVersion).toBe(1);
    expect(loaded?.woodSource).toBe(17);
    expect(loaded?.stoneSource).toBe(21);
    expect(loaded?.residents).toHaveLength(3);
    expect(loaded?.residents[0]).toMatchObject({
      x: 936, y: WORLD.groundY, role: 'builder', targetX: 680, targetY: WORLD.groundY
    });
    expect(loaded?.stores[0]).toEqual({ id: 'store-1', x: 936, wood: 4, stone: 3, capacity: 12 });
    expect(loaded?.buildings[0]).toMatchObject({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    expect(loaded?.sites[0]).toMatchObject({
      id: 'site-2', kind: 'warehouse', x: 1240, y: WORLD.groundY,
      deliveredWood: 2, deliveredStone: 1, progress: 0.4, stage: 1
    });
    expect(loaded?.occupiedPlots).toEqual([1, 2]);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('does not reinterpret legacy depth-map plot IDs as the new eastern build plots', () => {
    const legacy = createNewWorld();
    legacy.mapVersion = 2;
    legacy.buildings = [{ id: 'old-depth-house', kind: 'house', x: 600, y: 1380 }];
    legacy.sites = [{
      id: 'old-depth-site', kind: 'warehouse', x: 850, y: 1450,
      deliveredWood: 1, deliveredStone: 0, progress: 0, stage: 0
    }];
    legacy.occupiedPlots = [4, 5];

    const migrated = parseSavedWorld(JSON.stringify(legacy));
    expect(migrated).not.toBeNull();
    expect(migrated?.buildings[0]?.x).toBe(692);
    expect(migrated?.sites[0]?.x).toBe(980);
    expect(migrated?.occupiedPlots).toEqual([1]);
    migrated!.easternSector.state = 'prepared';
    migrated!.easternSector.clearingProgress = 1;
    expect(new PrototypeSimulation(migrated!).isPlotAvailable(4)).toBe(true);
  });

  it('migrates an original side-view save once while preserving state and save identity', () => {
    const original = createNewWorld();
    delete original.mapVersion;
    original.residents.forEach((person, index) => {
      person.x = [475, 535, 595][index]!;
    });
    original.residents[0]!.x = 475;
    original.residents[0]!.targetX = 130;
    original.stores[0]!.x = 535;
    original.buildings = [{ id: 'house-1', kind: 'house', x: 420, y: 414 }];
    original.occupiedPlots = [1];

    const loaded = parseSavedWorld(JSON.stringify(original));
    expect(loaded?.mapVersion).toBe(1);
    expect(loaded?.residents).toHaveLength(3);
    expect(loaded?.residents[0]).toMatchObject({ x: 855, targetX: 234, y: WORLD.groundY });
    expect(loaded?.stores[0]).toMatchObject({ x: 963 });
    expect(loaded?.buildings[0]).toMatchObject({ id: 'house-1', x: 690, y: WORLD.groundY });
    expect(loaded?.occupiedPlots).toEqual([1]);
    expect(parseSavedWorld(JSON.stringify(loaded))?.residents[0]?.x).toBe(855);
    expect(STORAGE_KEY).toBe('avanpost:gameplay-prototype:v01');
  });

  it('rejects malformed or foreign saves instead of replacing the new-game state', () => {
    expect(parseSavedWorld(null)).toBeNull();
    expect(parseSavedWorld('{')).toBeNull();
    expect(parseSavedWorld(JSON.stringify({ version: 2, residents: [], stores: [], buildings: [], sites: [] }))).toBeNull();
  });

  it('keeps the eastern plots unavailable until the sector is both opened and prepared', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.world.easternSector.state).toBe('closed');
    expect(simulation.isPlotAvailable(4)).toBe(false);
    expect(simulation.place('house', 4)).toMatchObject({ ok: false, reason: 'Восточная опушка закрыта.' });

    simulation.world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    simulation.world.easternSector.state = 'unlocked';
    expect(simulation.isPlotAvailable(4)).toBe(false);
    expect(simulation.place('warehouse', 4)).toMatchObject({
      ok: false, reason: 'Сначала физически подготовь землю на Восточной опушке.'
    });

    simulation.world.easternSector.state = 'prepared';
    simulation.world.easternSector.clearingProgress = 1;
    expect(simulation.isPlotAvailable(4)).toBe(true);
    expect(simulation.isPlotAvailable(5)).toBe(true);
    expect(simulation.place('house', 4)).toEqual({ ok: true });
  });

  it('unlocks the eastern sector only after a house and atomically spends stored resources', () => {
    const world = createNewWorld();
    const simulation = new PrototypeSimulation(world);
    const before = simulation.totals();
    expect(simulation.unlockEasternSector()).toMatchObject({ ok: false, reason: 'Сначала построй первый дом.' });
    expect(simulation.totals()).toMatchObject({ wood: before.wood, stone: before.stone });

    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.stores = [
      { id: 'store-1', x: 963, wood: 7, stone: 4, capacity: 12 },
      { id: 'store-2', x: 1590, wood: 1, stone: 1, capacity: 12 }
    ];
    expect(simulation.unlockEasternSector()).toEqual({ ok: true });
    expect(world.easternSector.state).toBe('unlocked');
    expect(simulation.totals()).toMatchObject({ wood: 0, stone: 0 });
    expect(world.stores.every((store) => store.wood >= 0 && store.stone >= 0)).toBe(true);
    expect(world.currentGoal).toBe('prepare-eastern-sector');
  });

  it('sends a real worker to clearing, pauses without losing progress, then resumes to prepared', () => {
    const world = createNewWorld();
    world.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    world.easternSector.state = 'unlocked';
    world.residents[2]!.role = 'builder';
    const simulation = new PrototypeSimulation(world);

    expect(simulation.startEasternClearing()).toEqual({ ok: true });
    expect(world.easternSector.state).toBe('clearing');
    expect(world.easternSector.clearerId).toBe('r3');
    run(simulation, 4);
    expect(world.residents[2]!.x).toBeGreaterThan(1180);
    expect(world.residents[2]!.x).toBeLessThan(PROTOTYPE_CONFIG.easternSector.clearingX);
    expect(world.easternSector.clearingProgress).toBe(0);
    run(simulation, 6);
    expect(world.easternSector.clearingProgress).toBeGreaterThan(0);

    const savedProgress = world.easternSector.clearingProgress;
    simulation.assign('r3', 'woodcutter');
    expect(world.easternSector.clearingPaused).toBe(true);
    run(simulation, 8);
    expect(world.easternSector.clearingProgress).toBe(savedProgress);

    simulation.assign('r3', 'idle');
    expect(simulation.startEasternClearing()).toEqual({ ok: true });
    run(simulation, PROTOTYPE_CONFIG.easternSector.clearingWorkSeconds + 12);
    expect(world.easternSector.state).toBe('prepared');
    expect(world.easternSector.clearingProgress).toBe(1);
    expect(world.easternSector.clearerId).toBeNull();
  });

  it('walks to the new forest and carries harvested wood back to the existing warehouse', () => {
    const world = createNewWorld();
    world.easternSector.state = 'prepared';
    world.easternSector.clearingProgress = 1;
    const beforeWood = world.stores[0]!.wood;
    const beforeForest = world.easternSector.woodStock;
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');
    expect(simulation.setWoodSource('r1', 'eastern')).toEqual({ ok: true });

    run(simulation, 1);
    expect(world.residents[0]!.x).toBeGreaterThan(640);
    expect(world.easternSector.woodStock).toBe(beforeForest);
    run(simulation, 24);

    expect(world.easternSector.woodStock).toBeLessThan(beforeForest);
    expect(world.residents[0]!.cargo).toBe('wood');
    expect(world.stores[0]!.wood).toBe(beforeWood);
    run(simulation, 20);
    expect(world.stores[0]!.wood).toBeGreaterThan(beforeWood);
  });

  it('retains cargo when every warehouse is full and slowly restores baseline sources', () => {
    const world = createNewWorld();
    world.easternSector.state = 'prepared';
    world.easternSector.woodStock = 1;
    world.stores = [{ id: 'store-1', x: 963, wood: 7, stone: 5, capacity: 12 }];
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'woodcutter');
    simulation.setWoodSource('r1', 'eastern');
    run(simulation, 24);
    expect(world.residents[0]!.cargo).toBe('wood');
    expect(world.residents[0]!.mode).toBe('blocked');
    expect(world.easternSector.woodStock).toBe(0);
    expect(simulation.totals().stored).toBe(12);

    world.woodSource = 0;
    world.stoneSource = 0;
    world.easternSector.woodStock = 0;
    run(simulation, 242);
    expect(world.woodSource).toBeGreaterThan(0);
    expect(world.stoneSource).toBeGreaterThan(0);
    expect(world.easternSector.woodStock).toBeGreaterThan(0);
  });

  it('migrates pre-sector saves while preserving settlement and clearing progress on newer saves', () => {
    const oldSave = createNewWorld();
    oldSave.buildings.push({ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY });
    oldSave.stores.push({ id: 'store-2', x: 1590, wood: 2, stone: 1, capacity: 12 });
    delete (oldSave as Partial<typeof oldSave>).easternSector;
    delete (oldSave as Partial<typeof oldSave>).currentGoal;
    delete (oldSave as Partial<typeof oldSave>).woodSourceRecoverySeconds;
    delete (oldSave as Partial<typeof oldSave>).stoneSourceRecoverySeconds;
    delete (oldSave.residents[0] as Partial<(typeof oldSave.residents)[number]>).woodSource;

    const migrated = parseSavedWorld(JSON.stringify(oldSave));
    expect(migrated).not.toBeNull();
    expect(migrated).toMatchObject({
      easternSector: { state: 'closed', clearingProgress: 0, clearerId: null },
      currentGoal: 'unlock-eastern-sector',
      buildings: [{ id: 'house-1', kind: 'house', x: 690, y: WORLD.groundY }],
      stores: [{ id: 'store-1' }, { id: 'store-2' }]
    });
    expect(migrated?.residents[0]?.woodSource).toBe('home');

    migrated!.easternSector.state = 'clearing';
    migrated!.easternSector.clearingProgress = 0.42;
    migrated!.easternSector.clearingPaused = true;
    migrated!.easternSector.clearerId = 'r3';
    const restored = parseSavedWorld(JSON.stringify(migrated));
    expect(restored?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: 'r3'
    });
    const orphaned = parseSavedWorld(JSON.stringify({
      ...migrated,
      easternSector: {
        ...migrated!.easternSector,
        clearerId: 'missing-resident',
        clearingPaused: false
      }
    }));
    expect(orphaned?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: null
    });

    const reassigned = parseSavedWorld(JSON.stringify({
      ...migrated,
      residents: migrated!.residents.map((person, index) => index === 2
        ? { ...person, role: 'woodcutter' as const, cargo: null }
        : person),
      easternSector: {
        ...migrated!.easternSector,
        clearerId: 'r3',
        clearingPaused: false
      }
    }));
    expect(reassigned?.easternSector).toMatchObject({
      state: 'clearing', clearingProgress: 0.42, clearingPaused: true, clearerId: 'r3'
    });
  });
});
