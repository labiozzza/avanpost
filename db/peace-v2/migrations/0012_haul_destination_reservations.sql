-- G4.2 allows loaded cargo to wait without holding a full destination reservation.
WITH schema_nine_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version = 9
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 10,
    state = schema_nine_worlds.state || jsonb_build_object(
      'residents', COALESCE((
        SELECT jsonb_agg(
          CASE WHEN resident->'task'->>'kind' = 'haul'
            THEN resident || jsonb_build_object(
              'task', (resident->'task') || jsonb_build_object(
                'destinationReserved', COALESCE((resident->'task'->>'destinationReserved')::boolean, TRUE)
              )
            )
            ELSE resident
          END
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(schema_nine_worlds.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
FROM schema_nine_worlds
WHERE world.world_id = schema_nine_worlds.world_id
  AND world.state_schema_version = 9;
