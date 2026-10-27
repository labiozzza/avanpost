-- G3.2 follow-up: do not infer durable work roles from G3.1.1 task state.
-- 0007 was already verified/applied in isolated test history, so correct its inferred
-- role/source values forward without changing the schema-6 snapshot shape.
WITH source_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version = 6
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state = world.state || jsonb_build_object(
      'residents', COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN resident->'task'->>'kind' = 'gather-wood' THEN
              resident || jsonb_build_object(
                'workRole', 'none',
                'task', (resident->'task') || jsonb_build_object('assignmentSource', 'manual')
              )
            ELSE resident || jsonb_build_object('workRole', 'none')
          END ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(source_worlds.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb),
      'buildOrders', COALESCE(source_worlds.state->'buildOrders', '[]'::jsonb),
      'nextBuildOrderSequence', GREATEST(1,
        COALESCE((source_worlds.state->>'nextBuildOrderSequence')::integer, 1))
    ),
    updated_at = now()
FROM source_worlds
WHERE world.world_id = source_worlds.world_id
  AND world.state_schema_version = 6;
