CREATE TABLE peace_v2_meta (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO peace_v2_meta (key, value)
VALUES ('schema_version', '1');
