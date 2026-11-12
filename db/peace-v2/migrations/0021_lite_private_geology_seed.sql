-- The private geology seed is lazily generated and persisted with each world
-- under the server transaction. This migration advances state metadata only.
UPDATE peace_v2_world_state
SET state_schema_version = 15,
    updated_at = now()
WHERE state_schema_version = 14;
