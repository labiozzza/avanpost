import { describe, expect, it } from 'vitest';
import { LAND_GRID_CONFIG, cellsForFootprint, gridCellId } from './land-grid.js';
import { createNewWorld, parseSavedWorld, PrototypeSimulation } from './simulation.js';

const surfaceRow = LAND_GRID_CONFIG.surfaceCellRow;

function emptySettlement() {
  const world = createNewWorld();
  world.stores = [];
  world.buildings = [];
  world.sites = [];
  world.occupiedPlots = [];
  return new PrototypeSimulation(world);
}

describe('rectangular building footprints', () => {
  it('places the sawmill on two adjacent 300-unit surface cells and frees both when cancelled', () => {
    const simulation = emptySettlement();
    const anchor = { column: 1, row: surfaceRow };
    const footprint = { widthCells: 2, heightCells: 1 };
    const expectedCells = cellsForFootprint(anchor, footprint)!.map((cell) => cell.id);
    expect(simulation.place('sawmill', gridCellId(anchor.column, anchor.row))).toEqual({ ok: true });
    expect(simulation.world.sites[0]).toMatchObject({ kind: 'sawmill', footprint,
      x: 300 + footprint.widthCells * 150, gridColumn: 1, gridRow: surfaceRow });
    expect(simulation.world.occupiedPlots).toEqual(expectedCells);
    expect(simulation.cancelSite(simulation.world.sites[0]!.id)).toBe(true);
    expect(simulation.world.occupiedPlots).toEqual([]);
  });

  it('places, saves and releases every required future rectangle atomically', () => {
    const sizes = [
      [2, 1], [1, 2], [2, 2], [3, 2], [2, 3]
    ] as const;
    for (const [widthCells, heightCells] of sizes) {
      const simulation = emptySettlement();
      const footprint = { widthCells, heightCells };
      const anchor = { column: 1, row: surfaceRow };
      const ids = cellsForFootprint(anchor, footprint)!.map((cell) => cell.id).sort((a, b) => a - b);
      expect(simulation.place('house', gridCellId(anchor.column, anchor.row), footprint)).toEqual({ ok: true });
      expect(simulation.world.occupiedPlots).toEqual(ids);
      expect(simulation.world.sites[0]).toMatchObject({
        gridColumn: anchor.column, gridRow: anchor.row, footprint,
        x: 300 + widthCells * 150
      });

      const restored = parseSavedWorld(JSON.stringify(simulation.world));
      expect(restored?.sites[0]?.footprint).toEqual(footprint);
      expect(restored?.occupiedPlots).toEqual(ids);

      expect(simulation.cancelSite(simulation.world.sites[0]!.id)).toBe(true);
      expect(simulation.world.occupiedPlots).toEqual([]);
      expect(simulation.canPlaceFootprint(anchor, footprint).ok).toBe(true);
    }
  });

  it('blocks overlaps as a whole and frees every cell when a site is cancelled', () => {
    const simulation = emptySettlement();
    const first = gridCellId(1, surfaceRow);
    const second = gridCellId(2, surfaceRow);
    expect(simulation.place('warehouse', first, { widthCells: 2, heightCells: 1 })).toEqual({ ok: true });
    const before = [...simulation.world.occupiedPlots];
    expect(simulation.place('house', second)).toMatchObject({ ok: false });
    expect(simulation.world.sites).toHaveLength(1);
    expect(simulation.world.occupiedPlots).toEqual(before);

    const siteId = simulation.world.sites[0]!.id;
    expect(simulation.cancelSite(siteId)).toBe(true);
    expect(simulation.place('house', second)).toEqual({ ok: true });
    expect(simulation.world.occupiedPlots).toEqual([second]);
  });

  it('rejects unsupported, reserved and out-of-bounds footprints with a reason', () => {
    const simulation = emptySettlement();
    expect(simulation.canPlaceFootprint({ column: 1, row: surfaceRow + 1 }, { widthCells: 1, heightCells: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('поверхности') });
    expect(simulation.canPlaceFootprint({ column: 0, row: surfaceRow }, { widthCells: 1, heightCells: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('источником') });
    expect(simulation.canPlaceFootprint({ column: 13, row: surfaceRow }, { widthCells: 2, heightCells: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('пределы') });
    expect(simulation.canPlaceFootprint({ column: 5, row: surfaceRow }, { widthCells: 2, heightCells: 1 }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('источником') });
  });

  it('releases the whole footprint when a multi-cell building is demolished', () => {
    const world = createNewWorld();
    const footprint = { widthCells: 2, heightCells: 2 };
    const anchor = { column: 1, row: surfaceRow };
    const cells = cellsForFootprint(anchor, footprint)!;
    const ids = cells.map((cell) => cell.id);
    world.buildings.push({ id: 'wide-house', kind: 'house', x: 600, y: 600,
      gridColumn: anchor.column, gridRow: anchor.row, footprint });
    world.occupiedPlots.push(...ids);
    const simulation = new PrototypeSimulation(world);
    simulation.assign('r1', 'builder');
    expect(simulation.startDemolition('wide-house')).toEqual({ ok: true });
    for (let tick = 0; tick < 250 && world.buildings.some((building) => building.id === 'wide-house'); tick += 1) {
      simulation.step(0.1);
    }
    expect(world.buildings.some((building) => building.id === 'wide-house')).toBe(false);
    expect(ids.every((id) => !world.occupiedPlots.includes(id))).toBe(true);
    expect(simulation.canPlaceFootprint(anchor, footprint).ok).toBe(true);
  });
});
