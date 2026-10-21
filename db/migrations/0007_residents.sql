CREATE TABLE resident (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name text NOT NULL,
  traits jsonb NOT NULL,
  schools jsonb NOT NULL DEFAULT '[]'::jsonb,
  profession text NOT NULL DEFAULT 'Разнорабочий',
  xp integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'school')),
  school_id text,
  training_left_ticks integer NOT NULL DEFAULT 0,
  training_total_ticks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resident_owner_idx ON resident (owner_id);
