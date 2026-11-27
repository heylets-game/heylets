// The bestiary in D1: what a map's fights add to a book, and the book as the log book reads it. The rules (what a
// step of a map adds, and to whom) are in packages/world/src/bestiary.ts.
//
// A row is one hero's record of one kind. The book a player reads is every hero of their account added together
// (players.user_id; a hero with no account is a book of their own), so every hero of an account reads the same book,
// and it goes with the heroes when a guest's are moved into an account (auth.ts onLinkAccount).

import { ENEMIES, type BestiaryMark, type BestiaryRecord } from "@gantt-quest/world";

/** The statements that write a step's marks down: one a mark, under the hero it names. A hero the players table does not have writes nothing. */
export function bestiaryStatements(db: D1Database, marks: readonly BestiaryMark[], now = Date.now()): D1PreparedStatement[] {
  return marks.map((m) =>
    db
      .prepare(
        `INSERT INTO bestiary (player_id, kind, faced, kills, top_level, first_at)
         SELECT id, ?2, ?3, ?4, ?5, ?6 FROM players WHERE id = ?1
         ON CONFLICT(player_id, kind) DO UPDATE SET faced = faced + excluded.faced, kills = kills + excluded.kills, top_level = MAX(top_level, excluded.top_level)`,
      )
      .bind(m.hero, m.kind, m.faced, m.kills, m.level, now),
  );
}

/**
 * A step's marks with no account marked twice for the same thing. A party is one mark already (world bestiaryMarks),
 * but two heroes of one account each played on their own (two devices, no party) are two, and their rows are added
 * together when the book is read. The first of them keeps the mark. Only asked of D1 when more than one hero is marked.
 */
export async function onePerAccount(db: D1Database, marks: readonly BestiaryMark[]): Promise<BestiaryMark[]> {
  const heroes = [...new Set(marks.map((m) => m.hero))];
  if (heroes.length < 2) return [...marks];
  const rows = await db
    .prepare(`SELECT id, COALESCE(user_id, id) AS owner FROM players WHERE id IN (${heroes.map(() => "?").join(", ")})`)
    .bind(...heroes)
    .all<{ id: string; owner: string }>();
  const owner = new Map(rows.results.map((r) => [r.id, r.owner]));
  const seen = new Set<string>();
  return marks.filter((m) => {
    const key = `${owner.get(m.hero) ?? m.hero}|${m.kind}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

/** A player's book: for each kind any hero of their account has met (and the game still has), all of those heroes' records added together. */
export async function bestiaryOf(db: D1Database, playerId: string): Promise<{ records: BestiaryRecord[] }> {
  const rows = await db
    .prepare(
      `SELECT b.kind, SUM(b.faced) AS faced, SUM(b.kills) AS kills, MAX(b.top_level) AS topLevel, MIN(b.first_at) AS firstAt
       FROM bestiary b JOIN players p ON p.id = b.player_id
       WHERE COALESCE(p.user_id, p.id) = (SELECT COALESCE(user_id, id) FROM players WHERE id = ?)
       GROUP BY b.kind ORDER BY firstAt, b.kind`,
    )
    .bind(playerId)
    .all<BestiaryRecord>();
  return { records: rows.results.filter((r) => ENEMIES[r.kind]) };
}
