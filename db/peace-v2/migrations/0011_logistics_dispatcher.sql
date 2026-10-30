-- G4.2 adds a durable server-owned queue over the existing per-carrier haul tasks.
WITH schema_eight_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version = 8
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 9,
    state = schema_eight_worlds.state || jsonb_build_object(
      'logisticsTasks', COALESCE(schema_eight_worlds.state->'logisticsTasks', '[]'::jsonb),
      'logisticsPolicy', COALESCE(schema_eight_worlds.state->'logisticsPolicy', jsonb_build_object(
        'priorityOrder', jsonb_build_array(
          'active_construction', 'ready_construction', 'buffer_clearance', 'warehouse_restock', 'rebalancing'
        ),
        'carryCapacity', NULL
      )),
      'nextLogisticsSequence', COALESCE((schema_eight_worlds.state->>'nextLogisticsSequence')::integer, 1),
      'residents', COALESCE((
        SELECT jsonb_agg(
          CASE WHEN resident->'task'->>'kind' = 'haul'
            THEN resident || jsonb_build_object(
              'task', (resident->'task') || jsonb_build_object('logisticsTaskId', NULL)
            )
            ELSE resident
          END
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(schema_eight_worlds.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
FROM schema_eight_worlds
WHERE world.world_id = schema_eight_worlds.world_id
  AND world.state_schema_version = 8;
