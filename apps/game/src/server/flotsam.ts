// Flotsam taken from the Harbor's beach and water. Where each piece lies, and what is in it, is worked out from the
// crew and the clock (packages/world/src/flotsam.ts); only who took what is kept here. A piece is taken from where
// the hero really stands (the Harbor's room knows), never where their client says, and the first to take it has it.

import { FLOTSAM_TIDE_MS, FURNISHINGS, RESOURCE_KINDS, flotsamAt, flotsamFind, flotsamName, flotsamReachProblem, type FlotsamFind } from "@gantt-quest/world";
import { crewFor } from "./db";
import { newFurnishingCrewSql } from "./db/rows";
import type { Standing } from "./gather";


/** The pieces of this tide a crew has taken already, by id. */
export async function flotsamTaken(db: D1Database, playerId: string, now = Date.now()): Promise<{ taken: string[] }> {
  const crew = await crewFor(db, playerId);
  if (!crew) return { taken: [] };
  const tide = Math.floor(now / FLOTSAM_TIDE_MS);
  const rows = await db.prepare("SELECT piece_id FROM flotsam WHERE crew_id = ? AND taken_at >= ?").bind(crew.id, tide * FLOTSAM_TIDE_MS).all<{ piece_id: string }>();
  return { taken: rows.results.map((r) => r.piece_id) };
}

export interface FlotsamTaken {
  id: string;
  name: string;
  find: FlotsamFind;
}

/**
 * Fish out the piece `id` bobbing in the hero's Harbor, if they are on it or beside it (from the beach or a boat) and
 * nobody has beaten them to it. What is in it is paid in the same batch, only to the request that took it.
 */
export async function takeFlotsam(db: D1Database, playerId: string, id: unknown, where: Standing | null, now = Date.now()): Promise<FlotsamTaken | string> {
  if (typeof id !== "string") return "There's nothing there.";
  if (!where) return "You need to be in the Harbor for that.";
  const piece = flotsamAt(where.crewId, now).find((f) => f.id === id);
  if (!piece) return "The tide has taken it back.";
  const far = flotsamReachProblem(piece, where.pos);
  if (far) return far;
  const find = flotsamFind(where.crewId, piece);
  const claim = crypto.randomUUID();
  const mine = "EXISTS (SELECT 1 FROM flotsam WHERE crew_id = ?2 AND piece_id = ?3 AND claim = ?4)";
  const pay: D1PreparedStatement[] = [];
  for (const kind of RESOURCE_KINDS) {
    const qty = find.resources[kind];
    if (!qty) continue;
    pay.push(
      db
        .prepare(`INSERT INTO resources (player_id, kind, qty) SELECT ?1, ?5, ?6 WHERE ${mine} ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + excluded.qty`)
        .bind(playerId, where.crewId, piece.id, claim, kind, qty),
    );
  }
  if (find.gold) pay.push(db.prepare(`UPDATE characters SET gold = gold + ?5 WHERE player_id = ?1 AND ${mine}`).bind(playerId, where.crewId, piece.id, claim, find.gold));
  if (find.furnishing) {
    pay.push(
      db
        // Into storage in the hut of the world it was found in.
        .prepare(`INSERT INTO furnishings (player_id, def_id, label, meta_json, created_at, crew_id) SELECT ?1, ?5, ?6, '{}', ?7, ${newFurnishingCrewSql("?1", "?5")} WHERE ${mine}`)
        .bind(playerId, where.crewId, piece.id, claim, find.furnishing, FURNISHINGS[find.furnishing].name, now),
    );
  }
  const [, took] = await db.batch([
    // Tides long gone: nothing of theirs can be taken any more.
    db.prepare("DELETE FROM flotsam WHERE crew_id = ? AND taken_at < ?").bind(where.crewId, now - 2 * FLOTSAM_TIDE_MS),
    db.prepare("INSERT INTO flotsam (crew_id, piece_id, player_id, claim, taken_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(crew_id, piece_id) DO NOTHING").bind(where.crewId, piece.id, playerId, claim, now),
    ...pay,
  ]);
  if (took.meta.changes === 0) return "Somebody got there first.";
  return { id: piece.id, name: flotsamName(piece), find };
}
