import type { WorkRole } from './simulation.js';

export const RUNTIME_DIAGNOSTICS_KEY = 'avanpost:runtime-diagnostics:v1';
const MAX_EVENTS = 32;
const ROLES = new Set<WorkRole>(['idle', 'woodcutter', 'miner', 'builder', 'hauler', 'sawmiller']);
const MODES = new Set(['idle', 'moving', 'working', 'carrying', 'building', 'blocked']);
const REQUEST_STATES = new Set(['queued', 'assigned', 'in_progress', 'completed', 'cancelled', 'blocked']);
const EVENT_TYPES = new Set([
  'role-switch', 'role-switch-error', 'uncaught-error', 'unhandled-rejection', 'phaser-error',
  'simulation-step-error', 'ui-update-error', 'slow-operation', 'state-invariant', 'repeated-handler', 'session-start'
]);
const INVARIANT_CODES = new Set([
  'duplicate-request', 'multiple-hauler-requests', 'invalid-request-owner', 'invalid-cargo-state',
  'invalid-store-capacity', 'orphaned-inbound-reservation'
]);
const OPERATIONS = new Set([
  'role-switch', 'role-switch-handler', 'simulation-step', 'ui-update', 'frame-save',
  'offline-catch-up', 'phaser-scene', 'global-handler', 'promise-rejection', 'browser-main-thread'
]);
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'DOMException']);

export interface RuntimeDiagnosticEvent {
  atMs: number;
  type: string;
  roleBefore?: WorkRole;
  roleAfter?: WorkRole;
  mode?: string;
  modeBefore?: string;
  requestStatus?: string;
  requestStatusBefore?: string;
  durationMs?: number;
  errorType?: string;
  loopScheduled?: boolean;
  rapid?: boolean;
  issue?: string;
  operation?: string;
  frames?: string[];
}

/** A bounded, local-only ring without resident identity, full stacks, raw messages, or settlement data. */
export class RuntimeDiagnostics {
  private readonly startedAt = performance.now();
  private events: RuntimeDiagnosticEvent[];

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    this.events = this.read();
    this.record({ type: 'session-start' });
  }

  record(event: Omit<RuntimeDiagnosticEvent, 'atMs'>): void {
    if (!EVENT_TYPES.has(event.type)) return;
    const safe: RuntimeDiagnosticEvent = {
      atMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
      type: event.type,
      ...(event.roleBefore && ROLES.has(event.roleBefore) ? { roleBefore: event.roleBefore } : {}),
      ...(event.roleAfter && ROLES.has(event.roleAfter) ? { roleAfter: event.roleAfter } : {}),
      ...(event.mode && MODES.has(event.mode) ? { mode: event.mode } : {}),
      ...(event.modeBefore && MODES.has(event.modeBefore) ? { modeBefore: event.modeBefore } : {}),
      ...(event.requestStatus && REQUEST_STATES.has(event.requestStatus) ? { requestStatus: event.requestStatus } : {}),
      ...(event.requestStatusBefore && REQUEST_STATES.has(event.requestStatusBefore)
        ? { requestStatusBefore: event.requestStatusBefore } : {}),
      ...(Number.isFinite(event.durationMs) ? { durationMs: Math.max(0, Math.round(event.durationMs!)) } : {}),
      ...(event.errorType && ERROR_NAMES.has(event.errorType) ? { errorType: event.errorType } : {}),
      ...(typeof event.loopScheduled === 'boolean' ? { loopScheduled: event.loopScheduled } : {}),
      ...(typeof event.rapid === 'boolean' ? { rapid: event.rapid } : {}),
      ...(event.issue && INVARIANT_CODES.has(event.issue) ? { issue: event.issue } : {}),
      ...(event.operation && OPERATIONS.has(event.operation) ? { operation: event.operation } : {}),
      ...(event.frames?.length ? { frames: event.frames.slice(0, 6).filter((frame) =>
        /^[A-Za-z0-9_.-]{1,80}:\d{1,8}:\d{1,8}$/.test(frame)) } : {})
    };
    this.events.push(safe);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    try { this.storage?.setItem(RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(this.events)); }
    catch { /* Diagnostics must never interfere with the settlement save or game loop. */ }
  }

  snapshot(): readonly RuntimeDiagnosticEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  private read(): RuntimeDiagnosticEvent[] {
    try {
      const raw = this.storage?.getItem(RUNTIME_DIAGNOSTICS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-MAX_EVENTS).filter((item): item is RuntimeDiagnosticEvent => Boolean(item) &&
        typeof item === 'object' && Number.isFinite(item.atMs) && EVENT_TYPES.has(item.type) &&
        (!item.roleBefore || ROLES.has(item.roleBefore)) && (!item.roleAfter || ROLES.has(item.roleAfter)) &&
        (!item.mode || MODES.has(item.mode)) && (!item.modeBefore || MODES.has(item.modeBefore)) &&
        (!item.requestStatus || REQUEST_STATES.has(item.requestStatus)) &&
        (!item.requestStatusBefore || REQUEST_STATES.has(item.requestStatusBefore)) &&
        (!item.errorType || ERROR_NAMES.has(item.errorType)) &&
        (item.durationMs === undefined || Number.isFinite(item.durationMs)) &&
        (item.loopScheduled === undefined || typeof item.loopScheduled === 'boolean') &&
        (item.rapid === undefined || typeof item.rapid === 'boolean') &&
        (item.issue === undefined || INVARIANT_CODES.has(item.issue)) &&
        (item.operation === undefined || OPERATIONS.has(item.operation)) &&
        (item.frames === undefined || Array.isArray(item.frames) && item.frames.length <= 6 &&
          item.frames.every((frame: unknown) => typeof frame === 'string' &&
            /^[A-Za-z0-9_.-]{1,80}:\d{1,8}:\d{1,8}$/.test(frame))));
    } catch {
      return [];
    }
  }
}

function safeStorage(): Storage | null {
  try { return localStorage; }
  catch { return null; }
}

export function safeErrorType(error: unknown): string {
  if (error instanceof Error && ERROR_NAMES.has(error.name)) return error.name;
  return 'Error';
}

/** Keep only bundle basenames and positions; never persist origins, paths, queries, or error messages. */
export function safeErrorFrames(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return [];
  return error.stack.split('\n').slice(1, 8).flatMap((line) => {
    const frame = line.match(/(?:^|[\\/])([^\\/?#():\s]+\.(?:m?js|ts))(?:\?[^\s():]*)?:(\d{1,8}):(\d{1,8})/i);
    return frame ? [`${frame[1]}:${frame[2]}:${frame[3]}`] : [];
  }).slice(0, 6);
}
