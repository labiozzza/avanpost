ALTER TABLE peace_v2_lite_world_commands
  ALTER COLUMN request_id TYPE text USING request_id::text;
