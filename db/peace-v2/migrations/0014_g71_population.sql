-- G7.1 adds persistent resident identity/experience/housing and tunable migration state.
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 12,
    state = world.state || jsonb_build_object(
      'populationMigration', COALESCE(world.state->'populationMigration', jsonb_build_object(
        'progressTicks', 0,
        'progressRequired', 60,
        'nextResidentSequence', 1,
        'pendingResidentId', NULL,
        'attraction', 'no_housing',
        'lastArrivalTick', NULL
      )),
      'residents', COALESCE((
        SELECT jsonb_agg(resident || jsonb_build_object(
          'createdAtTick', COALESCE((resident->>'createdAtTick')::integer, 0),
          'arrivedAtTick', COALESCE(resident->'arrivedAtTick', '0'::jsonb),
          'civilianProfession', COALESCE(resident->'civilianProfession', '"general_worker"'::jsonb),
          'civilianXp', COALESCE((resident->>'civilianXp')::integer, 0),
          'learningHistory', COALESCE(resident->'learningHistory', '[]'::jsonb),
          'innateTraits', COALESCE(resident->'innateTraits', '[]'::jsonb),
          'characteristics', COALESCE(resident->'characteristics', '{"strength":5,"dexterity":5,"endurance":5,"intelligence":5}'::jsonb),
          'housingBuildingId', COALESCE(resident->'housingBuildingId', 'null'::jsonb),
          'arrivalState', COALESCE(resident->'arrivalState', '"settled"'::jsonb)
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(world.state->'residents', '[]'::jsonb))
          WITH ORDINALITY AS rows(resident, ordinal)
      ), '[]'::jsonb),
      'buildings', COALESCE((
        SELECT jsonb_agg(building || jsonb_build_object(
          'housingCapacity', CASE WHEN building->>'kind' = 'cabin'
            THEN COALESCE((building->>'housingCapacity')::integer, 4) ELSE 0 END
        ) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(world.state->'buildings', '[]'::jsonb))
          WITH ORDINALITY AS rows(building, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
WHERE world.state_schema_version = 11;
