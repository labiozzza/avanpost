import type {
  ResidentSnapshot,
  SchoolId,
  WorldSnapshot
} from "@avanpost/shared";

const JSON_HEADERS = { "content-type": "application/json" };

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
  if (!response.ok) {
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
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export async function sendBuild(
  snapshot: WorldSnapshot,
  target: { building_type: string; sector_id: string; x: number; y: number },
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export async function advanceWorld(
  snapshot: WorldSnapshot,
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export async function startCraft(
  snapshot: WorldSnapshot,
  buildingId: string,
  recipeId: string,
  workerId: string,
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export async function cancelCraft(
  snapshot: WorldSnapshot,
  buildingId: string,
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export async function startResearch(
  snapshot: WorldSnapshot,
  technologyId: string,
  scholarId: string | null,
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export async function cancelResearch(
  snapshot: WorldSnapshot,
): Promise<WorldSnapshot> {
  const result = await request<{ snapshot: WorldSnapshot }>(
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
  return result.snapshot;
}

export type { ResidentSnapshot };
