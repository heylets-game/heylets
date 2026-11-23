// The town well in D1 (packages/world/src/well.ts has the rules): filling a water skin, and coins tossed in for
// luck. Filling the watering can is with the garden (garden.ts). The lucky rolls a player holds wait here until
// they step onto a map, where the zone takes them (`takeLuck`).

import {
  HARBOR_XP,
  LUCK_MAX,
  WELL_SKINS,
  WISH_COST,
  addedSlots,
  carryProblem,
  gatherDay,
  makeRng,
  seedFromString,
  skinProblem,
  wishGift,
  wishProblem,
  type WellGift,
} from "@gantt-quest/world";
import { consumablesOf } from "./consumables";
import { carryState, getCharacter } from "./db";
import { canOf } from "./garden";
import { prepareXp, xpOutcome, type XpResult } from "./harbor-xp";

/** What the well's card shows: the can, the water skins carried, the day's coins, the luck held, and the gold to toss. */
export interface WellView {
  can: number | null;
  skins: number;
  tossed: number;
  luck: number;
  gold: number;
}

async function wishesOf(db: D1Database, playerId: string, day: string): Promise<{ tossed: number; luck: number }> {
  const row = await db.prepare("SELECT day, tossed, luck FROM well_wishes WHERE player_id = ?").bind(playerId).first<{ day: string; tossed: number; luck: number }>();
  return { tossed: row && row.day === day ? row.tossed : 0, luck: row?.luck ?? 0 };
}

export async function wellView(db: D1Database, playerId: string): Promise<WellView> {
  const [can, items, wishes, c] = await Promise.all([canOf(db, playerId), consumablesOf(db, playerId), wishesOf(db, playerId, gatherDay(Date.now())), getCharacter(db, playerId)]);
  return { can, skins: items.water ?? 0, ...wishes, gold: c?.gold ?? 0 };
}

/** Fill a water skin at the well: one more in the pack, up to WELL_SKINS. */
export async function fillSkin(db: D1Database, playerId: string): Promise<string | { skins: number }> {
  const [items, carry] = await Promise.all([consumablesOf(db, playerId), carryState(db, playerId)]);
  if (!carry) return "Create a character first.";
  const have = items.water ?? 0;
  const problem = skinProblem(have) ?? carryProblem(carry, addedSlots(have, 1));
  if (problem) return problem;
  const res = await db
    .prepare(
      `INSERT INTO consumables (player_id, kind, qty) VALUES (?1, 'water', 1)
       ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + 1 WHERE qty < ?2`,
    )
    .bind(playerId, WELL_SKINS)
    .run();
  return res.meta.changes > 0 ? { skins: have + 1 } : skinProblem(WELL_SKINS)!;
}

/** Toss a coin in the well: a lucky roll for the next map, and now and then something back. */
export async function tossCoin(db: D1Database, playerId: string): Promise<string | { gift: WellGift; luck: number; tossed: number; xp?: XpResult }> {
  const now = Date.now();
  const day = gatherDay(now);
  const [c, wishes] = await Promise.all([getCharacter(db, playerId), wishesOf(db, playerId, day)]);
  if (c?.status !== "active") return "Create a character first.";
  const problem = wishProblem({ gold: c.gold, ...wishes });
  if (problem) return problem;
  // What comes back is the same for this toss however often it is asked: rolled from the player, the day and the count.
  const gift = wishGift(makeRng(seedFromString(`${playerId}|well|${day}|${wishes.tossed}`)));
  const xp = gift === "xp" ? await prepareXp(db, playerId, HARBOR_XP.wish) : null;
  // The toss is counted only if the count is still what was read (two at once cannot both go in), then the gold is
  // paid only if it was counted, and anything given back only if the gold was paid.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO well_wishes (player_id, day, tossed, luck) VALUES (?1, ?2, 1, 1)
         ON CONFLICT(player_id) DO UPDATE SET
           tossed = CASE WHEN day = ?2 THEN tossed + 1 ELSE 1 END,
           luck = MIN(?4, luck + 1),
           day = ?2
         WHERE (CASE WHEN day = ?2 THEN tossed ELSE 0 END) = ?3 AND luck < ?4`,
      )
      .bind(playerId, day, wishes.tossed, LUCK_MAX),
    db.prepare("UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND status = 'active' AND gold >= ?2 AND changes() > 0").bind(playerId, WISH_COST),
    ...(gift === "gem"
      ? [db.prepare("INSERT INTO resources (player_id, kind, qty) SELECT ?1, 'gem', 1 WHERE changes() > 0 ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + 1").bind(playerId)]
      : []),
    ...(xp?.statements() ?? []),
  ]);
  if (results[0].meta.changes === 0) return "The well took a coin from you just now. Try again.";
  if (results[1].meta.changes === 0) {
    // Counted, but the gold had gone meanwhile: the count and the luck go back as they were.
    await db.prepare("UPDATE well_wishes SET tossed = MAX(0, tossed - 1), luck = MAX(0, luck - 1) WHERE player_id = ?1 AND day = ?2").bind(playerId, day).run();
    return "Not enough gold.";
  }
  return { gift, luck: Math.min(LUCK_MAX, wishes.luck + 1), tossed: wishes.tossed + 1, ...(xp ? { xp: xpOutcome(xp, results) } : {}) };
}

/** Take the lucky rolls a player holds, to carry onto the map they are stepping onto. None held, 0. */
export async function takeLuck(db: D1Database, playerId: string): Promise<number> {
  const row = await db.prepare("SELECT luck FROM well_wishes WHERE player_id = ?").bind(playerId).first<{ luck: number }>();
  const luck = row?.luck ?? 0;
  if (luck <= 0) return 0;
  const res = await db.prepare("UPDATE well_wishes SET luck = luck - ?2 WHERE player_id = ?1 AND luck >= ?2").bind(playerId, luck).run();
  return res.meta.changes > 0 ? luck : 0;
}

/** Give lucky rolls back (the map could not take the hero after all). */
export async function returnLuck(db: D1Database, playerId: string, luck: number): Promise<void> {
  if (luck > 0) await db.prepare("UPDATE well_wishes SET luck = MIN(?3, luck + ?2) WHERE player_id = ?1").bind(playerId, luck, LUCK_MAX).run();
}
