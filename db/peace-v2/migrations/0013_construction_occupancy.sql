-- G5.1 persists surface layout metadata and enforces one owner per occupied cell.
CREATE TABLE peace_v2_occupied_cell (
  world_id text NOT NULL,
  cell_x integer NOT NULL,
  cell_y integer NOT NULL,
  entity_id text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('building', 'warehouse')),
  layout_version integer NOT NULL CHECK (layout_version > 0),
  PRIMARY KEY (world_id, cell_x, cell_y)
);

WITH schema_ten_worlds AS (
  SELECT world_id, state
  FROM peace_v2_world_state
  WHERE state_schema_version = 10
)
UPDATE peace_v2_world_state AS world
SET world_version = world.world_version + 1,
    geometry_version = world.geometry_version + 1,
    state_schema_version = 11,
    state = schema_ten_worlds.state || jsonb_build_object(
      'surfaceCells', COALESCE(schema_ten_worlds.state->'surfaceCells', (
        SELECT jsonb_agg(jsonb_build_object(
          'position', jsonb_build_object('x', x, 'y', 0),
          'supportsBuilding', true,
          'walkable', true
        ) ORDER BY x)
        FROM generate_series(-24, 24) AS x
      )),
      'buildings', COALESCE((
        SELECT jsonb_agg(
          building || jsonb_build_object(
            'entrance', COALESCE(building->'entrance', jsonb_build_object(
              'x', (building->'anchor'->>'x')::integer + (building->'footprint'->>'width')::integer,
              'y', (building->'anchor'->>'y')::integer + (building->'footprint'->>'height')::integer
            )),
            'workPoint', COALESCE(building->'workPoint', jsonb_build_object(
              'x', (building->'anchor'->>'x')::integer + (building->'footprint'->>'width')::integer,
              'y', (building->'anchor'->>'y')::integer + (building->'footprint'->>'height')::integer
            )),
            'layoutVersion', COALESCE((building->>'layoutVersion')::integer, 1),
            'accessibility', COALESCE(building->>'accessibility', 'accessible'),
            'accessibilityReason', COALESCE(building->'accessibilityReason', 'null'::jsonb),
            'reservedReturnWood', COALESCE((building->>'reservedReturnWood')::integer, 0),
            'reservedReturnStone', COALESCE((building->>'reservedReturnStone')::integer, 0)
          )
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(COALESCE(schema_ten_worlds.state->'buildings', '[]'::jsonb))
          WITH ORDINALITY AS rows(building, ordinal)
      ), '[]'::jsonb)
    ),
    updated_at = now()
FROM schema_ten_worlds
WHERE world.world_id = schema_ten_worlds.world_id
  AND world.state_schema_version = 10;

WITH occupied_entities AS (
  SELECT world.world_id, building->>'id' AS entity_id, 'building'::text AS entity_kind,
         COALESCE((building->>'layoutVersion')::integer, 1) AS layout_version,
         (building->'anchor'->>'x')::integer AS anchor_x,
         (building->'anchor'->>'y')::integer AS anchor_y,
         (building->'footprint'->>'width')::integer AS width,
         (building->'footprint'->>'height')::integer AS height
  FROM peace_v2_world_state AS world
  CROSS JOIN LATERAL jsonb_array_elements(world.state->'buildings') AS building
  WHERE world.state_schema_version = 11 AND building->>'state' <> 'cancelled'
  UNION ALL
  SELECT world.world_id, storage->>'id' AS entity_id, 'warehouse'::text AS entity_kind, 1 AS layout_version,
         (storage->'anchor'->>'x')::integer AS anchor_x,
         (storage->'anchor'->>'y')::integer AS anchor_y,
         (storage->'footprint'->>'width')::integer AS width,
         (storage->'footprint'->>'height')::integer AS height
  FROM peace_v2_world_state AS world
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(world.state->'storages', '[]'::jsonb)) AS storage
  WHERE world.state_schema_version = 11
  UNION ALL
  SELECT world.world_id, world.state->'storage'->>'id' AS entity_id, 'warehouse'::text AS entity_kind, 1 AS layout_version,
         (world.state->'storage'->'anchor'->>'x')::integer AS anchor_x,
         (world.state->'storage'->'anchor'->>'y')::integer AS anchor_y,
         (world.state->'storage'->'footprint'->>'width')::integer AS width,
         (world.state->'storage'->'footprint'->>'height')::integer AS height
  FROM peace_v2_world_state AS world
  WHERE world.state_schema_version = 11 AND jsonb_array_length(COALESCE(world.state->'storages', '[]'::jsonb)) = 0
)
INSERT INTO peace_v2_occupied_cell (world_id, cell_x, cell_y, entity_id, entity_kind, layout_version)
SELECT entity.world_id, entity.anchor_x + x, entity.anchor_y + y, entity.entity_id, entity.entity_kind, entity.layout_version
FROM occupied_entities AS entity
CROSS JOIN LATERAL generate_series(0, entity.width - 1) AS x
CROSS JOIN LATERAL generate_series(0, entity.height - 1) AS y;
