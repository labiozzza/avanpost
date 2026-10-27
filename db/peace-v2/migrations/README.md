# Peace V2 migrations

Add ordered `NNNN_description.sql` migrations here. The V2 migrator connects only after the
operation-specific database URL and connected server identity pass the V2 allowlist. Applied
migrations are immutable: the stored SHA-256 must match the current file or migration stops
before executing SQL. No V1 migration directory is read by the V2 migrator.

Migration `0003_live_settlement.sql` upgrades the existing JSONB world in place. It adds the
server-owned catch-up timestamp and schema version, stable storage/tree IDs, nullable active
worker task, and building footprint/stage/progress/material-reservation fields. Migration
`0004_forest_sources.sql` retains the existing singleton tree as `tree-1` with its exact position
and remainder, then adds two finite sources and one baseline-renewable coppice. `0005_two_residents.sql`
converts the existing worker in-place to the resident collection and adds stable `worker-2` only if it
is absent. `0006_continuous_woodcutting.sql` adds a 100-log store capacity, applies the selected
100-tick regrowth interval to trees that had no rate, preserves the coppice's existing 1,200-tick
rate, and upgrades saved gather tasks to continuous work while keeping recovered-cargo deliveries
one-shot. It preserves resources, active tasks/cargo, trees, buildings and command history; it does
not delete or reseed a saved world. Its schema-version guard makes the transformation safe if
reapplied manually. `0006` was verified idempotent on `avanpost_v2_test` and applied in place to
`avanpost_v2_dev` after explicit owner confirmation.

Migration `0007_work_roles_build_queue.sql` adds persistent `workRole` values and an independent
construction-order queue to each saved world in place. It links every existing building and active
construction task to a stable order ID and converts a material-waiting construction task into a
waiting queue order. It upgrades schema 5 to schema 6 and preserves resources, cargo, tree state,
building progress, and command history. Migration `0008_preserve_legacy_work_intents.sql` corrects
pre-release inference from legacy task state: old gather tasks stay manual and no persistent work
role is inferred from a saved task. Together, they preserve the schema-6 snapshot shape and avoid
granting work roles the owner did not choose. Both run before any dev-world rollout.
