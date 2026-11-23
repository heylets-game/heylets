-- Flotsam taken from the Harbor (packages/world/src/flotsam.ts): what lies where follows from the crew and the clock,
-- so only who took each piece is kept. The first to take a piece has it. `claim` is the request that took it, so
-- what is in it is paid only to that request. Rows from tides long gone are cleared as new pieces are taken.
CREATE TABLE flotsam (
  crew_id   TEXT NOT NULL,
  piece_id  TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  claim     TEXT NOT NULL,
  taken_at  INTEGER NOT NULL,
  PRIMARY KEY (crew_id, piece_id)
);
