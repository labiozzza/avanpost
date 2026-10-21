ALTER TABLE world_state ADD COLUMN world_seed integer NOT NULL DEFAULT 0;
UPDATE world_state SET world_seed = 1 + floor(random() * 2147483646)::int;

ALTER TABLE world_sector ADD COLUMN status text NOT NULL DEFAULT 'unlocked';
UPDATE world_sector SET status = CASE WHEN unlock_state = 'prepared' THEN 'prepared' ELSE 'unlocked' END;
UPDATE world_sector SET status = 'prepared' WHERE x = 0 AND y = 0;
ALTER TABLE world_sector
  ADD CONSTRAINT world_sector_status_check
  CHECK (status IN ('unknown', 'unlockable', 'unlocked', 'clearing', 'prepared', 'occupied'));
ALTER TABLE world_sector DROP COLUMN unlock_state;

CREATE TABLE clearing_job (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES world_sector(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  work_done integer NOT NULL DEFAULT 0 CHECK (work_done >= 0),
  work_required integer NOT NULL CHECK (work_required > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sector_id, x, y)
);

CREATE INDEX clearing_job_owner_status_idx ON clearing_job (owner_id, status);
