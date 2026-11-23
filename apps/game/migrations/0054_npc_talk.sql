-- Questions a player has asked the townsfolk on `day` (UTC, YYYY-MM-DD), against the day's limit
-- (TALK_PER_DAY, packages/world/src/talk.ts). Each one is a call to the model.
CREATE TABLE npc_talk (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  day       TEXT NOT NULL,
  asked     INTEGER NOT NULL DEFAULT 0
);
