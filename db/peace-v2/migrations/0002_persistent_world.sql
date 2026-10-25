CREATE TABLE peace_v2_world_state (
  world_id text PRIMARY KEY,
  world_version integer NOT NULL CHECK (world_version >= 0),
  geometry_version integer NOT NULL CHECK (geometry_version >= 0),
  server_tick integer NOT NULL CHECK (server_tick >= 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE peace_v2_sessions (
  token_hash char(64) PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE peace_v2_command_log (
  request_id text PRIMARY KEY,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO peace_v2_world_state (
  world_id, world_version, geometry_version, server_tick, state
) VALUES (
  'peace-home', 1, 1, 0,
  '{
    "resources":{"wood":1},
    "tree":{"position":{"x":3,"y":0},"remaining":3},
    "worker":{"id":"worker-1","name":"Илья","position":{"x":-3,"y":0},"visualState":"idle","cargo":0},
    "buildings":[]
  }'::jsonb
)
ON CONFLICT (world_id) DO NOTHING;
