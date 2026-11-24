-- Each world is its own home. A hero brought into another world buys a plot
-- there and builds and furnishes a hut from scratch: a hut, its furniture
-- (and so what is kept in its chests) and its herb garden belong to a hero
-- in one world. Materials, blueprints, gear, gold and the hero's boats (a
-- rowboat or float barrel, kept at the pier) stay the hero's in every world.
--
-- huts is keyed by (player_id, crew_id) instead of player_id, which needs the
-- table rebuilt; it takes over from huts.plot_crew_id (0063). A hut stood in
-- the world its plot is in, or else (no plot yet, or a plot given up) in the
-- world its hero is in now.
--
-- furnishings.crew_id says whose hut a piece is in. NULL is a boat: the
-- hero's in every world. Stash rows and gear kept in a chest point at a
-- furnishing, so they follow it. garden_beds gains crew_id in its key.

PRAGMA defer_foreign_keys = true;

CREATE TABLE huts_new (
  player_id TEXT NOT NULL REFERENCES players(id),
  crew_id   TEXT NOT NULL,
  tier      INTEGER NOT NULL DEFAULT 1,
  plot      INTEGER,
  bin_json  TEXT,
  wall      TEXT,
  floor     TEXT,
  roof      TEXT,
  PRIMARY KEY (player_id, crew_id)
);
-- A hero in no world at all keeps their hut under '' (no world), out of sight until they could ever reach it.
INSERT INTO huts_new (player_id, crew_id, tier, plot, bin_json, wall, floor, roof)
SELECT h.player_id,
       COALESCE(h.plot_crew_id,
                (SELECT m.crew_id FROM crew_members m LEFT JOIN players p ON p.id = m.player_id WHERE m.player_id = h.player_id
                 ORDER BY m.crew_id = p.current_crew_id DESC, m.joined_at DESC LIMIT 1),
                ''),
       h.tier, CASE WHEN h.plot_crew_id IS NULL THEN NULL ELSE h.plot END, h.bin_json, h.wall, h.floor, h.roof
FROM huts h;
DROP TABLE huts;
ALTER TABLE huts_new RENAME TO huts;
CREATE INDEX idx_huts_crew_plot ON huts(crew_id, plot);

ALTER TABLE furnishings ADD COLUMN crew_id TEXT;
UPDATE furnishings SET crew_id = COALESCE(
  (SELECT h.crew_id FROM huts h WHERE h.player_id = furnishings.player_id),
  (SELECT m.crew_id FROM crew_members m LEFT JOIN players p ON p.id = m.player_id WHERE m.player_id = furnishings.player_id
   ORDER BY m.crew_id = p.current_crew_id DESC, m.joined_at DESC LIMIT 1),
  '')
WHERE def_id NOT IN ('rowboat', 'float_barrel');
-- A boat is never set down in a hut: make sure none sits in one, since it is now in every world's.
UPDATE furnishings SET q = NULL, r = NULL, on_id = NULL, in_id = NULL WHERE def_id IN ('rowboat', 'float_barrel');
CREATE INDEX idx_furnishings_player_crew ON furnishings(player_id, crew_id);

CREATE TABLE garden_beds_new (
  player_id  TEXT NOT NULL REFERENCES players(id),
  crew_id    TEXT NOT NULL,
  bed        INTEGER NOT NULL,
  crop       TEXT NOT NULL DEFAULT 'herbs',
  planted_at INTEGER NOT NULL,
  ready_at   INTEGER NOT NULL,
  watered_by TEXT,
  fed_by     TEXT,
  PRIMARY KEY (player_id, crew_id, bed)
);
-- A garden grows by a standing hut's door, so it is in the world that hut's plot is in.
INSERT INTO garden_beds_new (player_id, crew_id, bed, crop, planted_at, ready_at, watered_by, fed_by)
SELECT g.player_id, h.crew_id, g.bed, g.crop, g.planted_at, g.ready_at, g.watered_by, g.fed_by
FROM garden_beds g JOIN huts h ON h.player_id = g.player_id AND h.plot IS NOT NULL;
DROP TABLE garden_beds;
ALTER TABLE garden_beds_new RENAME TO garden_beds;
CREATE INDEX idx_garden_beds_crew ON garden_beds(crew_id, player_id);
