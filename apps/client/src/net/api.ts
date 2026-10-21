import type {
  AdvanceResponse,
  ApiErrorBody,
  BuildResponse,
  ClearCellResponse,
  DemolishResponse,
  GatherNodeResponse,
  StopGatherResponse,
  UnlockSectorResponse,
  WorldSnapshot
} from '@avanpost/shared';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'HTTP_ERROR';
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as ApiErrorBody;
    code = body.error.code;
    message = body.error.message;
  } catch {
    // keep the generic message
  }
  return new ApiError(code, message, response.status);
}

export async function fetchState(): Promise<WorldSnapshot | null> {
  const response = await fetch('/api/state', { credentials: 'same-origin' });
  if (response.status === 401) return null;
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as WorldSnapshot;
}

export async function createSession(): Promise<WorldSnapshot> {
  const response = await fetch('/api/session', {
    method: 'POST',
    credentials: 'same-origin'
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as WorldSnapshot;
}

export async function advanceWorld(command: {
  request_id: string;
  expected_version: number;
  ticks: number;
}): Promise<AdvanceResponse> {
  const response = await fetch('/api/commands/advance', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as AdvanceResponse;
}

export async function heartbeat(): Promise<void> {
  const response = await fetch('/api/heartbeat', {
    method: 'POST',
    credentials: 'same-origin'
  });
  if (!response.ok) throw await parseError(response);
}

export async function unlockSector(command: {
  request_id: string;
  expected_version: number;
  sector_x: number;
  sector_y: number;
}): Promise<UnlockSectorResponse> {
  const response = await fetch('/api/commands/unlock', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as UnlockSectorResponse;
}

export async function clearCell(command: {
  request_id: string;
  expected_version: number;
  sector_id: string;
  x: number;
  y: number;
}): Promise<ClearCellResponse> {
  const response = await fetch('/api/commands/clear', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ClearCellResponse;
}

export async function buildBuilding(command: {
  request_id: string;
  expected_version: number;
  building_type: string;
  sector_id: string;
  x: number;
  y: number;
}): Promise<BuildResponse> {
  const response = await fetch('/api/commands/build', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as BuildResponse;
}

export async function demolishBuilding(command: {
  request_id: string;
  expected_version: number;
  building_id: string;
}): Promise<DemolishResponse> {
  const response = await fetch('/api/commands/demolish', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as DemolishResponse;
}

export async function gatherNode(command: {
  request_id: string;
  expected_version: number;
  node_id: string;
}): Promise<GatherNodeResponse> {
  const response = await fetch('/api/commands/gather', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as GatherNodeResponse;
}

export async function stopGather(command: {
  request_id: string;
  expected_version: number;
  node_id: string;
}): Promise<StopGatherResponse> {
  const response = await fetch('/api/commands/stop-gather', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as StopGatherResponse;
}
