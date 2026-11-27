// The bestiary in D1: what a map's fights add to a player's book, and the book as the log book reads it. The rules
// (what a step of a map adds, and to whom) are in packages/world/src/bestiary.ts.
//
// A book is its owner's: the account (players.user_id), so every hero of one account fills and reads the same book,
// or the hero's own id where there is no account.

import { ENEMIES, type BestiaryMark, type BestiaryRecord } from "@gantt-quest/world";

/** SQL for whose book a hero writes in and reads: `id` is the SQL for that hero's id. */
const ownerOf = (id: string) => `(SELECT COALESCE(user_id, id) FROM players WHERE id = ${id})`;

/** The statements that write a step's marks into their books: one a mark. A hero the players table does not have writes nothing. */
export function bestiaryStatements(db: D1Database, marks: readonly BestiaryMark[], now = Date.now()): D1PreparedStatement[] {
  return marks.map((m) =>
    db
      .prepare(
        `INSERT INTO bestiary (owner, kind, faced, kills, top_level, first_at)
         SELECT COALESCE(user_id, id), ?2, ?3, ?4, ?5, ?6 FROM players WHERE id = ?1
         ON CONFLICT(owner, kind) DO UPDATE SET faced = faced + excluded.faced, kills = kills + excluded.kills, top_level = MAX(top_level, excluded.top_level)`,
      )
      .bind(m.hero, m.kind, m.faced, m.kills, m.level, now),
  );
}

/** A player's book: a record for each kind they have met that the game still has. */
export async function bestiaryOf(db: D1Database, playerId: string): Promise<{ records: BestiaryRecord[] }> {
  const rows = await db
    .prepare(`SELECT kind, faced, kills, top_level AS topLevel, first_at AS firstAt FROM bestiary WHERE owner = ${ownerOf("?")} ORDER BY first_at`)
    .bind(playerId)
    .all<BestiaryRecord>();
  return { records: rows.results.filter((r) => ENEMIES[r.kind]) };
}
