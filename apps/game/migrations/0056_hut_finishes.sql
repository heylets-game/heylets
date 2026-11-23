-- Home finishes (packages/world/src/finishes.ts): wallpaper, floors and roof colours, bought from Nell's stall in the
-- Harbor. A row in owned_finishes is a finish a player has bought, theirs for good. The hut's own row says which of
-- them it is dressed in now (NULL: the way huts come). Nothing else reads these columns.

CREATE TABLE owned_finishes (
  player_id TEXT NOT NULL REFERENCES players(id),
  finish_id TEXT NOT NULL,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, finish_id)
);

ALTER TABLE huts ADD COLUMN wall TEXT;
ALTER TABLE huts ADD COLUMN floor TEXT;
ALTER TABLE huts ADD COLUMN roof TEXT;
