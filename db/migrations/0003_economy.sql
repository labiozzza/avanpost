CREATE TABLE storage (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES world_sector(id) ON DELETE CASCADE,
  type text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  capacity integer NOT NULL CHECK (capacity > 0),
  volume integer NOT NULL DEFAULT 0 CHECK (volume >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (volume + reserved <= capacity),
  UNIQUE (sector_id, x, y)
);

CREATE TABLE storage_item (
  storage_id uuid NOT NULL REFERENCES storage(id) ON DELETE CASCADE,
  item text NOT NULL,
  qty integer NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (storage_id, item)
);

CREATE TABLE resource_node (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES world_sector(id) ON DELETE CASCADE,
  kind text NOT NULL,
  item text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  max_amount integer NOT NULL CHECK (max_amount >= 0),
  renewable boolean NOT NULL DEFAULT false,
  regen_per_tick integer NOT NULL DEFAULT 0 CHECK (regen_per_tick >= 0),
  yield_per_tick integer NOT NULL CHECK (yield_per_tick > 0),
  buffer integer NOT NULL DEFAULT 0 CHECK (buffer >= 0),
  buffer_reserved integer NOT NULL DEFAULT 0 CHECK (buffer_reserved >= 0),
  buffer_capacity integer NOT NULL CHECK (buffer_capacity > 0),
  active boolean NOT NULL DEFAULT false,
  gatherer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buffer <= buffer_capacity),
  CHECK (buffer_reserved <= buffer),
  UNIQUE (sector_id, x, y)
);

CREATE TABLE laborer (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('gatherer', 'carrier')),
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'gathering', 'hauling')),
  x integer NOT NULL,
  y integer NOT NULL,
  node_id uuid REFERENCES resource_node(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE resource_node
  ADD CONSTRAINT resource_node_gatherer_fk
  FOREIGN KEY (gatherer_id) REFERENCES laborer(id) ON DELETE SET NULL;

CREATE TABLE haul_task (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES resource_node(id) ON DELETE CASCADE,
  storage_id uuid NOT NULL REFERENCES storage(id) ON DELETE CASCADE,
  item text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  carrier_id uuid REFERENCES laborer(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'queued', 'reserved', 'worker_to_source', 'loading',
    'moving', 'unloading', 'complete', 'blocked', 'failed', 'retryable'
  )),
  path_to_source jsonb NOT NULL,
  path_to_storage jsonb NOT NULL,
  path_index integer NOT NULL DEFAULT 0,
  state_ticks integer NOT NULL DEFAULT 0,
  reserved_source integer NOT NULL CHECK (reserved_source > 0),
  reserved_destination integer NOT NULL CHECK (reserved_destination > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX storage_owner_idx ON storage (owner_id);
CREATE INDEX resource_node_owner_idx ON resource_node (owner_id);
CREATE INDEX laborer_owner_idx ON laborer (owner_id);
CREATE INDEX haul_task_owner_status_idx ON haul_task (owner_id, status);
