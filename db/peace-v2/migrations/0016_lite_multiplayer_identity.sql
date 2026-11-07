-- Additive identity and multiworld foundation for Peace Lite V1.
-- Legacy peace_v2_sessions, peace_v2_command_log, and peace_v2_world_state
-- remain intact; this migration neither converts nor deletes legacy records.
CREATE TABLE peace_v2_lite_accounts (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('guest', 'linked', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE peace_v2_lite_worlds (
  id uuid PRIMARY KEY,
  owner_account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE RESTRICT,
  seed text NOT NULL,
  catalog_version text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX peace_v2_lite_worlds_owner_idx
  ON peace_v2_lite_worlds (owner_account_id, created_at);

CREATE TABLE peace_v2_lite_world_memberships (
  world_id uuid NOT NULL REFERENCES peace_v2_lite_worlds(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (world_id, account_id),
  CHECK ((role = 'owner' AND revoked_at IS NULL) OR role <> 'owner')
);

CREATE INDEX peace_v2_lite_memberships_account_idx
  ON peace_v2_lite_world_memberships (account_id, world_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX peace_v2_lite_one_active_owner_per_world
  ON peace_v2_lite_world_memberships (world_id)
  WHERE role = 'owner' AND revoked_at IS NULL;

CREATE TABLE peace_v2_lite_sessions (
  token_hash char(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX peace_v2_lite_sessions_account_idx
  ON peace_v2_lite_sessions (account_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE peace_v2_lite_email_identities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE CASCADE,
  normalized_email text NOT NULL UNIQUE,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE peace_v2_lite_auth_links (
  token_hash char(64) PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE CASCADE,
  identity_id uuid REFERENCES peace_v2_lite_email_identities(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('link_email', 'login')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX peace_v2_lite_auth_links_expiry_idx
  ON peace_v2_lite_auth_links (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE peace_v2_lite_invites (
  token_hash char(64) PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES peace_v2_lite_worlds(id) ON DELETE CASCADE,
  invited_role text NOT NULL CHECK (invited_role IN ('editor', 'viewer')),
  created_by_account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  remaining_uses integer NOT NULL DEFAULT 1 CHECK (remaining_uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX peace_v2_lite_invites_world_idx
  ON peace_v2_lite_invites (world_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE peace_v2_lite_world_commands (
  world_id uuid NOT NULL REFERENCES peace_v2_lite_worlds(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES peace_v2_lite_accounts(id) ON DELETE RESTRICT,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  committed_world_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, request_id)
);

CREATE INDEX peace_v2_lite_world_commands_actor_idx
  ON peace_v2_lite_world_commands (actor_account_id, created_at);

CREATE TABLE peace_v2_lite_world_tick_leases (
  world_id uuid PRIMARY KEY REFERENCES peace_v2_lite_worlds(id) ON DELETE CASCADE,
  owner_node text NOT NULL,
  lease_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
