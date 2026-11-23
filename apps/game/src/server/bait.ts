// Bait and rods from the fishmonger: what a player has, buying more at his shack, and taking bait as it is used. The
// rules (prices, how much is carried, what is used when) are in packages/world/src/fishing.ts, and the rods' in
// packages/world/src/fishfight.ts.

import { BAIT_SALE, RODS, baitBuyProblem, bestRod, isBaitId, isRodId, rodBuyProblem, type BaitCounts, type BaitId, type RodId } from "@gantt-quest/world";
import { getCharacter } from "./db";

/** How much of each kind of bait a player has. */
export async function baitOf(db: D1Database, playerId: string): Promise<BaitCounts> {
  const rows = await db.prepare("SELECT kind, count FROM bait WHERE player_id = ? AND count > 0").bind(playerId).all<{ kind: string; count: number }>();
  const out: BaitCounts = {};
  for (const r of rows.results) if (isBaitId(r.kind)) out[r.kind] = r.count;
  return out;
}

/** The rods a player has bought (not the cane rod, which everyone has). */
export async function rodsOf(db: D1Database, playerId: string): Promise<RodId[]> {
  const rows = await db.prepare("SELECT kind FROM rods WHERE player_id = ?").bind(playerId).all<{ kind: string }>();
  return rows.results.map((r) => r.kind).filter(isRodId);
}

/** The best rod a player owns: what they fight fish with. */
export const ownedRod = async (db: D1Database, playerId: string): Promise<RodId> => bestRod(await rodsOf(db, playerId));

export interface BaitCounter {
  bait: BaitCounts;
  rods: RodId[];
  gold: number;
}

/** What the counter shows: the bait and rods a player has, and their gold. */
export async function baitCounter(db: D1Database, playerId: string): Promise<BaitCounter> {
  const [bait, rods, c] = await Promise.all([baitOf(db, playerId), rodsOf(db, playerId), getCharacter(db, playerId)]);
  return { bait, rods, gold: c?.gold ?? 0 };
}

/** Buy a rod. The gold is taken, and the rod given, only if the player can pay and has not got it, in one batch. */
export async function buyRod(db: D1Database, playerId: string, kind: unknown): Promise<BaitCounter | string> {
  if (!isRodId(kind) || kind === "cane") return "He doesn't sell that.";
  const [c, owned] = await Promise.all([getCharacter(db, playerId), rodsOf(db, playerId)]);
  if (c?.status !== "active") return "Create a character first.";
  const problem = rodBuyProblem(kind, owned, c.gold);
  if (problem) return problem;
  const price = RODS[kind].price;
  const [paid] = await db.batch([
    db
      .prepare("UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND status = 'active' AND gold >= ?2 AND NOT EXISTS (SELECT 1 FROM rods WHERE player_id = ?1 AND kind = ?3)")
      .bind(playerId, price, kind),
    db.prepare("INSERT INTO rods (player_id, kind) SELECT ?1, ?2 WHERE changes() > 0 ON CONFLICT(player_id, kind) DO NOTHING").bind(playerId, kind),
  ]);
  if (paid.meta.changes === 0) return "That didn't go through. Try again.";
  return { ...(await baitCounter(db, playerId)), gold: c.gold - price };
}

/**
 * Buy one lot of `kind` (a tin of worms, a pot of shrimp, a lure). The gold is taken, and the bait given, only if
 * the player can pay and has room for it, in one batch: two bought at once cannot both slip past the limit.
 */
export async function buyBait(db: D1Database, playerId: string, kind: unknown): Promise<BaitCounter | string> {
  if (!isBaitId(kind)) return "He doesn't sell that.";
  const [c, have] = await Promise.all([getCharacter(db, playerId), baitOf(db, playerId)]);
  if (c?.status !== "active") return "Create a character first.";
  const problem = baitBuyProblem(kind, have[kind] ?? 0, c.gold);
  if (problem) return problem;
  const sale = BAIT_SALE[kind];
  const [paid] = await db.batch([
    db
      .prepare(
        `UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND status = 'active' AND gold >= ?2
         AND COALESCE((SELECT count FROM bait WHERE player_id = ?1 AND kind = ?3), 0) + ?4 <= ?5`,
      )
      .bind(playerId, sale.price, kind, sale.per, sale.max),
    db
      .prepare("INSERT INTO bait (player_id, kind, count) SELECT ?1, ?2, ?3 WHERE changes() > 0 ON CONFLICT(player_id, kind) DO UPDATE SET count = count + ?3")
      .bind(playerId, kind, sale.per),
  ]);
  if (paid.meta.changes === 0) return "That didn't go through. Try again.";
  return { bait: await baitOf(db, playerId), rods: await rodsOf(db, playerId), gold: c.gold - sale.price };
}

/** Take one of `kind`, if the statement before it in the same batch changed a row (the cast that used it was saved). */
export const spendBaitAfter = (db: D1Database, playerId: string, kind: BaitId): D1PreparedStatement =>
  db.prepare("UPDATE bait SET count = count - 1 WHERE player_id = ?1 AND kind = ?2 AND count > 0 AND changes() > 0").bind(playerId, kind);
