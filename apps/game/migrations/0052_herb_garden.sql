-- The herb garden by each hut's door (packages/world/src/garden.ts). A row is a bed with something growing in it;
-- an empty bed has none. Growth is worked out from planted_at and ready_at and the clock, so nothing runs while a
-- bed grows. watered_by and fed_by hold the name of whoever watered it and fed it bonemeal, once each a planting.

CREATE TABLE garden_beds (
  player_id  TEXT NOT NULL REFERENCES players(id),
  bed        INTEGER NOT NULL,
  planted_at INTEGER NOT NULL,
  ready_at   INTEGER NOT NULL,
  watered_by TEXT,
  fed_by     TEXT,
  PRIMARY KEY (player_id, bed)
);

-- A player's watering can, once they have bought one at the market stall: how many waterings it holds now. It is
-- filled at the town well (up to CAN_CAPACITY) and each watering of a bed takes one.
CREATE TABLE watering_cans (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  water     INTEGER NOT NULL DEFAULT 0
);
