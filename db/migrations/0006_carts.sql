ALTER TABLE laborer
  ADD COLUMN transport text NOT NULL DEFAULT 'person'
  CHECK (transport IN ('person', 'cart'));

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY owner_id ORDER BY created_at, id) AS position
  FROM laborer
  WHERE role = 'carrier'
)
UPDATE laborer AS l
SET transport = 'cart'
FROM ranked
WHERE l.id = ranked.id
  AND ranked.position = 1;
