import { PROTOTYPE_CONFIG, type PrototypeSimulation } from './simulation.js';

export interface AbsenceReport {
  seconds: number;
  capped: boolean;
  buildings: string[];
  harvested: { wood: number; stone: number };
  delivered: { wood: number; stone: number };
}

/** Advance the live state machine in fixed steps, yielding to the UI. */
export async function catchUpSettlement(simulation: PrototypeSimulation, now: number, options: {
  yieldToUi?: () => Promise<void>;
  checkpoint?: (fraction: number) => void;
} = {}): Promise<AbsenceReport> {
  const world = simulation.world;
  const previous = world.lastSimulatedAtMs;
  const elapsed = typeof previous === 'number' && Number.isFinite(previous) && previous > 0
    ? Math.max(0, (now - previous) / 1000) : 0;
  const seconds = Math.min(elapsed, PROTOTYPE_CONFIG.offline.maxSeconds);
  const report: AbsenceReport = { seconds, capped: elapsed > seconds, buildings: [],
    harvested: { wood: 0, stone: 0 }, delivered: { wood: 0, stone: 0 } };
  const initialBuildings = new Set(world.buildings.map((building) => building.id));
  const before = structuredClone(simulation.activity);
  const yieldToUi = options.yieldToUi ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let processed = 0, chunk = 0;
  while (seconds - processed > 1e-7) {
    const dt = Math.min(PROTOTYPE_CONFIG.offline.stepSeconds, seconds - processed);
    simulation.step(dt);
    processed += dt;
    // A page closed during catch-up saves only the time processed so far.
    world.lastSimulatedAtMs = previous! + processed * 1000;
    if (++chunk >= PROTOTYPE_CONFIG.offline.chunkSteps) {
      chunk = 0;
      options.checkpoint?.(processed / seconds);
      await yieldToUi();
    }
  }
  // Consumes the whole interval, including any portion beyond the cap.
  world.lastSimulatedAtMs = now;
  for (const item of ['wood', 'stone'] as const) {
    report.harvested[item] = simulation.activity.harvested[item] - before.harvested[item];
    report.delivered[item] = simulation.activity.delivered[item] - before.delivered[item];
  }
  report.buildings = world.buildings.filter((building) => !initialBuildings.has(building.id))
    .map((building) => building.kind === 'house' ? 'дом' : 'склад');
  options.checkpoint?.(1);
  return report;
}

export function absenceText(report: AbsenceReport): string {
  const parts: string[] = [];
  if (report.buildings.length) parts.push(`построено: ${report.buildings.join(', ')}`);
  if (report.harvested.wood) parts.push(`добыто ${report.harvested.wood} дерева`);
  if (report.harvested.stone) parts.push(`добыто ${report.harvested.stone} камня`);
  if (report.delivered.wood) parts.push(`доставлено ${report.delivered.wood} дерева`);
  if (report.delivered.stone) parts.push(`доставлено ${report.delivered.stone} камня`);
  if (!parts.length) parts.push('жители продолжили доступные задачи; ожидают материалы или место');
  return `Пока вас не было: ${parts.join(', ')}.${report.capped ? ' Учтены первые 8 часов отсутствия.' : ''}`;
}
