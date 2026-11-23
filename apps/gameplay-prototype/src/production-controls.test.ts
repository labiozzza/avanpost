import { describe, expect, it } from 'vitest';
import { createNewWorld, parseSavedWorld, PrototypeSimulation } from './simulation.js';

function run(simulation: PrototypeSimulation, seconds: number): void {
  const frames = Math.ceil(seconds * 10);
  for (let index = 0; index < frames; index++) simulation.step(0.1);
}

describe('production controls', () => {
  it('bounds saved production quotas and resumes harvesting when the limit is raised', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    const initialWood = simulation.totals().wood;

    expect(simulation.setProductionQuota('wood', 37)).toBe(40);
    expect(simulation.setProductionQuota('wood', Number.NaN)).toBe(240);
    expect(simulation.setProductionQuota('wood', 999)).toBe(240);
    simulation.setProductionQuota('wood', initialWood);
    simulation.assign('r1', 'woodcutter');
    simulation.step(0.1);

    const resident = simulation.world.residents.find((person) => person.id === 'r1')!;
    expect(resident.mode).toBe('blocked');
    expect(simulation.residentDiagnosis(resident).code).toBe('production_quota');

    simulation.setProductionQuota('wood', initialWood + 10);
    run(simulation, 500);

    expect(simulation.totals().wood).toBe(initialWood + 10);
    expect(resident.blockedReason).toContain(`${initialWood + 10}/${initialWood + 10}`);
    expect(parseSavedWorld(JSON.stringify(simulation.world))?.productionSettings?.quota.wood)
      .toBe(initialWood + 10);
  });

  it('bounds transport and construction priorities and preserves them in saves', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    const site = simulation.world.sites[0]!;

    expect(simulation.setProductionPriority('wood', 0)).toBe(1);
    expect(simulation.setProductionPriority('stone', 2.8)).toBe(3);
    expect(simulation.setSitePriority(site.id, 8)).toBe(true);
    expect(site.priority).toBe(3);
    expect(simulation.setSitePriority('missing', 1)).toBe(false);

    const saved = parseSavedWorld(JSON.stringify(simulation.world));
    expect(saved?.productionSettings?.priority).toEqual({ wood: 1, stone: 3, boards: 2 });
    expect(saved?.sites[0]?.priority).toBe(3);
  });

  it('pauses construction without losing progress and resumes it after reloadable save state', () => {
    const simulation = new PrototypeSimulation(createNewWorld());
    expect(simulation.place('house', 1)).toEqual({ ok: true });
    const site = simulation.world.sites[0]!;
    site.deliveredWood = 60;
    site.deliveredStone = 50;
    simulation.assign('r1', 'builder');
    run(simulation, 10);
    expect(site.progress).toBeGreaterThan(0);

    expect(simulation.toggleSitePaused(site.id)).toBe(true);
    const pausedProgress = site.progress;
    run(simulation, 15);
    expect(site.progress).toBe(pausedProgress);
    expect(simulation.world.residents[0]?.blockedReason).toMatch(/паузе|приостановлена/);
    expect(parseSavedWorld(JSON.stringify(simulation.world))?.sites[0]?.paused).toBe(true);

    expect(simulation.toggleSitePaused(site.id)).toBe(true);
    run(simulation, 5);
    expect(site.progress).toBeGreaterThan(pausedProgress);
  });
});
