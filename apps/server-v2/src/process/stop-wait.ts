export const V2_CLIENT_SHUTDOWN_GRACE_MS = 5_000;
export const V2_PROCESS_STOP_TIMEOUT_MS = V2_CLIENT_SHUTDOWN_GRACE_MS + 5_000;
export const V2_PROCESS_STOP_POLL_INTERVAL_MS = 100;

export interface WaitForExitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function waitForProcessExit(
  isRunning: () => boolean,
  {
    timeoutMs = V2_PROCESS_STOP_TIMEOUT_MS,
    pollIntervalMs = V2_PROCESS_STOP_POLL_INTERVAL_MS,
    now = Date.now,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  }: WaitForExitOptions = {}
): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!isRunning()) return true;
    await sleep(Math.min(pollIntervalMs, deadline - now()));
  }
  return !isRunning();
}
