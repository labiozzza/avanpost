-- Migration: track the last tick a resident arrived, so immigration is paced
-- (GDD 2.2, line 91: limit on waiting / calm arrivals).
ALTER TABLE world_state
  ADD COLUMN last_migration_tick integer NOT NULL DEFAULT 0;
