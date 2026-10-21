-- Migration: crafting stations and research (GDD 3.3, 6.1).
-- A production building buffers inputs (delivered from storage) and outputs
-- (produced, then hauled back to storage). Research points live on the player;
-- a research_project tracks the single active node (stage I.5).

-- Research Points accrue only while an academy has an assigned scientist.
ALTER TABLE players
  ADD COLUMN research_points integer NOT NULL DEFAULT 0 CHECK (research_points >= 0);

-- Production stations move goods between storage and their buffer, so the
-- transfer task must be able to target a building buffer (not just materials).
ALTER TABLE transfer_task DROP CONSTRAINT transfer_task_direction_check;
ALTER TABLE transfer_task
  ADD CONSTRAINT transfer_task_direction_check
  CHECK (direction IN ('to_building', 'to_storage', 'to_buffer', 'from_buffer'));

-- Per-building item buffer for craft stations (inputs + produced outputs).
CREATE TABLE building_buffer (
  building_id uuid NOT NULL REFERENCES building(id) ON DELETE CASCADE,
  item text NOT NULL,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (building_id, item)
);

-- One active craft order per station (stage I.5 keeps it to a single recipe).
CREATE TABLE craft_order (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES building(id) ON DELETE CASCADE,
  recipe_id text NOT NULL,
  worker_id uuid REFERENCES resident(id) ON DELETE SET NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  work_required integer NOT NULL CHECK (work_required > 0),
  status text NOT NULL CHECK (status IN ('active', 'blocked', 'complete', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX craft_order_owner_status_idx ON craft_order (owner_id, status);
CREATE INDEX craft_order_building_idx ON craft_order (building_id);
CREATE UNIQUE INDEX craft_order_active_building_idx
  ON craft_order (building_id)
  WHERE status IN ('active', 'blocked');

-- Researched technologies: which nodes the owner has unlocked.
CREATE TABLE researched_technology (
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  technology_id text NOT NULL,
  researched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, technology_id)
);

-- The single in-progress research project (stage I.5: max_parallel_projects = 1).
CREATE TABLE research_project (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  technology_id text NOT NULL,
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
  cost integer NOT NULL CHECK (cost > 0),
  scholar_id uuid REFERENCES resident(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'complete', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_project_owner_status_idx ON research_project (owner_id, status);
CREATE UNIQUE INDEX research_project_active_owner_idx
  ON research_project (owner_id)
  WHERE status IN ('active', 'paused');
