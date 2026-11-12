-- Event history is persisted inside each world JSONB snapshot. Advance schema
-- metadata for worlds written before the explicit accounting-event field.
UPDATE peace_v2_world_state
SET state_schema_version = 16,
    updated_at = now()
WHERE state_schema_version = 15;
