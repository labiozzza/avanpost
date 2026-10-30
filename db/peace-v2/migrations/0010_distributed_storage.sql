-- G4.1 adds explicit warehouse inventories, source-buffer reservations and
-- resident haul tasks. Schema-7 stock remains in the existing primary warehouse.
WITH schema_seven_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version = 7
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 8,
    state = schema_seven_worlds.state || jsonb_build_object(
      'storages', COALESCE(schema_seven_worlds.state->'storages', jsonb_build_array(
        (schema_seven_worlds.state->'storage') || jsonb_build_object(
          'name', 'Склад',
          'kind', 'warehouse',
          'contents', schema_seven_worlds.state->'resources',
          'reservedInbound', jsonb_build_object('wood', 0, 'stone', 0),
          'reservedOutbound', jsonb_build_object('wood', 0, 'stone', 0),
          'status', CASE
            WHEN COALESCE((schema_seven_worlds.state->'resources'->>'wood')::integer, 0) +
                 COALESCE((schema_seven_worlds.state->'resources'->>'stone')::integer, 0) >=
                 COALESCE((schema_seven_worlds.state->'storage'->>'capacity')::integer, 100)
              THEN 'full' ELSE 'available' END,
          'blockedReason', NULL
        )
      )),
      'trees', COALESCE((
        SELECT jsonb_agg(tree || jsonb_build_object(
          'bufferQuantity', COALESCE((tree->>'bufferQuantity')::integer, 0),
          'bufferCapacity', COALESCE((tree->>'bufferCapacity')::integer, 1),
          'reservedBuffer', COALESCE((tree->>'reservedBuffer')::integer, 0)
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(schema_seven_worlds.state->'trees', '[]'::jsonb))
          WITH ORDINALITY AS rows(tree, ordinal)
      ), '[]'::jsonb),
      'stoneDeposits', COALESCE((
        SELECT jsonb_agg(deposit || jsonb_build_object(
          'reservedBuffer', COALESCE((deposit->>'reservedBuffer')::integer, 0)
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(schema_seven_worlds.state->'stoneDeposits', '[]'::jsonb))
          WITH ORDINALITY AS rows(deposit, ordinal)
      ), '[]'::jsonb),
      'residents', COALESCE((
        SELECT jsonb_agg(resident || jsonb_build_object(
          'preferredStorageId', COALESCE(resident->'preferredStorageId', schema_seven_worlds.state->'storage'->'id')
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(schema_seven_worlds.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb),
      'buildings', COALESCE((
        SELECT jsonb_agg(building || jsonb_build_object(
          'inTransitWood', COALESCE((building->>'inTransitWood')::integer, 0),
          'inTransitStone', COALESCE((building->>'inTransitStone')::integer, 0)
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(schema_seven_worlds.state->'buildings', '[]'::jsonb))
          WITH ORDINALITY AS rows(building, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
FROM schema_seven_worlds
WHERE world.world_id = schema_seven_worlds.world_id
  AND world.state_schema_version = 7;
