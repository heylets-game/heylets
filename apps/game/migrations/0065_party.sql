-- A party: several of one account's heroes played together by one player.
-- players.party is 1 for a hero the account has put in its party. The hero
-- being played is always in it as well, flagged or not. On a map each one is
-- a hero of their own (their own pack, their own share of the loot, their
-- own XP), all on the one player's connection (zone-room.ts).

ALTER TABLE players ADD COLUMN party INTEGER NOT NULL DEFAULT 0;
