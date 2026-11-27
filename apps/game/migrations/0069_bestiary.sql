-- The bestiary, a page of the log book (packages/world/src/bestiary.ts): which kinds of enemy a hero has been in a
-- fight with, how many of each they have faced and killed, and the highest level they met one at. Written by a
-- map's room as its fights go (src/server/bestiary.ts).
--
-- A row is one hero's record of one kind. The book a player reads is every hero of their account added together
-- (players.user_id), so it goes with the heroes when a guest's are moved into an account. A kind with no row has
-- not been met.

CREATE TABLE bestiary (
  player_id TEXT NOT NULL REFERENCES players(id),
  kind      TEXT NOT NULL,              -- an enemy kind (content.ts ENEMIES)
  faced     INTEGER NOT NULL DEFAULT 0, -- how many of it they have been in a fight with
  kills     INTEGER NOT NULL DEFAULT 0, -- how many went down while they were in the fight
  top_level INTEGER NOT NULL DEFAULT 1, -- the highest level one was met at
  first_at  INTEGER NOT NULL,           -- when the first was met (epoch ms)
  PRIMARY KEY (player_id, kind)
);
