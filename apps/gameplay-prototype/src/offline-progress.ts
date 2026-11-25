import { PROTOTYPE_CONFIG, type PrototypeSimulation } from './simulation.js';

export interface AbsenceReport {
  seconds: number;
  capped: boolean;
  buildings: string[];
  upgrades: string[];
  harvested: { wood: number; ore: number };
  delivered: { wood: number; ore: number };
}

/** Advance the live state machine in fixed steps, yielding to the UI. */
export async function catchUpSettlement(simulation: PrototypeSimulation, now: number, options: {
  yieldToUi?: () => Promise<void>;
  checkpoint?: (fraction: number) => void;
  progress?: (fraction: number) => void;
} = {}): Promise<AbsenceReport> {
  const world = simulation.world;
  const previous = world.lastSimulatedAtMs;
  const elapsed = typeof previous === 'number' && Number.isFinite(previous) && previous > 0
    ? Math.max(0, (now - previous) / 1000) : 0;
  const seconds = Math.min(elapsed, PROTOTYPE_CONFIG.offline.maxSeconds);
  const report: AbsenceReport = { seconds, capped: elapsed > seconds, buildings: [], upgrades: [],
    harvested: { wood: 0, ore: 0 }, delivered: { wood: 0, ore: 0 } };
  const initialBuildings = new Set(world.buildings.map((building) => building.id));
  const initialHouseLevels = new Map(world.buildings.filter((building) => building.kind === 'house')
    .map((building) => [building.id, building.level ?? 1]));
  const before = structuredClone(simulation.activity);
  const yieldToUi = options.yieldToUi ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let processed = 0, chunk = 0;
  let nextDiagnosticSeconds = PROTOTYPE_CONFIG.offline.stepSeconds * PROTOTYPE_CONFIG.offline.diagnosticSteps;
  let lastDiagnosticSeconds = 0;
  let nextCheckpointSeconds = PROTOTYPE_CONFIG.offline.stepSeconds * PROTOTYPE_CONFIG.offline.checkpointSteps;
  let lastCheckpointFraction = -1;
  while (seconds - processed > 1e-7) {
    const dt = Math.min(PROTOTYPE_CONFIG.offline.stepSeconds, seconds - processed);
    simulation.stepOffline(dt);
    processed += dt;
    // A page closed during catch-up saves only the time processed so far.
    world.lastSimulatedAtMs = previous! + processed * 1000;
    if (processed + 1e-7 >= nextDiagnosticSeconds) {
      simulation.refreshProgressDiagnostics();
      lastDiagnosticSeconds = processed;
      nextDiagnosticSeconds += PROTOTYPE_CONFIG.offline.stepSeconds * PROTOTYPE_CONFIG.offline.diagnosticSteps;
    }
    if (processed + 1e-7 >= nextCheckpointSeconds) {
      if (lastDiagnosticSeconds < processed - 1e-7) simulation.refreshProgressDiagnostics();
      lastCheckpointFraction = processed / seconds;
      options.checkpoint?.(lastCheckpointFraction);
      nextCheckpointSeconds += PROTOTYPE_CONFIG.offline.stepSeconds * PROTOTYPE_CONFIG.offline.checkpointSteps;
    }
    if (++chunk >= PROTOTYPE_CONFIG.offline.chunkSteps) {
      chunk = 0;
      options.progress?.(processed / seconds);
      await yieldToUi();
    }
  }
  // Consumes the whole interval, including any portion beyond the cap.
  world.lastSimulatedAtMs = now;
  simulation.refreshProgressDiagnostics();
  for (const item of ['wood', 'ore'] as const) {
    report.harvested[item] = simulation.activity.harvested[item] - before.harvested[item];
    report.delivered[item] = simulation.activity.delivered[item] - before.delivered[item];
  }
  report.buildings = world.buildings.filter((building) => !initialBuildings.has(building.id))
    .map((building) => building.kind === 'house' ? 'дом' : building.kind === 'sawmill' ? 'лесопилка'
      : building.kind === 'mine' ? 'шахта' : 'склад');
  report.upgrades = world.buildings.filter((building) => building.kind === 'house' && (building.level ?? 1) > (initialHouseLevels.get(building.id) ?? 1))
    .map(() => 'дом до второго уровня');
  if (lastCheckpointFraction < 1) options.checkpoint?.(1);
  options.progress?.(1);
  return report;
}

export function absenceText(report: AbsenceReport): string {
  const parts: string[] = [];
  if (report.buildings.length) parts.push(`построено: ${report.buildings.join(', ')}`);
  if (report.upgrades.length) parts.push(`улучшено: ${report.upgrades.join(', ')}`);
  if (report.harvested.wood) parts.push(`добыто ${report.harvested.wood} дерева`);
  if (report.harvested.ore) parts.push(`добыто ${report.harvested.ore} породы`);
  if (report.delivered.wood) parts.push(`доставлено ${report.delivered.wood} дерева`);
  if (report.delivered.ore) parts.push(`доставлено ${report.delivered.ore} породы`);
  if (!parts.length) parts.push('жители продолжили доступные задачи; ожидают материалы или место');
  return `Пока вас не было: ${parts.join(', ')}.${report.capped ? ' Учтены первые 8 часов отсутствия.' : ''}`;
}
