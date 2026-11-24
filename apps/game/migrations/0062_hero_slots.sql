-- Several heroes to an account (src/server/auth.ts, routes/heroes.ts). Each
-- players row is a hero; which one a device is playing is in a cookie, and
-- without one the account's most recently played hero is taken.

ALTER TABLE players ADD COLUMN last_played_at INTEGER;
UPDATE players SET last_played_at = created_at;
