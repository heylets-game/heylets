-- Hollis Crane, the pub's dealer in materials (packages/world/src/dealer.ts).
--
-- What a player has traded with him on `day` (UTC, YYYY-MM-DD), per material, against his daily limits: `bought` is
-- what he bought from them, `sold` what he sold them. Earlier days' rows are cleared as new ones are written.
CREATE TABLE dealer_trades (
  player_id TEXT NOT NULL REFERENCES players(id),
  day       TEXT NOT NULL,
  kind      TEXT NOT NULL,
  bought    INTEGER NOT NULL DEFAULT 0,
  sold      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day, kind)
);

-- His supply contracts a player has taken: the offer's terms as they were (`offer_json`), what has been delivered
-- so far, and how it ended (filled, lapsed past `due_at`, or dropped) and what it paid. One open at a time.
-- `claim` marks the statement that settled it, so a settlement pays once.
CREATE TABLE dealer_contracts (
  player_id      TEXT NOT NULL REFERENCES players(id),
  offer_id       TEXT NOT NULL,
  day            TEXT NOT NULL,
  offer_json     TEXT NOT NULL,
  taken_at       INTEGER NOT NULL,
  due_at         INTEGER NOT NULL,
  delivered_json TEXT NOT NULL DEFAULT '{}',
  done_at        INTEGER,
  outcome        TEXT CHECK (outcome IN ('filled', 'lapsed', 'dropped')),
  paid           INTEGER NOT NULL DEFAULT 0,
  claim          TEXT,
  PRIMARY KEY (player_id, offer_id)
);
CREATE UNIQUE INDEX dealer_contracts_open ON dealer_contracts (player_id) WHERE done_at IS NULL;
CREATE INDEX dealer_contracts_day ON dealer_contracts (player_id, day);
