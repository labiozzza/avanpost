-- G7.2 adds school capacity, persisted enrollment queue and physically delivered study stock.
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 13,
    state = world.state || jsonb_build_object(
      'buildings', COALESCE((
        SELECT jsonb_agg(building || jsonb_build_object(
          'trainingCapacity', COALESCE((building->>'trainingCapacity')::integer,
            CASE WHEN building->>'kind' LIKE 'school-%' THEN 2 ELSE 0 END),
          'trainingQueue', COALESCE(building->'trainingQueue', '[]'::jsonb),
          'trainingMaterialsWood', COALESCE((building->>'trainingMaterialsWood')::integer, 0),
          'reservedTrainingWood', COALESCE((building->>'reservedTrainingWood')::integer, 0)
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(world.state->'buildings', '[]'::jsonb))
          WITH ORDINALITY AS rows(building, ordinal)
      ), '[]'::jsonb),
      'residents', COALESCE((
        SELECT jsonb_agg(resident || jsonb_build_object(
          'civilianProfession', COALESCE(resident->'civilianProfession', '"general_worker"'::jsonb),
          'learningHistory', COALESCE(resident->'learningHistory', '[]'::jsonb),
          'trainingProgress', COALESCE(resident->'trainingProgress', '[]'::jsonb),
          'civilianXp', COALESCE((resident->>'civilianXp')::integer, 0)
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(world.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
WHERE world.state_schema_version = 12;
