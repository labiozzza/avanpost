-- Preserve the world while enabling persistent woodcutting, per-log tree
-- regrowth, safe storage capacity and permanent stump removal.
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    state_schema_version = 5,
    state = world.state || jsonb_build_object(
      'storage', COALESCE(world.state->'storage', '{}'::jsonb) || jsonb_build_object(
        'woodCapacity', COALESCE((world.state->'storage'->>'woodCapacity')::integer, 100)
      ),
      'trees', COALESCE((
        SELECT jsonb_agg(
          tree || jsonb_build_object(
            'regrowthProgressTicks', COALESCE((tree->>'regrowthProgressTicks')::integer, 0),
            'regrowthEveryTicks', COALESCE((tree->>'regrowthEveryTicks')::integer, 100)
          ) ORDER BY ordinal
        )
        FROM jsonb_array_elements(world.state->'trees') WITH ORDINALITY AS tree_rows(tree, ordinal)
      ), '[]'::jsonb),
      'residents', COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN resident->'task'->>'kind' = 'gather-wood' THEN
              resident || jsonb_build_object(
                'task', (resident->'task') || jsonb_build_object(
                  'continuous', CASE
                    WHEN resident->'task'->>'sourceId' = 'recovered-cargo' THEN false
                    ELSE COALESCE((resident->'task'->>'continuous')::boolean, true)
                  END,
                  'cancelAfterDelivery', COALESCE((resident->'task'->>'cancelAfterDelivery')::boolean, false)
                )
              )
            ELSE resident
          END ORDER BY ordinal
        )
        FROM jsonb_array_elements(world.state->'residents') WITH ORDINALITY AS resident_rows(resident, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
WHERE world.state_schema_version < 5;
