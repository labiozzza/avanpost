import { describe, expect, it } from 'vitest';
import { assertOwnedV2ApiProcess } from '../src/process/ownership.js';

describe('V2 stop process ownership', () => {
  it('accepts only a process with the V2 launcher identity', () => {
    expect(() => assertOwnedV2ApiProcess('node avanpost-peace-v2-api')).not.toThrow();
    expect(() => assertOwnedV2ApiProcess('node apps/server/src/index.ts')).toThrow('V2_API_PID_OWNERSHIP_MISMATCH');
    expect(() => assertOwnedV2ApiProcess('npm run dev:client')).toThrow('V2_API_PID_OWNERSHIP_MISMATCH');
  });
});
