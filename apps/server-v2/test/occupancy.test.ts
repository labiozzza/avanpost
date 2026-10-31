import { describe, expect, it } from 'vitest';
import { createWorldScenario } from '../src/testing/world-scenarios.js';
import { OccupiedCellsConflictError, replaceWorldOccupiedCells } from '../src/database/occupancy.js';

describe('persisted footprint occupancy', () => {
  it('replaces all world cells with entity and layout ownership metadata', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const world = createWorldScenario('g5-construction-layout');
    await replaceWorldOccupiedCells({
      async query(sql, values) { calls.push({ sql, values }); return { rowCount: 1 }; }
    }, 'peace-home', world);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain('DELETE FROM peace_v2_occupied_cell');
    expect(calls[1]?.sql).toContain('INSERT INTO peace_v2_occupied_cell');
    const cells = JSON.parse(String(calls[1]?.values?.[1])) as Array<Record<string, unknown>>;
    expect(cells).toHaveLength(8);
    expect(cells).toContainEqual({ cell_x: 4, cell_y: -1, entity_id: 'scenario-g5-cabin', entity_kind: 'building', layout_version: 1 });
    expect(cells).toContainEqual({ cell_x: 21, cell_y: -1, entity_id: 'storehouse-2', entity_kind: 'warehouse', layout_version: 1 });
  });

  it('rejects overlapping footprints before changing persisted occupancy', async () => {
    const calls: string[] = [];
    const world = createWorldScenario('g5-construction-layout');
    world.buildings[1]!.anchor.x = world.buildings[0]!.anchor.x;
    await expect(replaceWorldOccupiedCells({
      async query(sql) { calls.push(sql); return { rowCount: 1 }; }
    }, 'peace-home', world)).rejects.toBeInstanceOf(OccupiedCellsConflictError);
    expect(calls).toEqual([]);
  });
});
