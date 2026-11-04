import { describe, expect, it } from 'vitest';
import { advanceSettlement, createGatherWoodTask } from '../src/settlement.js';
import { housingSummary } from '../src/population.js';
import { createWorldScenario } from '../../../apps/server-v2/src/testing/world-scenarios.js';

describe('G7.1 population and housing', () => {
  it('counts only completed cabins and suppresses migration at full capacity', () => {
    const world = createWorldScenario('g7-population-housing');
    const home = world.buildings.find((building) => building.kind === 'cabin')!;
    expect(housingSummary(world)).toMatchObject({ housingPlaces: 4, freeHousingPlaces: 1 });
    home.state = 'planned';
    expect(housingSummary(world).housingPlaces).toBe(0);
    home.state = 'complete';
    world.residents[1]!.housingBuildingId = null;
    world.residents[2] = { ...world.residents[0]!, id: 'extra-a', housingBuildingId: home.id };
    world.residents[3] = { ...world.residents[0]!, id: 'extra-b', housingBuildingId: home.id };
    world.residents[4] = { ...world.residents[0]!, id: 'extra-c', housingBuildingId: home.id };
    const full = advanceSettlement(world, 20);
    expect(full.residents).toHaveLength(5);
    expect(full.populationMigration.attraction).toBe('no_housing');
  });

  it('accumulates eligible migration, creates one stable commuting resident and persists housing', () => {
    const world = createWorldScenario('g7-population-housing');
    const arrived = advanceSettlement(world, 13);
    const migrants = arrived.residents.filter((resident) => resident.id.startsWith('resident-migrant-'));
    expect(migrants).toHaveLength(1);
    expect(arrived.populationMigration.lastArrivalTick).toBeLessThanOrEqual(arrived.revision.serverTick);
    expect(migrants[0]).toMatchObject({ arrivalState: 'commuting', civilianProfession: 'general_worker', workRole: 'none' });
    expect(migrants[0]!.housingBuildingId).toBe('g7-ready-home');
    expect(migrants[0]!.task).toMatchObject({ kind: 'arrival', phase: 'commuting' });
    const progressed = advanceSettlement(arrived, 4);
    expect(progressed.residents.filter((resident) => resident.id.startsWith('resident-migrant-'))).toHaveLength(1);
    expect(progressed.residents.find((resident) => resident.id === migrants[0]!.id)!.position).not.toEqual(migrants[0]!.position);
  });

  it('keeps civilian profession independent and gives XP only during actual work', () => {
    const world = createWorldScenario('g7-population-housing');
    const idle = structuredClone(world);
    idle.residents[0]!.workRole = 'none';
    idle.residents[0]!.task = null;
    expect(advanceSettlement(idle, 10).residents[0]!.civilianXp).toBe(0);
    const working = advanceSettlement(world, 10);
    const builder = working.residents.find((resident) => resident.id === 'worker-1')!;
    expect(builder.civilianProfession).toBe('general_worker');
    expect(builder.workRole).toBe('builder');
    const tasked = structuredClone(world);
    tasked.residents[0]!.task = createGatherWoodTask(tasked, 'worker-1', 'xp-real-work')!;
    const worked = advanceSettlement(tasked, 10);
    expect(worked.residents.find((resident) => resident.id === 'worker-1')!.civilianXp).toBeGreaterThan(0);
  });
});
