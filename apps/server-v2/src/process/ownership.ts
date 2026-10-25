export function assertOwnedV2ApiProcess(commandLine: string): void {
  if (!commandLine.includes('avanpost-peace-v2-api')) {
    throw new Error('V2_API_PID_OWNERSHIP_MISMATCH: refusing to stop a process not owned by the V2 launcher.');
  }
}
