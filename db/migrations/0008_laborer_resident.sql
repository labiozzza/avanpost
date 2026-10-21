-- D1=A: labor is bound to a specific resident, so earned XP belongs to a person.
ALTER TABLE laborer
  ADD COLUMN resident_id uuid REFERENCES resident(id) ON DELETE SET NULL;

CREATE INDEX laborer_resident_idx ON laborer (resident_id);
