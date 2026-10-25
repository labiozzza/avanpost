ALTER TABLE peace_v2_world_state
  ADD COLUMN last_simulated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN state_schema_version integer NOT NULL DEFAULT 1 CHECK (state_schema_version > 0);

UPDATE peace_v2_world_state AS world
SET state_schema_version = 2,
    state = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            world.state,
            '{tree}',
            COALESCE(world.state->'tree', '{}'::jsonb) || jsonb_build_object('id', 'tree-1'),
            true
          ),
          '{storage}',
          COALESCE(world.state->'storage', jsonb_build_object(
            'id', 'storehouse-1',
            'anchor', jsonb_build_object('x', -6, 'y', -1),
            'footprint', jsonb_build_object('width', 2, 'height', 1)
          )),
          true
        ),
        '{worker}',
        COALESCE(world.state->'worker', '{}'::jsonb) || jsonb_build_object(
          'task', NULL,
          'visualState', CASE
            WHEN COALESCE((world.state->'worker'->>'cargo')::integer, 0) > 0 THEN 'carrying_to_storage'
            ELSE 'idle'
          END
        ),
        true
      ),
      '{buildings}',
      COALESCE((
        SELECT jsonb_agg(
          building || jsonb_build_object(
            'footprint', COALESCE(building->'footprint', jsonb_build_object('width', 2, 'height', 1)),
            'state', COALESCE(building->>'state', 'complete'),
            'progressTicks', 10,
            'progressRequired', 10,
            'reservedWood', 0
          )
        )
        FROM jsonb_array_elements(COALESCE(world.state->'buildings', '[]'::jsonb)) AS expanded(building)
      ), '[]'::jsonb),
      true
    );
