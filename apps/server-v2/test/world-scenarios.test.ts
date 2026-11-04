import { describe, expect, it } from 'vitest';
import { PeaceWorldSnapshotSchema } from '@avanpost/peace-v2-shared';
import {
   advanceSettlement, canSafelyRelocateLadder, createLadder, demolishLadder, findSurfacePath, generatedGeology, isUndergroundTunnel,
    isSupportedUndergroundPosition, ensureUndergroundDepth, undergroundConnectionMask, undergroundFloorLine, undergroundGeologyTileForCell, undergroundTileForMask,
   undergroundWorkPoint, previewUndergroundRoute, queueUndergroundRoute, cancelUndergroundRoute, queueUndergroundMining, queueExcavation, scheduleWorkOrders,
   validateBuildingLayout
} from '@avanpost/peace-v2-sim';
import {
  createWorldScenario,
  listWorldScenarios,
  WORLD_SCENARIO_DESCRIPTIONS
} from '../src/testing/world-scenarios.js';

describe('isolated world scenario catalog', () => {
  it.each(listWorldScenarios())('creates repeatable, schema-valid %s worlds', (name) => {
    const first = createWorldScenario(name);
    const second = createWorldScenario(name);
    expect(PeaceWorldSnapshotSchema.safeParse(first).success).toBe(true);
    expect(second).toEqual(first);
    expect(first.residents.length).toBeGreaterThanOrEqual(2);
    expect(first.trees.length).toBeGreaterThan(0);
    expect(first.stoneDeposits.length).toBeGreaterThan(0);
    expect(WORLD_SCENARIO_DESCRIPTIONS[name].length).toBeGreaterThan(10);
  });

  it('provides the G7.1 housing loop with a ready home, a second build site, and distinct work roles', () => {
    const world = createWorldScenario('g7-population-housing');
    expect(world.buildings.filter((building) => building.kind === 'cabin' && building.state === 'complete')).toHaveLength(1);
    expect(world.buildings.filter((building) => building.kind === 'cabin' && building.state !== 'complete')).toHaveLength(1);
    expect(world.residents.map((resident) => resident.workRole)).toEqual(['builder', 'hauler', 'woodcutter']);
    expect(world.surfaceCells.some((cell) => cell.walkable && cell.sectorId === 'sector-0-0')).toBe(true);
  });

  it('provides a fresh G7.2 settlement with no pre-trained residents and resources for the full school chain', () => {
    const world = createWorldScenario('g7-schools-alchemy');
    expect(world.buildings).toHaveLength(0);
    expect(world.residents).toHaveLength(3);
    expect(world.residents.every((resident) => resident.civilianProfession === 'general_worker' && resident.learningHistory.length === 0)).toBe(true);
    expect(world.residents.map((resident) => resident.workRole)).toEqual(['builder', 'hauler', 'none']);
    expect(world.resources).toEqual({ wood: 70, stone: 30 });
    expect(world.surfaceCells.filter((cell) => cell.walkable && cell.supportsBuilding).length).toBeGreaterThanOrEqual(20);
  });

  it('keeps owned-sector geology mineable and gives the acceptance cell ordinary clay', () => {
    for (let x = -24; x <= 24; x += 1) {
      for (let y = 1; y <= 24; y += 1) expect(generatedGeology('mineable-world', x, y)).not.toBe('bedrock');
    }
    const world = createWorldScenario('g6-underground-visual-acceptance');
    expect(world.undergroundCells.find((cell) => cell.position.x === 1 && cell.position.y === 2))
      .toMatchObject({ geology: 'clay', revealed: true });
    expect(queueExcavation(world, [{ x: 1, y: 2 }]).ok).toBe(true);
  });

  it('extends generated geology below the original map depth without adding impassable cells', () => {
    const world = createWorldScenario('g6-underground-visual-acceptance');
    ensureUndergroundDepth(world, 25);
    const deepRow = world.undergroundCells.filter((cell) => cell.position.y === 25);
    expect(deepRow.length).toBeGreaterThan(0);
    expect(deepRow.every((cell) => cell.geology !== 'bedrock')).toBe(true);
  });

  it('generates coordinate-stable geology and carries a resident through the real ladder edge', () => {
    const world = createWorldScenario('g6-underground-excavation');
    expect(generatedGeology('stable-seed', 24, 7)).toBe(generatedGeology('stable-seed', 24, 7));
    expect(generatedGeology('stable-seed', 24, 7)).not.toBe(generatedGeology('different-seed', 24, 7));
    expect(isUndergroundTunnel(world, { x: 0, y: 1 })).toBe(true);
    const ladder = world.ladders[0]!;
    expect(PeaceWorldSnapshotSchema.safeParse(world).success).toBe(true);
    expect(canSafelyRelocateLadder(world, ladder.id)).toBe(false);
    expect(canSafelyRelocateLadder(world, 'g6-spare-shaft')).toBe(true);
    expect(findSurfacePath(world, { x: -2, y: 0 }, { x: 0, y: 1 }))
      .toEqual(expect.arrayContaining([{ x: 0, y: 1 }]));
    const occupied = structuredClone(world);
    occupied.residents[0]!.position = { x: 0, y: 1 };
    expect(demolishLadder(occupied, ladder.id)).toMatchObject({ ok: false, reason: 'LADDER_IN_USE' });
    expect(occupied.ladders[0]?.state).toBe('complete');
  });

  it('builds a ladder on a deep tunnel as one adjacent vertical segment by default', () => {
    const world = createWorldScenario('g6-underground-excavation');
    for (const position of [{ x: 1, y: 1 }, { x: 1, y: 2 }]) {
      const cell = world.undergroundCells.find((candidate) =>
        candidate.position.x === position.x && candidate.position.y === position.y)!;
      cell.state = 'tunnel';
      cell.revealed = true;
      cell.floorSupported = true;
    }

    const result = createLadder(world, 1, 2);

    expect(result).toMatchObject({ ok: true, value: { top: { x: 1, y: 1 }, bottom: { x: 1, y: 2 } } });
    expect(PeaceWorldSnapshotSchema.safeParse(world).success).toBe(true);
  });

  it('treats tunnel clearance without a supported floor as non-walkable and not a ladder endpoint', () => {
    const world = createWorldScenario('g6-underground-excavation');
    const clearance = world.undergroundCells.find((item) => item.position.x === 1 && item.position.y === 1)!;
    clearance.state = 'tunnel';
    clearance.floorSupported = false;
    clearance.revealed = true;

    expect(isSupportedUndergroundPosition(world, clearance.position)).toBe(false);
    expect(findSurfacePath(world, { x: 0, y: 1 }, clearance.position)).toBeNull();
    expect(createLadder(world, 1, 1, undefined, 0)).toMatchObject({ ok: false, reason: 'DEPOSIT_NOT_ACCESSED' });
    const unsupportedTopWorld = structuredClone(world);
    unsupportedTopWorld.ladders = unsupportedTopWorld.ladders.filter((ladder) => ladder.id !== 'g6-deep-shaft');
    unsupportedTopWorld.undergroundCells.find((item) => item.position.x === 0 && item.position.y === 1)!.floorSupported = false;
    expect(createLadder(unsupportedTopWorld, 0, 2, undefined, 1)).toMatchObject({ ok: false, reason: 'CELL_NOT_CONNECTED' });
    expect(undergroundConnectionMask(clearance, new Map(world.undergroundCells.map((cell) =>
      [`${cell.position.x},${cell.position.y}`, cell])), world.ladders)).toBe(0);

    const unsupportedLadder = structuredClone(world);
    unsupportedLadder.ladders[0]!.bottom = { ...clearance.position };
    expect(PeaceWorldSnapshotSchema.safeParse(unsupportedLadder).success).toBe(false);
    expect(previewUndergroundRoute(world, 'g6-stone-seam').ok).toBe(true);
    const preview = previewUndergroundRoute(world, 'g6-stone-seam');
    if (preview.ok) expect(preview.value.path).not.toContainEqual(clearance.position);
  });

  it('does not use clearance-only cells as underground workpoints', () => {
    const world = createWorldScenario('g6-underground-excavation');
    const target = { x: 10, y: 10 };
    for (const point of [{ x: 10, y: 9 }, { x: 9, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }]) {
      const cell = world.undergroundCells.find((item) => item.position.x === point.x && item.position.y === point.y)!;
      cell.state = 'tunnel';
      cell.floorSupported = false;
    }
    expect(undergroundWorkPoint(world, target)).toBeNull();
  });

  it('previews and sequentially executes a deep route, mines from an adjacent tunnel, and hauls stone', () => {
    const world = createWorldScenario('g6-underground-excavation');
    const preview = previewUndergroundRoute(world, 'g6-stone-seam');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'excavate', position: { x: 1, y: 2 } }),
      expect.objectContaining({ kind: 'excavate', position: { x: 2, y: 2 } })
    ]));
    expect(queueUndergroundRoute(world, 'g6-stone-seam').ok).toBe(true);
    expect(queueUndergroundRoute(world, 'g6-stone-seam')).toMatchObject({ ok: false, reason: 'DUPLICATE_JOB' });
    let current = world;
    for (let tick = 0; tick < 180; tick += 1) {
      current = advanceSettlement(current, 1);
    }
    expect(isUndergroundTunnel(current, { x: 2, y: 2 })).toBe(true);
    expect(current.ladders.find((item) => item.id === 'g6-spare-shaft'))
      .toMatchObject({ top: { x: -1, y: 1 }, bottom: { x: -1, y: 2 }, state: 'complete' });
    expect(current.storages![0]!.contents.wood).toBe(12);
    const deposit = current.undergroundDeposits.find((item) => item.id === 'g6-stone-seam')!;
    const mining = queueUndergroundMining(current, deposit.id);
    expect(mining.ok).toBe(true);
    current = advanceSettlement(current, 10);
    expect(current.undergroundDeposits.find((item) => item.id === deposit.id)?.remaining).toBeLessThan(12);
    for (let index = 0; index < 30 && current.undergroundDeposits.find((item) => item.id === deposit.id)?.remaining; index += 1) {
      queueUndergroundMining(current, deposit.id);
      current = advanceSettlement(current, 12);
    }
    expect(current.undergroundDeposits.find((item) => item.id === deposit.id))
      .toMatchObject({ remaining: 0, state: 'depleted' });
    expect(queueUndergroundMining(current, deposit.id).ok).toBe(false);
  }, 30_000);

  it('requires an explicit supported floor for horizontal standing and uses ladders only as vertical links', () => {
    const world = createWorldScenario('g6-underground-excavation');
    const upper = world.undergroundCells.find((item) => item.position.x === 0 && item.position.y === 1)!;
    upper.floorSupported = false;
    expect(isSupportedUndergroundPosition(world, upper.position)).toBe(false);
    world.ladders = world.ladders.filter((ladder) => !['g6-upper-shaft', 'g6-deep-shaft', 'g6-spare-shaft'].includes(ladder.id));
    expect(findSurfacePath(world, upper.position, { x: 0, y: 0 })).toBeNull();
    expect(findSurfacePath(world, upper.position, { x: -1, y: 1 })).toBeNull();
    expect(PeaceWorldSnapshotSchema.safeParse(world).success).toBe(true);
  });

  it('autotiles only real horizontal tunnels and complete vertical ladder connections', () => {
    const world = createWorldScenario('g6-underground-excavation');
    const at = (x: number, y: number) => world.undergroundCells.find((cell) => cell.position.x === x && cell.position.y === y)!;
    at(1, 1).state = 'tunnel';
    at(-1, 1).state = 'solid';
    at(0, 2).state = 'tunnel';
    const cells = new Map(world.undergroundCells.map((cell) => [`${cell.position.x},${cell.position.y}`, cell]));
    expect(undergroundConnectionMask(at(0, 1), cells, world.ladders)).toBe(7);
    world.ladders.find((ladder) => ladder.id === 'g6-deep-shaft')!.state = 'relocating';
    expect(undergroundConnectionMask(at(0, 1), cells, world.ladders)).toBe(3);
    at(1, 1).floorSupported = false;
    expect(undergroundConnectionMask(at(0, 1), cells, world.ladders)).toBe(1);
    const tunnelFrames = Array.from({ length: 16 }, (_, mask) => undergroundTileForMask(mask).frame);
    expect(tunnelFrames.every((frame) => frame >= 4 && frame <= 14)).toBe(true);
    expect(undergroundTileForMask(2)).toMatchObject({ frame: 5, flipX: false, flipY: false });
    expect(undergroundTileForMask(8)).toMatchObject({ frame: 6, flipX: false, flipY: false });
    expect(undergroundFloorLine(48, 48)).toBe(95);
    expect(undergroundFloorLine(48, 48) - 48).toBeGreaterThanOrEqual(46);
    const tileA = undergroundGeologyTileForCell('clay', { x: -4, y: 9 }, 'stable-seed');
    expect(tileA).toEqual(undergroundGeologyTileForCell('clay', { x: -4, y: 9 }, 'stable-seed'));
    expect(tileA.frame).toBe(1);
    expect(undergroundGeologyTileForCell('stone', { x: -4, y: 9 }, 'stable-seed').frame).toBe(2);
  });

  it('steps through two vertical ladder edges once and recalculates from the current cell without rewinding', () => {
    let current = createWorldScenario('g6-underground-excavation');
    const cell = (x: number, y: number) => current.undergroundCells.find((item) => item.position.x === x && item.position.y === y)!;
    current.residents.find((resident) => resident.id === 'worker-1')!.position = { x: 0, y: 0 };
    for (const point of [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }]) {
      cell(point.x, point.y).state = 'tunnel';
      cell(point.x, point.y).revealed = true;
    }
    current.ladders.push({ id: 'g6-second-shaft', top: { x: 0, y: 1 }, bottom: { x: 0, y: 2 }, state: 'complete',
      assignedResidentId: null, requiredWood: 2, deliveredWood: 2, reservedWood: 0, progressTicks: 4,
      progressRequired: 4, blockedReason: null, planId: null });
    const reversePath = findSurfacePath(current, { x: 0, y: 2 }, { x: 0, y: 0 });
    expect(reversePath).toEqual([{ x: 0, y: 1 }, { x: 0, y: 0 }]);

    const queued = queueUndergroundMining(current, 'g6-stone-seam');
    expect(queued.ok).toBe(true);
    const getWorker = () => current.residents.find((resident) => resident.id === 'worker-1')!;
    const movementTrace: Array<Record<string, unknown>> = [];
    let previousTaskId = '';
    let previousPath = '';
    const recordTick = () => {
      const worker = getWorker();
      const task = worker.task;
      const path = task?.path.map((point) => `${point.x},${point.y}`).join(';') ?? '';
      const job = task?.kind === 'underground-work'
        ? current.undergroundJobs.find((candidate) => candidate.id === task.jobId) : undefined;
      const ladder = current.ladders.find((candidate) => candidate.top.x === worker.position.x &&
        worker.position.y >= candidate.top.y && worker.position.y <= candidate.bottom.y);
      movementTrace.push({ serverTick: current.revision.serverTick, workerId: worker.id, state: worker.state,
        visualState: worker.visualState, position: worker.position, currentCell: worker.position,
        nextCell: task?.path[task.pathIndex] ?? null, destination: task?.path.at(-1) ?? null,
        workTarget: task?.kind === 'underground-work' ? task.target : null, taskId: task?.id ?? null,
        taskKind: task?.kind ?? null, taskPhase: task?.phase ?? null, path: task?.path ?? [],
        pathIndex: task?.pathIndex ?? null, taskBlockedReason: task?.blockedReason ?? null,
        pathRecalculated: Boolean(task && task.id === previousTaskId && path !== previousPath),
        job: job ? { id: job.id, status: job.status, target: job.target, blockedReason: job.blockedReason } : null,
        ladder: ladder ? { id: ladder.id, state: ladder.state, blockedReason: ladder.blockedReason } : null,
        ladders: current.ladders.map(({ id, top, bottom, state, blockedReason }) =>
          ({ id, top, bottom, state, blockedReason })) });
      previousTaskId = task?.id ?? '';
      previousPath = path;
    };
    expect(getWorker().task).toMatchObject({ kind: 'underground-work', path: [
      { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }
    ], pathIndex: 0 });

    current = advanceSettlement(current, 1);
    recordTick();
    expect(getWorker()).toMatchObject({ position: { x: 0, y: 1 }, task: { pathIndex: 1 } });
    const task = getWorker().task;
    expect(task?.kind).toBe('underground-work');
    if (task?.kind !== 'underground-work') return;

    // A snapshot/reload with no world change must preserve the in-flight route and progress.
    current = structuredClone(current);
    current = advanceSettlement(current, 1);
    recordTick();
    expect(getWorker()).toMatchObject({ position: { x: 0, y: 2 }, task: { pathIndex: 2 } });

    // Exercise the legitimate waiting_path retry: the new path starts at the worker's confirmed cell.
    const activeTask = getWorker().task;
    expect(activeTask?.kind).toBe('underground-work');
    if (activeTask?.kind !== 'underground-work') return;
    expect(findSurfacePath(current, { x: 0, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 1, y: 2 }, { x: 2, y: 2 }]);
    activeTask.phase = 'waiting_path';
    current.undergroundJobs.find((job) => job.id === activeTask.jobId)!.status = 'waiting_path';
    current = advanceSettlement(current, 1);
    recordTick();
    expect(getWorker()).toMatchObject({ position: { x: 0, y: 2 }, task: {
      kind: 'underground-work', phase: 'walking_to_worksite', pathIndex: 0,
      path: [{ x: 1, y: 2 }, { x: 2, y: 2 }]
    } });
    current = advanceSettlement(current, 1);
    recordTick();
    expect(getWorker()).toMatchObject({ position: { x: 1, y: 2 }, task: { pathIndex: 1 } });
    expect(current.undergroundJobs.find((job) => job.kind === 'mine' && job.depositId === 'g6-stone-seam'))
      .toMatchObject({ status: 'in_progress', blockedReason: null });
    while (movementTrace.length < 40) {
      current = advanceSettlement(current, 1);
      recordTick();
    }
    expect(movementTrace).toHaveLength(40);
    for (let index = 1; index < movementTrace.length; index += 1) {
      expect(movementTrace[index]!.serverTick).toBe((movementTrace[index - 1]!.serverTick as number) + 1);
    }
    expect(movementTrace.filter((row) => row.pathRecalculated)).toHaveLength(1);
    expect(movementTrace[0]!.position).toEqual({ x: 0, y: 1 });
    expect(movementTrace[1]!.position).toEqual({ x: 0, y: 2 });
    expect(movementTrace[2]!.position).toEqual({ x: 0, y: 2 });
    expect(movementTrace[3]!.position).toEqual({ x: 1, y: 2 });
  });

  it('charges once for each deeper level and cancellation preserves completed excavation', () => {
    const deep = createWorldScenario('g6-underground-excavation');
    deep.undergroundCells.find((cell) => cell.position.x === 0 && cell.position.y === 3)!.state = 'tunnel';
    deep.undergroundCells.find((cell) => cell.position.x === 0 && cell.position.y === 4)!.state = 'tunnel';
    deep.ladders.push({ id: 'test-mid-shaft', top: { x: 0, y: 2 }, bottom: { x: 0, y: 3 }, state: 'complete',
      assignedResidentId: null, requiredWood: 2, deliveredWood: 2, reservedWood: 0, progressTicks: 4,
      progressRequired: 4, blockedReason: null, planId: null });
    deep.ladders.push({ id: 'test-deep-shaft', top: { x: 0, y: 3 }, bottom: { x: 0, y: 4 }, state: 'complete',
      assignedResidentId: null, requiredWood: 2, deliveredWood: 2, reservedWood: 0, progressTicks: 4,
      progressRequired: 4, blockedReason: null, planId: null });
    deep.storages![0]!.contents.wood = 0;
    deep.storages![0]!.contents.stone = 0;
    deep.storages![0]!.reservedOutbound.wood = 0;
    deep.storages![0]!.reservedOutbound.stone = 0;
    deep.resources = { wood: 0, stone: 0 };
    expect(queueExcavation(deep, [{ x: 1, y: 4 }])).toMatchObject({ ok: false, reason: 'INSUFFICIENT_MATERIALS' });
    deep.storages![0]!.contents = { wood: 20, stone: 10 };
    deep.resources = { wood: 20, stone: 10 };
    const deepExcavation = queueExcavation(deep, [{ x: 1, y: 4 }]);
    if (!deepExcavation.ok) throw new Error(`Deeper excavation unexpectedly failed: ${deepExcavation.reason}`);
    expect(deep).toMatchObject({ undergroundUnlockedDepth: 4, resources: { wood: 0, stone: 0 } });

    const cancelled = createWorldScenario('g6-underground-excavation');
    const queued = queueUndergroundRoute(cancelled, 'g6-stone-seam');
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const partial = advanceSettlement(cancelled, 8);
    const result = cancelUndergroundRoute(partial, queued.value.id);
    expect(result).toMatchObject({ ok: true, value: { state: 'cancelled' } });
    expect(isUndergroundTunnel(partial, { x: 1, y: 2 })).toBe(true);
    expect(partial.undergroundPlans[0]?.currentStep).toBeGreaterThan(0);
  });

  it('contains every requested scenario with valid construction cross-links and reservations', () => {
    expect(listWorldScenarios()).toEqual([
      'empty', 'basic', 'resources-full', 'lumberjack', 'stone-mining', 'construction', 'construction-role-transition',
       'construction-blocked', 'logistics-deadlock', 'multi-worker', 'g4-multi-storage', 'g4-logistics-priority',
       'g5-construction-layout', 'g5-support-invalid', 'g5-route-blocked', 'g5-logistics-blocked',
        'g5-demolition-cleanup', 'g6-sector-expansion', 'g6-build-workpoint', 'g6-two-houses',
        'g6-underground-excavation', 'g6-underground-visual-acceptance', 'g7-population-housing', 'g7-schools-alchemy', 'late-settlement'
    ]);
    for (const name of listWorldScenarios()) {
      const world = createWorldScenario(name);
      for (const order of world.buildOrders) {
        const building = world.buildings.find((candidate) => candidate.id === order.buildingId);
        expect(building?.orderId).toBe(order.id);
        expect(building!.reservedWood).toBeGreaterThanOrEqual(0);
        expect(building!.reservedStone).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('models role dispatch, blocked materials, logistics cargo, and a late settlement distinctly', () => {
    const construction = createWorldScenario('construction');
    expect(construction.residents.some((resident) => resident.workRole === 'builder')).toBe(true);
    expect(construction.buildOrders).toHaveLength(2);

    const blocked = createWorldScenario('construction-blocked');
    expect(blocked.buildOrders[0]).toMatchObject({ status: 'waiting_materials', blockedReason: 'INSUFFICIENT_WOOD' });

    const logistics = createWorldScenario('logistics-deadlock');
    expect(logistics.residents.some((resident) => resident.cargoItemId === 'wood' && resident.cargo > 0)).toBe(true);
    expect(logistics.residents.some((resident) => resident.cargoItemId === 'stone' && resident.cargo > 0)).toBe(true);

    const late = createWorldScenario('late-settlement');
    expect(late.buildings.filter((building) => building.kind === 'cabin')).toHaveLength(3);
    expect(late.buildings.filter((building) => building.kind === 'workshop')).toHaveLength(1);
    expect(late.buildOrders.every((order) => order.status === 'completed')).toBe(true);

    const distributed = createWorldScenario('g4-multi-storage');
    expect(distributed.storages).toHaveLength(2);
    expect(distributed.residents.map((resident) => resident.workRole).sort())
      .toEqual(['builder', 'hauler', 'stone_miner', 'woodcutter'].sort());
    expect(distributed.residents.find((resident) => resident.workRole === 'builder'))
      .toMatchObject({ cargo: 1, cargoItemId: 'wood', task: { kind: 'gather-wood', phase: 'waiting_storage' } });
    expect(distributed.storages?.map((storage) => storage.contents.wood)).toEqual([16, 0]);
    expect(distributed.stoneDeposits[0]?.bufferQuantity).toBe(6);
    expect(distributed.trees.find((tree) => tree.id === 'tree-3')).toMatchObject({ bufferQuantity: 3, bufferCapacity: 3 });
    expect(distributed.buildOrders).toHaveLength(1);
    expect(distributed.buildOrders[0]).toMatchObject({ status: 'waiting_materials', blockedReason: 'INSUFFICIENT_STONE' });

    const priorityLogistics = createWorldScenario('g4-logistics-priority');
    expect(priorityLogistics.residents.filter((resident) => resident.workRole === 'hauler')).toHaveLength(2);
    expect(priorityLogistics.logisticsPolicy.carryCapacity).toBe(3);
    const priorityOrders = [...priorityLogistics.buildOrders].sort((a, b) => a.queuePosition - b.queuePosition);
    expect(priorityOrders.map((order) => order.queuePosition)).toEqual([0, 1]);
    expect(priorityOrders.map((order) => order.status)).toEqual(['waiting_builder', 'waiting_materials']);

    expect(scheduleWorkOrders(priorityLogistics)).toBe(true);
    const assignedHaulers = priorityLogistics.residents.filter((resident) => resident.workRole === 'hauler');
    expect(assignedHaulers.every((resident) => resident.task?.kind === 'haul')).toBe(true);
    expect(new Set(assignedHaulers.map((resident) => resident.task?.kind === 'haul' ? resident.task.sourceId : '')).size).toBe(2);
    expect(priorityLogistics.logisticsTasks.filter((task) => task.assignedResidentId)).toHaveLength(2);
    expect(priorityLogistics.logisticsTasks.filter((task) => task.assignedResidentId).map((task) => task.kind).sort())
      .toEqual(['buffer_clearance', 'warehouse_restock'].sort());
    expect(PeaceWorldSnapshotSchema.safeParse(priorityLogistics).success).toBe(true);
  });

  it('prepares an isolated no-stock builder/hauler/woodcutter flow for the G6 work-point regression', () => {
    const scenario = createWorldScenario('g6-build-workpoint');
    expect(scenario.resources).toEqual({ wood: 0, stone: 0 });
    expect(scenario.residents.map((resident) => resident.workRole).sort())
      .toEqual(['builder', 'builder', 'hauler', 'woodcutter'].sort());
    expect(scenario.trees.find((tree) => tree.id === 'tree-1')?.remaining).toBe(3);
    expect(scenario.buildings).toHaveLength(0);
  });

  it('rejects unknown scenario names rather than silently falling back to a default', () => {
    expect(() => createWorldScenario('dev')).toThrow('Unknown isolated-world scenario: dev');
  });

  it('seeds G5 geometry and verifies that ordinary buildings do not block an active haul route', () => {
    const world = createWorldScenario('g5-construction-layout');
    expect(world.surfaceCells).toHaveLength(68);
    expect(world.surfaceCells.filter((cell) => cell.visualFeature === 'narrow-passage')).toHaveLength(9);
    expect(world.surfaceCells.filter((cell) => cell.visualFeature === 'unstable-ground')).toHaveLength(2);
    expect(world.buildings.map((building) => building.state)).toEqual(['complete', 'complete']);
    expect(world.nextBuildOrderSequence).toBe(3);
    expect(world.storages).toHaveLength(2);
    expect(world.residents[1]?.task).toMatchObject({ kind: 'haul', phase: 'carrying', destinationId: 'storehouse-2' });
    expect(world.residents[1]?.task?.path.length).toBeGreaterThan(20);
    expect(world.residents[1]?.task?.path.some((cell) => cell.x >= 12 && cell.x <= 20 && cell.y === 0)).toBe(true);
    const demolitionWorld = createWorldScenario('g5-demolition-cleanup');
    expect(demolitionWorld.residents[1]).toMatchObject({ cargo: 0, workRole: 'none', task: null });
    expect(demolitionWorld.storages?.[1]?.reservedInbound.wood).toBe(0);
    const blockedDelivery = createWorldScenario('g5-logistics-blocked');
    expect(blockedDelivery.buildOrders.at(-1)).toMatchObject({ status: 'waiting_materials', blockedReason: 'NO_PATH_TO_STORAGE' });
    expect(blockedDelivery.buildings.at(-1)).toMatchObject({ anchor: { x: 12, y: -1 }, reservedWood: 1 });
    const validSite = validateBuildingLayout(world, 'cabin', { x: -22, y: -1 });
    expect(validSite.valid, JSON.stringify(validSite)).toBe(true);
    const supportBlocked = validateBuildingLayout(createWorldScenario('g5-support-invalid'), 'cabin', { x: 0, y: -1 });
    expect(supportBlocked.reason).toBe('NO_SUPPORT');
    expect(supportBlocked.reasons).not.toContain('OCCUPIED');
    expect(validateBuildingLayout(world, 'cabin', { x: -2, y: -1 }).valid).toBe(true);

    const routeWorld = createWorldScenario('g5-route-blocked');
    const cargoBefore = routeWorld.residents[1]!.cargo;
    const routeBlock = validateBuildingLayout(routeWorld, 'cabin', { x: 12, y: -1 });
    expect(routeBlock).toMatchObject({ valid: true, reason: 'READY' });
    expect(routeBlock.reasons).not.toContain('OCCUPIED');
    expect(routeBlock.reasons).not.toContain('ROUTE_BLOCKED');
    expect(findSurfacePath(routeWorld, { x: -10, y: 0 }, { x: 20, y: 0 })).not.toBeNull();
    expect(routeWorld.residents[1]!.cargo).toBe(cargoBefore);
    expect(validateBuildingLayout(routeWorld, 'cabin', { x: -2, y: -1 }).valid).toBe(true);

    const twoHouses = createWorldScenario('g6-two-houses');
    expect(twoHouses.buildings).toHaveLength(1);
    expect(findSurfacePath(twoHouses, { x: 0, y: 0 }, { x: 11, y: 0 }))
      .toEqual(Array.from({ length: 11 }, (_, index) => ({ x: index + 1, y: 0 })));
    expect(validateBuildingLayout(twoHouses, 'cabin', { x: 12, y: -1 })).toMatchObject({ valid: true, reason: 'READY' });
  });

  it('seeds G6 with an occupied home, a visible obstacle plan, two workers, and no auto-started clearing', () => {
    const g6 = createWorldScenario('g6-sector-expansion');
    expect(g6.sectors.find((sector) => sector.id === 'sector-0-0')?.state).toBe('occupied');
    expect(g6.sectors.find((sector) => sector.id === 'sector-1-0'))
      .toMatchObject({ state: 'unlockable', testOverride: true, obstacles: expect.arrayContaining([expect.objectContaining({ kind: 'tree' }), expect.objectContaining({ kind: 'stone' })]) });
    expect(g6.sectors.find((sector) => sector.id === 'sector-2-0')?.state).toBe('unknown');
    expect(g6.residents.map((resident) => resident.workRole).sort()).toEqual(['builder', 'builder', 'hauler', 'hauler', 'hauler']);
    expect(g6.storages).toHaveLength(1);
    expect(g6.clearingJobs).toHaveLength(0);
    expect(g6.trees.some((tree) => tree.sectorId === 'sector-1-0')).toBe(false);
  });
});
