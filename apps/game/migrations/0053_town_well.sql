-- The town well's coins (packages/world/src/well.ts): how many a player has tossed in on `day` (UTC, YYYY-MM-DD),
-- and the lucky rolls they hold, waiting to be carried onto the next map they step onto.
CREATE TABLE well_wishes (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  day       TEXT NOT NULL,
  tossed    INTEGER NOT NULL DEFAULT 0,
  luck      INTEGER NOT NULL DEFAULT 0
);
