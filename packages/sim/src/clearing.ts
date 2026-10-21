import type { ClearingAdvance, ClearingJobState } from './types';

export function advanceClearing(
  jobs: ClearingJobState[],
  ticks: number,
  workPerTick: number
): ClearingAdvance[] {
  if (!Number.isInteger(ticks) || ticks < 1) {
    throw new Error('ticks must be a positive integer');
  }
  if (!Number.isInteger(workPerTick) || workPerTick < 1) {
    throw new Error('workPerTick must be a positive integer');
  }

  const gain = ticks * workPerTick;
  return jobs.map((job) => {
    const workDone = Math.min(job.workRequired, job.workDone + gain);
    return {
      id: job.id,
      workDone,
      completed: workDone >= job.workRequired
    };
  });
}
