-- Preserve the exhausted singleton as tree-1, then add finite reachable woodland
-- sources and one slow baseline-renewable coppice. No warehouse inventory or
-- command-history row is added, removed, or rewritten.
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    geometry_version = world.geometry_version + 1,
    state_schema_version = 3,
    state = (world.state - 'tree') || jsonb_build_object(
      'trees', COALESCE(world.state->'trees', jsonb_build_array(
        COALESCE(world.state->'tree', '{}'::jsonb) || jsonb_build_object(
          'id', COALESCE(world.state->'tree'->>'id', 'tree-1'),
          'name', 'Старая берёза',
          'sourceKind', 'finite',
          'position', COALESCE(world.state->'tree'->'position', jsonb_build_object('x', 3, 'y', 0)),
          'remaining', COALESCE((world.state->'tree'->>'remaining')::integer, 0),
          'maxRemaining', 3,
          'state', CASE
            WHEN COALESCE((world.state->'tree'->>'remaining')::integer, 0) > 0 THEN 'standing'
            ELSE 'stump'
          END,
          'regrowthProgressTicks', 0,
          'regrowthEveryTicks', NULL
        ),
        jsonb_build_object(
          'id', 'tree-2', 'name', 'Восточная роща', 'sourceKind', 'finite',
          'position', jsonb_build_object('x', 8, 'y', 0), 'remaining', 3, 'maxRemaining', 3,
          'state', 'standing', 'regrowthProgressTicks', 0, 'regrowthEveryTicks', NULL
        ),
        jsonb_build_object(
          'id', 'tree-3', 'name', 'Западный склон', 'sourceKind', 'finite',
          'position', jsonb_build_object('x', -12, 'y', 0), 'remaining', 3, 'maxRemaining', 3,
          'state', 'standing', 'regrowthProgressTicks', 0, 'regrowthEveryTicks', NULL
        ),
        jsonb_build_object(
          'id', 'coppice-1', 'name', 'Возобновляемая поросль', 'sourceKind', 'renewable_plot',
          'position', jsonb_build_object('x', 16, 'y', 0), 'remaining', 1, 'maxRemaining', 1,
          'state', 'standing', 'regrowthProgressTicks', 0, 'regrowthEveryTicks', 1200
        )
      ))
    ),
    updated_at = now();
