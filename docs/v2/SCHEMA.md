# Peace V2 persistence contract

Status: G3.1.1 persists continuous woodcutting, per-tree regrowth, uprooted stumps and a 100-log store capacity in the JSONB world row. Migration 0006 is applied and tested on `avanpost_v2_test`, then applied in place to `avanpost_v2_dev` after explicit owner approval. All tables belong only to the V2 databases and migrations require database identity verification.

The G0 bootstrap creates `peace_v2_schema_migrations` (name, immutable SHA-256, applied time) and `peace_v2_meta` (`schema_version`). G2 migration 0002 creates `peace_v2_world_state`, `peace_v2_sessions` and `peace_v2_command_log`. Migrations 0003–0005 add the simulation clock, forest sources and second resident in place; 0005 was previously applied to dev with owner approval. G3.1.1 migration 0006 adds per-tree regrowth defaults and store capacity, marks existing assigned harvest tasks continuous (recovered-cargo deliveries remain one-shot), and preserves all other world state and command history. It was verified idempotent on `avanpost_v2_test` and applied in place to dev after owner confirmation. No V1 table or game-world schema is copied.

## Identity and world state

- `player`/`session`: stable owner identity and hashed session token, expiry, revocation, and creation metadata. Pairing is local single-owner bootstrap, not production account auth.
- `world_state`: `world_version`, `geometry_version`, `server_tick`, `last_simulated_at`, `state_schema_version`, plus JSONB resources, stable resident/storage identities and capacity, tree stocks/stages/regrowth progress/uprooted status, per-resident task route/phase/continuous assignment/cargo, and building footprint/stage/progress/material reservation.
- `world_sector` and `terrain_cell`: signed global coordinates plus explicit sector/local coordinates; fill, material, durability, geology node, discovered/prepared flags, occupancy, infrastructure and topology revision.

## Domain entities

- `resident` is the sole person identity; `laborer_position`, current assignment and route reference it by `residentId`.
- `storage` carries configured `woodCapacity`; cargo remains resident-owned until storage has room to accept it.
- `building` stores a versioned catalog ID, anchor, footprint/catalog version, level, build state, work slots and buffers. `occupied_cell` has a unique `(worldId, cellX, cellY)` constraint.
- `resource_node`, `storage`, `storage_item`, `storage_reservation`, `building_buffer`, `haul_task`, and `item_ledger_entry` identify every item location and reservation.
- `craft_order`, `research_project`, `school_progress`, and `researched_technology` store durable server-owned progress.
- `command_log` records `(playerId, requestId)`, canonical payload hash, exact safe response and resulting revision. `world_event`/outbox rows are operational records, not a claim of full event sourcing.

## Invariants

1. Every foreign key is scoped to its owning world/player; no client-supplied ID bypasses ownership checks.
2. Coordinates and quantities are integers; item quantities are nonnegative.
3. Each item stack has exactly one authoritative location. Transfers and reservation changes commit with both sides or neither.
4. Occupancy is unique per world/cell; overlapping builds cannot reserve or debit materials partially.
5. Each resident has at most one mutually exclusive active assignment; separate residents may gather and build concurrently. Competing claims on one source or work point wait rather than double-consume or overlap.
6. World mutation and tick sequence are serialized through the revision row. Mutations revalidate against current locked state; stale simulation revisions are acceptable when geometry still matches, but changed geometry/future versions are rejected.
7. V1 tables, migrations, schemas and database names never appear in V2 migration configuration.
8. A continuous gather task removes one log only after arrival, gathering and loading; storage wood increases only after arrival/unloading and cannot exceed `woodCapacity`. Full storage retains cargo in `waiting_storage`.
9. A build command validates the caller-selected footprint/route and reserves exactly three available wood atomically; the building remains `planned` until a saved worker task advances its foundation/scaffold/completion stages.
10. `last_simulated_at` advances only with a committed deterministic tick batch. Restart catch-up consumes saved time once; clients never submit elapsed time or apply resource progress locally.
11. Automatic woodcutting reserves distinct reachable trees in stable resident-ID order, repeats after safe delivery, and waits/retries when sources or routes are unavailable. Each ordinary tree regrows one log per configured 100 ticks up to its saved maximum; the existing coppice interval remains 1,200 ticks. An `uprooted` stump never regrows, including after API restart.

Every migration is ordered, checksum-recorded, immutable after apply, transactional, and guarded by the operation-specific V2 database allowlist.
