import type {
  ResidentSnapshot,
  SchoolId,
  WorldSnapshot
} from "@avanpost/shared";

const JSON_HEADERS = { "content-type": "application/json" };

export interface CommandResult {
  snapshot: WorldSnapshot;
  replayed: boolean;
  catchingUp?: boolean;
  remainingTicks?: number;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok && response.status !== 202) {
    const error = (body as ErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "INTERNAL",
      error?.message ?? `Request failed: ${response.status}`,
    );
  }
  return body as T;
}

export async function startSession(): Promise<WorldSnapshot> {
  return request<WorldSnapshot>("/api/session", { method: "POST" });
}

export async function fetchState(): Promise<WorldSnapshot> {
  return request<WorldSnapshot>("/api/state");
}

export async function sendSchool(
  snapshot: WorldSnapshot,
  residentId: string,
  school: SchoolId,
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/send-school",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        resident_id: residentId,
        school,
      }),
    },
  );
  return result as CommandResult;
}

export async function gatherNode(
  snapshot: WorldSnapshot,
  nodeId: string,
  residentId?: string | null,
): Promise<CommandResult> {
  const result = await request<CommandResult>("/api/commands/gather", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      node_id: nodeId,
      ...(residentId ? { resident_id: residentId } : {}),
    }),
  });
  return result as CommandResult;
}

export async function stopGather(
  snapshot: WorldSnapshot,
  nodeId: string,
): Promise<CommandResult> {
  const result = await request<CommandResult>("/api/commands/stop-gather", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      expected_version: snapshot.version,
      node_id: nodeId,
    }),
  });
  return result as CommandResult;
}

export async function sendBuild(
  snapshot: WorldSnapshot,
  target: { building_type: string; sector_id: string; x: number; y: number },
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/build",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        building_type: target.building_type,
        sector_id: target.sector_id,
        x: target.x,
        y: target.y,
      }),
    },
  );
  return result as CommandResult;
}

export async function advanceWorld(
  snapshot: WorldSnapshot,
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/advance",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
      }),
    },
  );
  return result as CommandResult;
}

export async function startCraft(
  snapshot: WorldSnapshot,
  buildingId: string,
  recipeId: string,
  workerId: string,
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/start-craft",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        building_id: buildingId,
        recipe_id: recipeId,
        worker_id: workerId,
      }),
    },
  );
  return result as CommandResult;
}

export async function cancelCraft(
  snapshot: WorldSnapshot,
  buildingId: string,
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/cancel-craft",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        building_id: buildingId,
      }),
    },
  );
  return result as CommandResult;
}

export async function startResearch(
  snapshot: WorldSnapshot,
  technologyId: string,
  scholarId: string | null,
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/start-research",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
        technology_id: technologyId,
        scholar_id: scholarId,
      }),
    },
  );
  return result as CommandResult;
}

export async function cancelResearch(
  snapshot: WorldSnapshot,
): Promise<CommandResult> {
  const result = await request<CommandResult>(
    "/api/commands/cancel-research",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        expected_version: snapshot.version,
      }),
    },
  );
  return result as CommandResult;
}

export type { ResidentSnapshot };
