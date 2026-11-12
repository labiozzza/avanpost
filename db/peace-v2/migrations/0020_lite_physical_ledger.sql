-- The JSON snapshot acquires an additive, versioned Lite physical-ledger field.
-- Backfill remains lazy and transactional in the server compatibility loader so
-- each legacy world is converted from its actual locations without losing cargo.
UPDATE peace_v2_world_state
SET state_schema_version = 14,
    updated_at = now()
WHERE state_schema_version = 13;
