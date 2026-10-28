-- G3.3 preliminary slice only: preserve the saved world while adding a typed
-- stone stock, one finite surface-accessible node and resource-typed resident cargo.
-- Approved balance is recorded in content/peace-v2/g3.3-stone.json.
WITH source_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version = 6
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    geometry_version = world.geometry_version + 1,
    state_schema_version = 7,
    state = world.state || jsonb_build_object(
      'resources', COALESCE(source_worlds.state->'resources', '{}'::jsonb) || jsonb_build_object(
        'stone', COALESCE((source_worlds.state->'resources'->>'stone')::integer, 0)
      ),
      'storage', (COALESCE(source_worlds.state->'storage', '{}'::jsonb) - 'woodCapacity') || jsonb_build_object(
        'capacity', COALESCE((source_worlds.state->'storage'->>'capacity')::integer,
          (source_worlds.state->'storage'->>'woodCapacity')::integer, 100)
      ),
      'residents', COALESCE((
        SELECT jsonb_agg(
          resident || jsonb_build_object(
            'cargoItemId', CASE
              WHEN COALESCE((resident->>'cargo')::integer, 0) > 0 THEN COALESCE(resident->>'cargoItemId', 'wood')
              ELSE NULL
            END
          ) ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(source_worlds.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb),
      'buildings', COALESCE((
        SELECT jsonb_agg(
          building || jsonb_build_object('reservedStone', COALESCE((building->>'reservedStone')::integer, 0))
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(source_worlds.state->'buildings', '[]'::jsonb))
          WITH ORDINALITY AS rows(building, ordinal)
      ), '[]'::jsonb),
      'stoneDeposits', COALESCE(source_worlds.state->'stoneDeposits', jsonb_build_array(jsonb_build_object(
        'id', 'stone-vein-1',
        'name', 'Каменная жила',
        'sourceKind', 'finite',
        'position', jsonb_build_object('x', 5, 'y', 1),
        'remaining', 600,
        'maxRemaining', 600,
        'bufferQuantity', 0,
        'bufferCapacity', 18,
        'yieldPerTick', 3,
        'state', 'available'
      )))
    ),
    updated_at = now()
FROM source_worlds
WHERE world.world_id = source_worlds.world_id
  AND world.state_schema_version = 6;
