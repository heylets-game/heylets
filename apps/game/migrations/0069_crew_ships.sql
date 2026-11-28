-- The crew's ships (packages/world/src/voyage/ships.ts). A crew sails the best ship it owns: every crew has the
-- Sloop, and the Brig and the Galleon are crew projects (crew_projects rows 'brig' and 'galleon', built_at set).
-- So which ships a crew owns is not kept here: this table holds only how each one's hull stands. A ship has a
-- row from the first time her hull is written (worn at sea, mended at the yard); with no row she is sound.
CREATE TABLE crew_ships (
  crew_id    TEXT NOT NULL REFERENCES crews(id),
  ship_id    TEXT NOT NULL,           -- sloop | brig | galleon
  hull       INTEGER NOT NULL CHECK (hull >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, ship_id)
);

-- Until now a crew went anywhere on its atlas through the waygate. From here a ship sails only so far out: the
-- Sloop to ring 3, the Brig to ring 7, the Galleon anywhere. A crew that has already cleared a place further out
-- than a ship reaches is given the ship that covers it, built and afloat, so nobody loses the way to anywhere
-- they have been. (A landfall's id is its cell, 'q,r', and its ring is how far that is from 0,0 in hexes. A sea
-- passage's id is its two ends, 'q,r|q,r', and is left out: its ends are landfalls, counted on their own.)
--
-- Past ring 3: the Brig.
INSERT INTO crew_projects (crew_id, project_id, built_at)
SELECT crew_id, 'brig', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT crew_id, MAX((abs(q) + abs(r) + abs(q + r)) / 2) AS far
  FROM (
    SELECT crew_id,
           CAST(substr(node, 1, instr(node, ',') - 1) AS INTEGER) AS q,
           CAST(substr(node, instr(node, ',') + 1) AS INTEGER) AS r
    FROM atlas_nodes WHERE status = 'cleared' AND instr(node, ',') > 0 AND instr(node, '|') = 0
  )
  GROUP BY crew_id
)
WHERE far > 3
ON CONFLICT(crew_id, project_id) DO UPDATE SET built_at = COALESCE(crew_projects.built_at, excluded.built_at);

-- Past ring 7: the Galleon too (the Brig above comes with her, as she is built after it).
INSERT INTO crew_projects (crew_id, project_id, built_at)
SELECT crew_id, 'galleon', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT crew_id, MAX((abs(q) + abs(r) + abs(q + r)) / 2) AS far
  FROM (
    SELECT crew_id,
           CAST(substr(node, 1, instr(node, ',') - 1) AS INTEGER) AS q,
           CAST(substr(node, instr(node, ',') + 1) AS INTEGER) AS r
    FROM atlas_nodes WHERE status = 'cleared' AND instr(node, ',') > 0 AND instr(node, '|') = 0
  )
  GROUP BY crew_id
)
WHERE far > 7
ON CONFLICT(crew_id, project_id) DO UPDATE SET built_at = COALESCE(crew_projects.built_at, excluded.built_at);
