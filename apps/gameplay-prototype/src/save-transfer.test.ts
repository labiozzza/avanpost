import { describe, expect, it } from 'vitest';
import { createNewWorld } from './simulation.js';
import { parseSaveExport, serializeSaveExport } from './save-transfer.js';

describe('save transfer', () => {
  it('round-trips a validated settlement and its grid preference', () => {
    const world = createNewWorld();
    world.residents[0]!.role = 'woodcutter';
    world.elapsedSeconds = 918;
    const exportedAt = new Date('2026-11-23T08:00:00.000Z');

    const imported = parseSaveExport(serializeSaveExport(world, 'planning', exportedAt));

    expect(imported.exportedAt).toBe(exportedAt.toISOString());
    expect(imported.gridMode).toBe('planning');
    expect(imported.world.residents[0]!.role).toBe('woodcutter');
    expect(imported.world.elapsedSeconds).toBe(918);
    expect(imported.world.stores).toHaveLength(1);
  });

  it.each([
    ['malformed JSON', '{'],
    ['another format', JSON.stringify({ format: 'other', version: 1 })],
    ['another origin key', JSON.stringify({ format: 'avanpost-gameplay-prototype-save', version: 1,
      storageKey: 'different-origin', exportedAt: '2026-11-23T00:00:00Z', preferences: { gridMode: 'off' }, world: {} })],
    ['invalid world', serializeSaveExport({ version: 1 } as never, 'off')]
  ])('rejects %s without a parsed settlement', (_label, raw) => {
    expect(() => parseSaveExport(raw)).toThrow();
  });
});
