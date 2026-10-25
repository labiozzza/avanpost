# Peace V2 API contract

Status: G2.1 live settlement slice implemented; the LAN client calls the API directly on the private bind, while the localhost-only Vite client proxies `/api` to that same private-bound API so its HttpOnly session cookie remains first-party. Physical-phone verification and full G2 acceptance remain in progress.

## Common rules

- Fastify owns the HTTP boundary. Parse every request and response with the shared V2 schemas; unknown mutation fields are rejected.
- Mutations and owner-private reads require a V2 owner-scoped session. Before pairing, the only world read is a launcher-scoped, explicitly read-only preview that omits owner/session identifiers and never exposes mutation commands. The client submits intent and expected versions; it never authors balances, item transfers, simulation time, or build completion.
- Mutation envelope extends the shared strict base (`requestId`, `expectedWorldVersion`, `expectedGeometryVersion`) with command-specific target/payload schemas. The same `(requestId, canonicalPayloadHash)` replays the exact prior response; reuse with a changed payload returns a conflict.
- Use RFC 9457 problem details with stable `code`, safe `detail`, `requestId`, and a documentation anchor. Never return secrets, pairing-code validation internals, or a raw stack trace.
- V2 API stays on loopback by default. Enabling explicit private-LAN play is a G2 capability behind pairing and strict Host/Origin checks.

## Route contract

| Method/path | Session | Contract / effect | Status |
|---|---|---|---|
| `GET /api/health` | none | API readiness and build identifier; no secrets or DB URL | implemented G0 bootstrap |
| `GET http://127.0.0.1:8789/api/launcher/pairing-code` | actual loopback peer + loopback Host + configured UI Origin | Separate loopback-only service returns a five-minute in-memory code; `Cache-Control: no-store`; never logs or persists it | implemented G2 |
| `POST /api/session` | configured UI Origin + assigned API Host + actual local/private peer + one-time code | Atomically consume code and issue owner session in HttpOnly, SameSite cookie; body only, no query string. The localhost-only Vite client proxies this route to the private API bind | implemented G2; LAN requires explicit bind opt-in |
| `GET /api/session/status` | none | Returns only whether this browser has a valid owner session | implemented G2 |
| `GET /api/world/preview` | none | Read-only visual snapshot with ephemeral resource-node keys and no owner/resident IDs | implemented G2 |
| `GET /api/world` | required | Authoritative world, resource, worker, forest-source array and cabin snapshot with revisions | implemented G2 |
| `GET /api/catalog` | required | Versioned, provenance-labelled catalog snapshot; invalid catalogs fail closed with `CATALOG_INVALID` | planned G2+ |
| `POST /api/placement/validate` | required | Read-only server validation of the exact cabin anchor, footprint, materials, worker state and reachable build point | implemented G2.1 |
| `POST /api/commands` | required | Strict `collect-wood` or `build-cabin` intent; accepted commands create durable work, reserve resources and persist the exact idempotent response | implemented G2.1 |
| `GET /api/commands/:requestId` | required | Reconcile an uncertain mutation result without issuing a second mutation | planned G2+ |

## Failure and recovery contract

| HTTP | Code | Recovery / invariant |
|---|---|---|
| 401 | `SESSION_REQUIRED` | Pair before private reads or mutations; no world effect |
| 403 | `ORIGIN_REJECTED` | Open the game from its configured V2 address; no request is processed |
| 401 | `PAIR_INVALID` / `PAIR_EXPIRED` / `PAIR_REUSED` | Safe reason-specific re-pair guidance; never echo code, attempts or validator details |
| 403/404 | `OWNER_MISMATCH` / `WORLD_NOT_FOUND` | Do not disclose another owner's world; no state change |
| 409 | `STALE_WORLD` / `STALE_GEOMETRY` | Return current version and fetch a fresh snapshot; no partial effect |
| 409 | `REQUEST_ID_PAYLOAD_CONFLICT` | Same ID with changed payload is not replayed; submit only after client reconciliation |
| 409 | `CARGO_NOT_EMPTY` | Wait for the server-owned delivery task to unload the carried log before another order or build |
| 409 | `WORKER_BUSY` | The resident has a saved active task; no second task is assigned |
| 400 | `INVALID_COORDINATE` | Choose a signed integer grid coordinate |
| 503 | `V2_DB_UNAVAILABLE` | Retry after the isolated V2 database recovers; saved-world schema errors use a separate code |
| 503 | `V2_WORLD_NOT_INITIALIZED` / `V2_WORLD_STATE_INVALID` | Stop play and inspect the isolated V2 world state; never treat invalid persisted state as a database outage |
| 409 | `NO_PATH` / `NO_SUPPORT` / `NO_ENTRANCE` / `OCCUPIED` | Keep items/materials unchanged and show the precise actionable reason |
| 422 | `RESOURCE_MISSING` / `STORAGE_FULL` / `NO_SPECIALIST` | Pause/wait with actual item location and safe next action |
| 429 | `PAIR_RATE_LIMITED` | Wait for cooldown and retry pairing; do not reveal remaining attempts |

## Command payloads

`packages/peace-v2-shared` exports strict Zod `GlobalCoordinateSchema`, `CommandEnvelopeSchema`, `BuildIntentSchema`, `AssignWorkIntentSchema`, `PairingRequestSchema`, `WorldRevisionSchema`, `ProblemDetailsSchema`, `ReadOnlyWorldPreviewSchema`, and the G2.1 `PeaceCommandSchema`, `PeaceWorkerTaskSchema` and `PeaceWorldSnapshotSchema`. A `collect-wood` command includes the selected `sourceId`; authoritative snapshots contain all finite and renewable forest sources. The slice still supports one worker, storage delivery and cabin construction, not the complete Stage I command set. No Stage II/PvP/market/payment command is part of this API.

In LAN mode, only the phone-facing Vite listener is bound to the assigned private IPv4. A second Vite listener binds to `127.0.0.1` for `localhost`; it proxies only `/api` to the private API address. The API still validates its actual socket peer and expected API Host, and the pairing-code handoff remains a separate loopback-only listener.

## Consistency

An accepted `collect-wood` command creates a task bound to its selected `sourceId`. That source is unchanged until the worker reaches its work point, gathers and completes loading. The worker then carries the log to storage; stored wood increases only after unloading. Missing, exhausted or regrowing sources return `422 RESOURCE_MISSING` without changing world state. An accepted `build-cabin` command revalidates its exact anchor and reserves three wood in the same transaction before creating a `planned` site and `walking_to_build` task. A stale expected version returns `409 STALE_WORLD` with no partial effect. Concurrent commands serialize against the world revision row; same-ID retries replay the original saved response.

The server advances deterministic 500 ms ticks. Position, route progress, current phase, cargo, building stage, world revision and `last_simulated_at` are committed together. Startup catches up elapsed server time through the same tick rules; the browser only polls snapshots and may interpolate the display between them.

## Wire examples

These examples illustrate the implemented G2 pairing, preview, mutation and conflict contracts. Broader catalog, placement and work-assignment routes remain planned.

`POST /api/session` request body. The code is never accepted in a URL or query parameter:

```json
{
  "code": "<one-time-code>"
}
```

`GET /api/world/preview` response fixture before pairing. It has no owner or stable resident identifiers and carries no commands:

```json
{
  "revision": { "worldVersion": 1, "geometryVersion": 1, "serverTick": 2 },
  "cells": [{ "coordinate": { "x": -1, "y": 0 }, "fillType": "solid", "materialId": "stone" }],
  "buildings": [{ "visualKey": "house-visual-1", "buildingId": "house", "anchor": { "x": -2, "y": -1 }, "state": "complete" }],
  "resourceNodes": [{ "visualKey": "forest-visual-1", "name": "Берёза", "position": { "x": 3, "y": 0 }, "sourceKind": "finite", "remaining": 2, "maxRemaining": 3, "state": "standing", "regrowthProgressTicks": 0, "regrowthEveryTicks": null }],
  "actors": [{ "visualKey": "actor-1", "position": { "x": 0, "y": -1 }, "visualState": "walk" }],
  "resourceTotals": [{ "itemId": "wood", "quantity": 4 }]
}
```

`POST /api/commands` request after pairing. Wood gathering names an authoritative forest source; the server owns routes and all resource changes:

```json
{
  "requestId": "client-request-wood-0001",
  "expectedWorldVersion": 7,
  "expectedGeometryVersion": 3,
  "kind": "collect-wood",
  "sourceId": "tree-2"
}
```

Cabin construction remains a separate strict command; the server decides its cost and completion:

```json
{
  "requestId": "client-request-0001",
  "expectedWorldVersion": 7,
  "expectedGeometryVersion": 3,
  "kind": "build-cabin",
  "anchor": { "x": 0, "y": -1 }
}
```

RFC 9457 conflict fixture for a stale preview:

```json
{
  "type": "https://avanpost.invalid/problems/stale-world",
  "title": "World changed",
  "status": 409,
  "detail": "Fetch a fresh snapshot before retrying this action.",
  "code": "STALE_WORLD",
  "requestId": "client-request-0001"
}
```
