-- Bait bought from the fishmonger (packages/world/src/fishing.ts, BAIT_SALE): how many of each kind a player has.
-- Worms and shrimp are taken one a cast; a glow lure only when the line goes with a fish.
CREATE TABLE bait (
  player_id TEXT NOT NULL REFERENCES players(id),
  kind      TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, kind)
);
