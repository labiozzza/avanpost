-- Promote the single saved worker to the resident collection and add a second
-- stable starter resident. Preserve all existing resident/task/resource/building
-- state. The row guard makes the transformation safe to re-run without duplicates.
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    geometry_version = world.geometry_version + 1,
    state_schema_version = 4,
    state = (world.state - 'worker') || jsonb_build_object(
      'residents', CASE
        WHEN jsonb_typeof(world.state->'residents') = 'array' THEN
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM jsonb_array_elements(world.state->'residents') AS resident
              WHERE resident->>'id' = 'worker-2'
            ) THEN world.state->'residents'
            ELSE world.state->'residents' || jsonb_build_array(
              jsonb_build_object(
                'id', 'worker-2', 'name', 'Марья', 'appearanceKey', 'maria',
                'position', jsonb_build_object('x', 14, 'y', 0), 'facing', 'left',
                'state', 'idle', 'visualState', 'idle', 'cargo', 0, 'blockedReason', NULL, 'task', NULL
              )
            )
          END
        ELSE jsonb_build_array(
          COALESCE(world.state->'worker', '{}'::jsonb) || jsonb_build_object(
            'appearanceKey', 'ilya',
            'facing', CASE
              WHEN jsonb_typeof(world.state->'worker'->'task'->'path') = 'array' AND
                   jsonb_array_length(world.state->'worker'->'task'->'path') >
                     COALESCE((world.state->'worker'->'task'->>'pathIndex')::integer, 0) AND
                   COALESCE((world.state->'worker'->'task'->'path'->
                     COALESCE((world.state->'worker'->'task'->>'pathIndex')::integer, 0)->>'x')::integer,
                     (world.state->'worker'->'position'->>'x')::integer) <
                   (world.state->'worker'->'position'->>'x')::integer THEN 'left'
              ELSE 'right'
            END,
            'state', CASE
              WHEN world.state->'worker'->'task' IS NULL OR world.state->'worker'->'task' = 'null'::jsonb THEN 'idle'
              WHEN world.state->'worker'->'task'->>'phase' = 'blocked' THEN 'blocked'
              WHEN world.state->'worker'->'task'->>'phase' IN
                ('waiting_path', 'waiting_resource', 'waiting_materials') THEN 'waiting'
              ELSE 'working'
            END,
            'blockedReason', COALESCE(world.state->'worker'->'task'->'blockedReason', 'null'::jsonb)
          ),
          jsonb_build_object(
            'id', 'worker-2', 'name', 'Марья', 'appearanceKey', 'maria',
            'position', jsonb_build_object('x', 14, 'y', 0), 'facing', 'left',
            'state', 'idle', 'visualState', 'idle', 'cargo', 0, 'blockedReason', NULL, 'task', NULL
          )
        )
      END
    ),
    updated_at = now()
WHERE (world.state ? 'worker' OR jsonb_typeof(world.state->'residents') = 'array')
  AND NOT (
    jsonb_typeof(world.state->'residents') = 'array' AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(world.state->'residents') AS resident
      WHERE resident->>'id' = 'worker-2'
    )
  );
