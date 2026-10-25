# Peace V2 persistence contract

Status: G2 adds a JSONB persistent world row, hashed owner sessions and an idempotency response log. Broader normalized gameplay tables remain future work. All tables belong only to `avanpost_v2_dev`/`avanpost_v2_test` and are created under `db/peace-v2/migrations` after database identity verification.

The G0 bootstrap creates `peace_v2_schema_migrations` (name, immutable SHA-256, applied time) and `peace_v2_meta` (`schema_version`). G2 migration 0002 creates `peace_v2_world_state`, `peace_v2_sessions` and `peace_v2_command_log`, and seeds a single peaceful starter world. These are V2-only tables; no V1 table or game-world schema is copied.

## Identity and world state

- `player`/`session`: stable owner identity and hashed session token, expiry, revocation, and creation metadata. Pairing is local single-owner bootstrap, not production account auth.
- `world_state`: owner, seed, `worldRevision`, `geometryRevision`, `serverTick`, `lastSimulatedAt`, generator/simulation/catalog/schema versions and hashes, sync lease and progress.
- `world_sector` and `terrain_cell`: signed global coordinates plus explicit sector/local coordinates; fill, material, durability, geology node, discovered/prepared flags, occupancy, infrastructure and topology revision.

## Domain entities

- `resident` is the sole person identity; `laborer_position`, current assignment and route reference it by `residentId`.
- `building` stores a versioned catalog ID, anchor, footprint/catalog version, level, build state, work slots and buffers. `occupied_cell` has a unique `(worldId, cellX, cellY)` constraint.
- `resource_node`, `storage`, `storage_item`, `storage_reservation`, `building_buffer`, `haul_task`, and `item_ledger_entry` identify every item location and reservation.
- `craft_order`, `research_project`, `school_progress`, and `researched_technology` store durable server-owned progress.
- `command_log` records `(playerId, requestId)`, canonical payload hash, exact safe response and resulting revision. `world_event`/outbox rows are operational records, not a claim of full event sourcing.

## Invariants

1. Every foreign key is scoped to its owning world/player; no client-supplied ID bypasses ownership checks.
2. Coordinates and quantities are integers; item quantities are nonnegative.
3. Each item stack has exactly one authoritative location. Transfers and reservation changes commit with both sides or neither.
4. Occupancy is unique per world/cell; overlapping builds cannot reserve or debit materials partially.
5. One resident has at most one mutually exclusive active assignment.
6. World mutation and tick sequence are serialized through the revision row; updates include the expected revision.
7. V1 tables, migrations, schemas and database names never appear in V2 migration configuration.

Every migration is ordered, checksum-recorded, immutable after apply, transactional, and guarded by the operation-specific V2 database allowlist.
