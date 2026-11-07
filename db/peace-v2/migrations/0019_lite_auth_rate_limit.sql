CREATE TABLE peace_v2_lite_auth_attempts (
  subject_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX peace_v2_lite_auth_attempts_cleanup_idx
  ON peace_v2_lite_auth_attempts (updated_at);

CREATE INDEX peace_v2_lite_auth_links_account_idx
  ON peace_v2_lite_auth_links (account_id, purpose, created_at DESC);
