import { describe, expect, it } from 'vitest';
import { V2_PROCESS_STOP_TIMEOUT_MS, waitForProcessExit } from '../src/process/stop-wait.js';

describe('V2 graceful process stop budget', () => {
  it('waits longer than the client graceful-shutdown deadline', async () => {
    let clock = 0;
    const exitedAt = 5_500;
    const stopped = await waitForProcessExit(() => clock < exitedAt, {
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      }
    });

    expect(V2_PROCESS_STOP_TIMEOUT_MS).toBeGreaterThan(exitedAt);
    expect(stopped).toBe(true);
    expect(clock).toBe(exitedAt);
  });

  it('reports a process that remains alive after the full stop deadline', async () => {
    let clock = 0;
    const stopped = await waitForProcessExit(() => true, {
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      }
    });

    expect(stopped).toBe(false);
    expect(clock).toBe(V2_PROCESS_STOP_TIMEOUT_MS);
  });
});
