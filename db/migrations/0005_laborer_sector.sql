ALTER TABLE laborer
  ADD COLUMN sector_id uuid REFERENCES world_sector(id) ON DELETE CASCADE;

UPDATE laborer AS l
SET sector_id = (
  SELECT s.id
  FROM world_sector AS s
  WHERE s.owner_id = l.owner_id
  ORDER BY s.x, s.y
  LIMIT 1
)
WHERE l.sector_id IS NULL;

ALTER TABLE laborer ALTER COLUMN sector_id SET NOT NULL;
CREATE INDEX laborer_sector_idx ON laborer (sector_id);
