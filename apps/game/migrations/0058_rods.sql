-- Rods bought from the fishmonger (packages/world/src/fishfight.ts, RODS): one row a rod a player owns. Everyone has
-- the cane rod without a row; a fight is fished with the best rod owned.
CREATE TABLE rods (
  player_id TEXT NOT NULL REFERENCES players(id),
  kind      TEXT NOT NULL,
  PRIMARY KEY (player_id, kind)
);
