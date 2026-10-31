# Peace V2 persistence contract

Status: G4.1/G4.2 and G5.1 are owner-accepted; G6.1 is the active slice. Schema 11 and migrations 0011–0013 add persistent multi-warehouse logistics, terrain geometry and construction occupancy. Test/manual are schema 11; `avanpost_v2_dev` remains untouched. All tables belong only to V2 databases and migrations require database identity verification.

The G0 bootstrap creates `peace_v2_schema_migrations` (name, immutable SHA-256, applied time) and `peace_v2_meta` (`schema_version`). G2 migration 0002 creates `peace_v2_world_state`, `peace_v2_sessions` and `peace_v2_command_log`. Migrations 0003–0005 add the simulation clock, forest sources and second resident in place; 0005 was previously applied to dev with owner approval. G3.1.1 migration 0006 adds per-tree regrowth defaults and store capacity, marks existing assigned harvest tasks continuous (recovered-cargo deliveries remain one-shot), and preserves all other world state and command history. It was verified idempotent on `avanpost_v2_test` and applied in place to dev after owner confirmation. No V1 table or game-world schema is copied.

Migration 0009 upgraded schema-6 world JSON in place to schema 7: it changed `woodCapacity` to shared `capacity` (retaining the configured value), added stone stock and the approved-for-G3.3-only finite deposit, tagged existing cargo as wood, and added `reservedStone: 0` to existing buildings. It bumped world and geometry revisions once and preserved residents, tasks, trees, buildings, build orders, sessions and command history. The migration is checksum-locked and transactional; its test/dev application and legacy-world preservation check are recorded in `EXECUTION_LOG.md`.

Migration 0010 upgrades schema-7 worlds to schema 8, converting the existing store and aggregate resources into one primary physical warehouse, adding source-buffer and worksite transit reservations, and defaulting resident warehouse preferences. Test and manual migrations are verified; dev remains schema 7 by explicit boundary. Legacy one-warehouse worlds without a hauler retain their existing `resources` behavior until they enter distributed-storage mode.

Migrations 0011–0012 add prioritized logistics queues and distributed warehouse reservations. Migration 0013 advances schema 10 to 11, persists `surfaceCells` and building access/layout metadata, creates the unique per-world occupied-cell table, and backfills footprints for active buildings and warehouses. Test/manual were migrated; `avanpost_v2_dev` was not queried, migrated, or reset.

## Identity and world state

- `player`/`session`: stable owner identity and hashed session token, expiry, revocation, and creation metadata. Pairing is local single-owner bootstrap, not production account auth.
- `world_state`: `world_version`, `geometry_version`, `server_tick`, `last_simulated_at`, `state_schema_version`, plus JSONB derived resource totals, physical warehouse inventories/capacities and inbound/outbound reservations, tree/stone source buffers and reservations, typed resident cargo and persisted haul routes/phases, and cabin/workshop footprint/stage/progress/material/in-transit reservations.
- `world_sector` and `terrain_cell`: signed global coordinates plus explicit sector/local coordinates; fill, material, durability, geology node, discovered/prepared flags, occupancy, infrastructure and topology revision.

## Domain entities

- `resident` is the sole person identity; `laborer_position`, current assignment and route reference it by `residentId`.
- `storage` carries shared capacity across wood and stone; cargo remains resident-owned and item-typed until storage has room to accept it.
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
8. Continuous woodcutting and stone mining only transfer stock after the authoritative gather/load phase. Typed cargo remains with the resident until destination unload; combined stored wood and stone cannot exceed shared capacity. Full storage retains cargo in a visible waiting state.
9. Cabin orders reserve three wood; G3.3 workshop orders reserve the configured 12 wood and 6 stone. Reservations are atomic, persist by building, return on safe cancellation, and are consumed once at completion.
10. `last_simulated_at` advances only with a committed deterministic tick batch. Restart catch-up consumes saved time once; clients never submit elapsed time or apply resource progress locally.
11. Automatic woodcutting reserves distinct reachable trees in stable resident-ID order, repeats after safe delivery, and waits/retries when sources or routes are unavailable. Each ordinary tree regrows one log per configured 100 ticks up to its saved maximum; the existing coppice interval remains 1,200 ticks. An `uprooted` stump never regrows, including after API restart.
12. The G3.3-only finite surface-accessible stone deposit starts with 600 units, yields at most 3 per mining tick into an 18-unit source buffer, and never goes below zero. The `stone_miner` role is temporary task automation, not a formal profession. Its values are preliminary for this slice and do not close G4/G5/G6.

Every migration is ordered, checksum-recorded, immutable after apply, transactional, and guarded by the operation-specific V2 database allowlist.
