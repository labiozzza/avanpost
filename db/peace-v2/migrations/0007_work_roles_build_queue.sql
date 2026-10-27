-- Add temporary G3.2 work roles and an independent durable construction queue.
-- Preserve all resource, tree, cargo and building-progress state in place.
WITH source_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version < 6
), building_rows AS (
  SELECT
    source_worlds.world_id,
    building_rows.building,
    building_rows.ordinal,
    COALESCE(building_rows.building->>'orderId', 'order-' || (building_rows.building->>'id')) AS order_id,
    assigned.resident_id,
    assigned.task
  FROM source_worlds
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(source_worlds.state->'buildings', '[]'::jsonb))
    WITH ORDINALITY AS building_rows(building, ordinal)
  LEFT JOIN LATERAL (
    SELECT resident->>'id' AS resident_id, resident->'task' AS task
    FROM jsonb_array_elements(COALESCE(source_worlds.state->'residents', '[]'::jsonb)) AS residents(resident)
    WHERE resident->'task'->>'kind' = 'build-cabin'
      AND resident->'task'->>'buildingId' = building_rows.building->>'id'
    LIMIT 1
  ) AS assigned ON true
), buildings_by_world AS (
  SELECT world_id, jsonb_agg(
    building || jsonb_build_object('orderId', order_id) ORDER BY ordinal
  ) AS buildings
  FROM building_rows
  GROUP BY world_id
), orders_by_world AS (
  SELECT world_id, jsonb_agg(
    jsonb_build_object(
      'id', order_id,
      'buildingId', building->>'id',
      'queuePosition', (ordinal - 1)::integer,
      'status', CASE
        WHEN building->>'state' = 'complete' THEN 'completed'
        WHEN building->>'state' = 'cancelled' THEN 'cancelled'
        WHEN task->>'kind' = 'build-cabin' AND task->>'phase' = 'blocked' THEN 'blocked'
        WHEN task->>'kind' = 'build-cabin' AND task->>'phase' = 'waiting_materials' THEN 'waiting_materials'
        WHEN task->>'kind' = 'build-cabin' AND task->>'phase' = 'waiting_path' THEN 'waiting_path'
        WHEN task->>'kind' = 'build-cabin' THEN 'in_progress'
        WHEN building->>'state' = 'waiting_materials' THEN 'waiting_materials'
        WHEN COALESCE((building->>'reservedWood')::integer, 0) >= 3 THEN 'waiting_builder'
        ELSE 'waiting_materials'
      END,
      'assignedResidentId', CASE
        WHEN task->>'kind' = 'build-cabin' AND task->>'phase' <> 'waiting_materials' THEN resident_id
        ELSE NULL
      END,
      'blockedReason', CASE
        WHEN task->>'kind' = 'build-cabin' THEN task->>'blockedReason'
        WHEN building->>'state' = 'waiting_materials' THEN 'INSUFFICIENT_WOOD'
        WHEN COALESCE((building->>'reservedWood')::integer, 0) < 3 THEN 'INSUFFICIENT_WOOD'
        ELSE NULL
      END
    ) ORDER BY ordinal
  ) AS build_orders
  FROM building_rows
  GROUP BY world_id
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 6,
    state = world.state || jsonb_build_object(
      'residents', COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN resident->'task'->>'kind' = 'build-cabin' AND resident->'task'->>'phase' = 'waiting_materials' THEN
              resident || jsonb_build_object(
                'workRole', COALESCE(resident->>'workRole', 'builder'),
                'task', 'null'::jsonb,
                'state', 'waiting',
                'visualState', 'waiting_materials',
                'blockedReason', 'INSUFFICIENT_WOOD'
              )
            WHEN resident->'task'->>'kind' = 'build-cabin' THEN
              resident || jsonb_build_object(
                'workRole', COALESCE(resident->>'workRole', 'builder'),
                'task', (resident->'task') || jsonb_build_object(
                  'orderId', COALESCE(resident->'task'->>'orderId', 'order-' || (resident->'task'->>'buildingId'))
                )
              )
            WHEN resident->'task'->>'kind' = 'gather-wood' THEN
              resident || jsonb_build_object(
                'workRole', CASE
                  WHEN COALESCE((resident->'task'->>'continuous')::boolean, true)
                    AND NOT COALESCE((resident->'task'->>'cancelAfterDelivery')::boolean, false)
                    THEN COALESCE(resident->>'workRole', 'woodcutter')
                  ELSE COALESCE(resident->>'workRole', 'none')
                END,
                'task', (resident->'task') || jsonb_build_object(
                  'continuous', COALESCE((resident->'task'->>'continuous')::boolean, true),
                  'cancelAfterDelivery', COALESCE((resident->'task'->>'cancelAfterDelivery')::boolean, false),
                  'assignmentSource', CASE
                    WHEN COALESCE((resident->'task'->>'continuous')::boolean, true)
                      AND NOT COALESCE((resident->'task'->>'cancelAfterDelivery')::boolean, false)
                      THEN 'profession'
                    ELSE 'manual'
                  END
                )
              )
            ELSE resident || jsonb_build_object('workRole', COALESCE(resident->>'workRole', 'none'))
          END ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(world.state->'residents', '[]'::jsonb)) WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb),
      'buildings', COALESCE(buildings_by_world.buildings, '[]'::jsonb),
      'buildOrders', COALESCE(orders_by_world.build_orders, '[]'::jsonb),
      'nextBuildOrderSequence', GREATEST(
        1,
        COALESCE((world.state->>'nextBuildOrderSequence')::integer,
          jsonb_array_length(COALESCE(world.state->'buildings', '[]'::jsonb)))
      )
    ),
    updated_at = now()
FROM source_worlds
LEFT JOIN buildings_by_world ON buildings_by_world.world_id = source_worlds.world_id
LEFT JOIN orders_by_world ON orders_by_world.world_id = source_worlds.world_id
WHERE world.world_id = source_worlds.world_id
  AND world.state_schema_version < 6;
