ALTER TABLE laborer DROP CONSTRAINT laborer_role_check;
ALTER TABLE laborer
  ADD CONSTRAINT laborer_role_check
  CHECK (role IN ('gatherer', 'carrier', 'builder'));

ALTER TABLE laborer DROP CONSTRAINT laborer_status_check;
ALTER TABLE laborer
  ADD CONSTRAINT laborer_status_check
  CHECK (status IN ('idle', 'gathering', 'hauling', 'building'));

CREATE TABLE building (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES world_sector(id) ON DELETE CASCADE,
  type text NOT NULL,
  x integer NOT NULL CHECK (x >= 0),
  y integer NOT NULL CHECK (y >= 0),
  status text NOT NULL CHECK (status IN (
    'awaiting_materials', 'building', 'complete', 'demolition', 'demolished'
  )),
  work_done integer NOT NULL DEFAULT 0 CHECK (work_done >= 0),
  work_required integer NOT NULL CHECK (work_required > 0),
  workers_limit integer NOT NULL DEFAULT 0 CHECK (workers_limit >= 0),
  builder_id uuid REFERENCES laborer(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX building_occupied_idx
  ON building (sector_id, x, y)
  WHERE status <> 'demolished';
CREATE INDEX building_owner_status_idx ON building (owner_id, status);
CREATE INDEX building_builder_idx ON building (builder_id);

CREATE TABLE building_material (
  building_id uuid NOT NULL REFERENCES building(id) ON DELETE CASCADE,
  item text NOT NULL,
  required integer NOT NULL CHECK (required > 0),
  delivered integer NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  PRIMARY KEY (building_id, item),
  CHECK (delivered <= required)
);

CREATE TABLE transfer_task (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES building(id) ON DELETE CASCADE,
  storage_id uuid NOT NULL REFERENCES storage(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('to_building', 'to_storage')),
  item text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  carrier_id uuid REFERENCES laborer(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'queued', 'reserved', 'worker_to_source', 'loading',
    'moving', 'unloading', 'complete', 'failed'
  )),
  path_from jsonb NOT NULL,
  path_to jsonb NOT NULL,
  path_index integer NOT NULL DEFAULT 0,
  state_ticks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transfer_task_owner_status_idx ON transfer_task (owner_id, status);
CREATE INDEX transfer_task_building_idx ON transfer_task (building_id);
