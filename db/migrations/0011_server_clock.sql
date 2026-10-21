-- Migration: server-authoritative world clock (ADR-0005).
-- last_simulated_at marks the instant up to which the world has been simulated
-- tick by tick. Existing worlds resume from their last known sim time.

ALTER TABLE world_state
  ADD COLUMN last_simulated_at timestamptz NOT NULL DEFAULT now();

UPDATE world_state SET last_simulated_at = updated_at;
