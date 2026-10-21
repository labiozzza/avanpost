import type { FastifyInstance } from 'fastify';
import type { WorldSnapshot } from '@avanpost/shared';

/**
 * Controlled wall clock for integration tests. Time only moves when a test
 * asks it to, so offline/online behaviour is deterministic without sleeps
 * (acceptance A4: server-driven time with injectable clock).
 */
export class TestClock {
  private offsetMsValue = 0;
  private tickMs = 400;
  /** Frozen base: real wall-clock drift between requests must not add ticks. */
  private baseMs = Date.now();

  now = (): Date => new Date(this.baseMs + this.offsetMsValue);

  setTickDuration(tickMs: number): void {
    this.tickMs = tickMs;
  }

  /** Move server time forward by N game ticks. */
  advanceTicks(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks <= 0) throw new Error('ticks must be a positive integer');
    this.offsetMsValue += ticks * this.tickMs;
  }

  advanceMs(ms: number): void {
    this.offsetMsValue += ms;
  }

  get offsetMs(): number {
    return this.offsetMsValue;
  }
}

export async function advanceServerTime(
  app: FastifyInstance,
  cookie: string,
  clock: TestClock,
  snapshot: WorldSnapshot,
  ticks: number
): Promise<WorldSnapshot> {
  clock.advanceTicks(ticks);
  const response = await app.inject({
    method: 'POST',
    url: '/api/commands/advance',
    headers: { cookie },
    payload: {
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version
    }
  });
  if (response.statusCode !== 200) {
    throw new Error(
      `advance failed (${response.statusCode}): ${response.body}`
    );
  }
  return response.json<{ snapshot: WorldSnapshot }>().snapshot;
}
