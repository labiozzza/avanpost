CREATE TABLE players (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  current_phase text NOT NULL DEFAULT 'peace' CHECK (current_phase IN ('peace', 'war')),
  display_name text
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_player_id_idx ON sessions (player_id);

CREATE TABLE world_sector (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  biome text NOT NULL,
  unlock_state text NOT NULL DEFAULT 'unlocked' CHECK (unlock_state IN ('locked', 'prepared', 'unlocked')),
  seed integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, x, y)
);

CREATE TABLE world_state (
  owner_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  tick integer NOT NULL DEFAULT 0 CHECK (tick >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terrain_cell (
  sector_id uuid NOT NULL REFERENCES world_sector(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  terrain_type text NOT NULL,
  obstacle boolean NOT NULL DEFAULT false,
  passable boolean NOT NULL DEFAULT true,
  PRIMARY KEY (sector_id, x, y)
);

CREATE TABLE command_log (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  command_type text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, request_id)
);

CREATE TABLE outbox_event (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_event_player_idx ON outbox_event (player_id, id);
