# Peace V2 migrations

Add ordered `NNNN_description.sql` migrations here. The V2 migrator connects only after the
operation-specific database URL and connected server identity pass the V2 allowlist. Applied
migrations are immutable: the stored SHA-256 must match the current file or migration stops
before executing SQL. No V1 migration directory is read by the V2 migrator.

Migration `0003_live_settlement.sql` upgrades the existing JSONB world in place. It adds the
server-owned catch-up timestamp and schema version, stable storage/tree IDs, nullable active
worker task, and building footprint/stage/progress/material-reservation fields. Migration
`0004_forest_sources.sql` retains the existing singleton tree as `tree-1` with its exact position
and remainder, then adds two finite sources and one baseline-renewable coppice. Both migrations
preserve resources, worker/task state, completed cabins, revisions and command history; neither
deletes nor reseeds a saved world or adds wood to storage.
