// Home finishes in D1 (packages/world/src/finishes.ts has the catalogue and the rules): what a player has bought from
// Nell, theirs for good, and which of them their hut is dressed in. Buying is one batch whose first statement takes
// the gold only if the finish is not owned yet and the gold is there, so a double click cannot pay twice.

import { BARE_FINISH, cleanFinish, finishBuyProblem, finishById, finishDay, finishSetProblem, finishStock, nextFinishDay, type FinishKind, type HutFinish } from "@gantt-quest/world";
import { getCharacter } from "./db";

/** The finishes a player owns, in the order they bought them. */
export async function ownedFinishes(db: D1Database, playerId: string): Promise<string[]> {
  const rows = await db.prepare("SELECT finish_id FROM owned_finishes WHERE player_id = ? ORDER BY bought_at, finish_id").bind(playerId).all<{ finish_id: string }>();
  return rows.results.map((r) => r.finish_id);
}

/** What a player's hut is dressed in. A player with no hut row has a bare one. */
export async function hutFinish(db: D1Database, playerId: string): Promise<HutFinish> {
  const row = await db.prepare("SELECT wall, floor, roof FROM huts WHERE player_id = ?").bind(playerId).first<HutFinish>();
  return row ? cleanFinish(row) : { ...BARE_FINISH };
}

/** Nell's catalogue as a player sees it: what they own, what their hut wears, and the gold they could spend. */
export interface FinishesView {
  owned: string[];
  finish: HutFinish;
  gold: number;
  /** Whether they have a hut standing to dress. */
  hut: boolean;
  /** What Nell has out today (finishStock), and when her table next changes. */
  stock: string[];
  restock: number;
}

export async function finishesView(db: D1Database, playerId: string): Promise<FinishesView> {
  const [owned, finish, c, hut] = await Promise.all([
    ownedFinishes(db, playerId),
    hutFinish(db, playerId),
    getCharacter(db, playerId),
    db.prepare("SELECT 1 AS yes FROM huts WHERE player_id = ? AND plot IS NOT NULL AND bin_json IS NULL").bind(playerId).first<{ yes: number }>(),
  ]);
  const now = Date.now();
  return { owned, finish, gold: c?.gold ?? 0, hut: !!hut, stock: finishStock(finishDay(now)), restock: nextFinishDay(now) };
}

/** Buy a finish from Nell, for good: one she has out today. */
export async function buyFinish(db: D1Database, playerId: string, id: unknown): Promise<string | { gold: number }> {
  const [c, owned] = await Promise.all([getCharacter(db, playerId), ownedFinishes(db, playerId)]);
  if (c?.status !== "active") return "Create a character first.";
  const problem = finishBuyProblem(id, owned, c.gold, finishStock(finishDay(Date.now())));
  if (problem) return problem;
  const def = finishById(id as string)!;
  const [paid] = await db.batch([
    db
      .prepare("UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND status = 'active' AND gold >= ?2 AND NOT EXISTS (SELECT 1 FROM owned_finishes WHERE player_id = ?1 AND finish_id = ?3)")
      .bind(playerId, def.price, def.id),
    db.prepare("INSERT OR IGNORE INTO owned_finishes (player_id, finish_id, bought_at) SELECT ?1, ?2, ?3 WHERE changes() > 0").bind(playerId, def.id, Date.now()),
  ]);
  if (paid.meta.changes === 0) return "You have that one already.";
  return { gold: c.gold - def.price };
}

/** Dress your hut's walls, floor or roof in a finish you own, or (null) take it off again. */
export async function setFinish(db: D1Database, playerId: string, kind: unknown, id: unknown): Promise<string | HutFinish> {
  const owned = await ownedFinishes(db, playerId);
  const problem = finishSetProblem(kind, id ?? null, owned);
  if (problem) return problem;
  // The column is one of three fixed names, checked just above: never taken from the request as written.
  const column = ({ wall: "wall", floor: "floor", roof: "roof" } as const)[kind as FinishKind];
  const set = await db.prepare(`UPDATE huts SET ${column} = ?2 WHERE player_id = ?1 AND plot IS NOT NULL AND bin_json IS NULL`).bind(playerId, id ?? null).run();
  if (set.meta.changes === 0) return "You have no hut standing to dress yet.";
  return hutFinish(db, playerId);
}
