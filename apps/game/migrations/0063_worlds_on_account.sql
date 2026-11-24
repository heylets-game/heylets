-- A hero can belong to several worlds (crews) and is in one of them at a
-- time: players.current_crew_id. Joining another world no longer takes them
-- out of the first; the account's worlds are listed under Join world.
--
-- crew_members loses UNIQUE(player_id), which needs the table rebuilt.
-- A hut stands in one world for now: huts.plot_crew_id says which, so it is
-- not drawn on the same plot number in the hero's other worlds.

PRAGMA defer_foreign_keys = true;

CREATE TABLE crew_members_new (
  crew_id   TEXT NOT NULL REFERENCES crews(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (crew_id, player_id)
);
INSERT INTO crew_members_new (crew_id, player_id, joined_at) SELECT crew_id, player_id, joined_at FROM crew_members;
DROP TABLE crew_members;
ALTER TABLE crew_members_new RENAME TO crew_members;
CREATE INDEX idx_crew_members_crew ON crew_members(crew_id, joined_at);
CREATE INDEX idx_crew_members_player ON crew_members(player_id, joined_at);

ALTER TABLE players ADD COLUMN current_crew_id TEXT;
UPDATE players SET current_crew_id = (SELECT crew_id FROM crew_members m WHERE m.player_id = players.id);

ALTER TABLE huts ADD COLUMN plot_crew_id TEXT;
UPDATE huts SET plot_crew_id = (SELECT crew_id FROM crew_members m WHERE m.player_id = huts.player_id) WHERE plot IS NOT NULL;
