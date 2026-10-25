# Peace V2 migrations

Add ordered `NNNN_description.sql` migrations here. The V2 migrator connects only after the
operation-specific database URL and connected server identity pass the V2 allowlist. Applied
migrations are immutable: the stored SHA-256 must match the current file or migration stops
before executing SQL. No V1 migration directory is read by the V2 migrator.
