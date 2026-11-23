// How many questions a player has left for the townsfolk today (packages/world/src/talk.ts has the limit). Each
// question is a call to the model, so they are counted before it is made, and one too many is never made.

import { TALK_PER_DAY, gatherDay } from "@gantt-quest/world";

/** Questions left today. */
export async function talkLeft(db: D1Database, playerId: string, now = Date.now()): Promise<number> {
  const row = await db.prepare("SELECT day, asked FROM npc_talk WHERE player_id = ?").bind(playerId).first<{ day: string; asked: number }>();
  const asked = row && row.day === gatherDay(now) ? row.asked : 0;
  return Math.max(0, TALK_PER_DAY - asked);
}

/**
 * Count one question, if there is one left today. Returns how many are left after it, or null when there were
 * none (nothing is counted). One statement, so two asked at once cannot both take the last.
 */
export async function spendTalk(db: D1Database, playerId: string, now = Date.now()): Promise<number | null> {
  const day = gatherDay(now);
  const row = await db
    .prepare(
      `INSERT INTO npc_talk (player_id, day, asked) VALUES (?1, ?2, 1)
       ON CONFLICT(player_id) DO UPDATE SET asked = CASE WHEN npc_talk.day = ?2 THEN npc_talk.asked + 1 ELSE 1 END, day = ?2
       WHERE npc_talk.day <> ?2 OR npc_talk.asked < ?3
       RETURNING asked`,
    )
    .bind(playerId, day, TALK_PER_DAY)
    .first<{ asked: number }>();
  return row ? TALK_PER_DAY - row.asked : null;
}
