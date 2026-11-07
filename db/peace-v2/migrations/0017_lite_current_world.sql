ALTER TABLE peace_v2_lite_sessions
  ADD COLUMN current_world_id uuid REFERENCES peace_v2_lite_worlds(id) ON DELETE SET NULL;

UPDATE peace_v2_lite_sessions AS session
   SET current_world_id = worlds.id
  FROM peace_v2_lite_worlds AS worlds
  JOIN peace_v2_lite_world_memberships AS memberships
    ON memberships.world_id = worlds.id AND memberships.role = 'owner' AND memberships.revoked_at IS NULL
 WHERE session.account_id = worlds.owner_account_id;

CREATE INDEX peace_v2_lite_sessions_current_world_idx
  ON peace_v2_lite_sessions (current_world_id)
  WHERE revoked_at IS NULL;
