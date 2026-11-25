// A party: several of one account's heroes, played together by one player.
//
// Each member is a hero of their own, as if played alone: their own sheet,
// pack, XP and share of the loot. What the party changes is only who walks
// onto a map together: every member comes onto it beside the hero the
// player went in as, on that player's one connection (zone-room.ts), and the
// player picks which of them they are acting as. A request names that hero
// (auth.ts heroAsked), so every other route reads `c.get("player")` as before.
//
// The party is changed only in town: not while any of it (or the hero being
// added or taken out) is out on a map.
//
// The party is kept on the account (players.party). The hero being played is
// always in it. On a map, only the members who are in the same world as that
// hero come along: adding a hero from another world brings them into this one.

import { MAX_CREW } from "@gantt-quest/world";
import { crewFor, joinCrew, refreshHarbor, type Env } from "./db";
import { currentCrewSql } from "./db/rows";
import { onAZone } from "./zones";

/** Said when the party cannot be changed: one of them is out on a map. */
export const PARTY_IN_TOWN = "Change your party in the Harbor, not out on a map.";

/** Whether the party (the hero being played, the rest of it, and `heroId`) is all off the maps, so it can be changed. */
async function allInTown(db: D1Database, playerId: string, heroId: string): Promise<boolean> {
  const heroes = [...new Set([playerId, heroId, ...(await partyOf(db, playerId))])];
  return !(await Promise.all(heroes.map((id) => onAZone(db, id)))).some(Boolean);
}

/**
 * The other heroes in `playerId`'s party who are in the same world as them now, oldest first. The hero being played is
 * always in the party; `member` asks only of a hero who is in it themselves (one walking for another in town).
 */
export async function partyOf(db: D1Database, playerId: string, member = false): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT p.id FROM players p
         JOIN players me ON me.id = ?1 AND me.user_id IS NOT NULL AND me.user_id = p.user_id${member ? " AND me.party = 1" : ""}
         JOIN characters ch ON ch.player_id = p.id AND ch.status = 'active'
        WHERE p.id != ?1 AND p.party = 1 AND ${currentCrewSql("p.id")} IS ${currentCrewSql("?1")}
        ORDER BY p.created_at, p.id`,
    )
    .bind(playerId)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/** Is `heroId` one of the heroes on `userId`'s account, with a finished character? */
async function ownHero(db: D1Database, userId: string, heroId: string): Promise<boolean> {
  return !!(await db
    .prepare("SELECT 1 FROM players p JOIN characters ch ON ch.player_id = p.id AND ch.status = 'active' WHERE p.id = ? AND p.user_id = ?")
    .bind(heroId, userId)
    .first());
}

/**
 * Put one of the account's heroes into the party of the hero being played (`playerId`), and into the world they are
 * in, if they are not there already. Gives an error to show, or null.
 */
export async function addToParty(env: Env, userId: string, playerId: string, heroId: string): Promise<string | null> {
  const db = env.DB;
  if (heroId === playerId) return "They are the hero you are playing.";
  if (!(await ownHero(db, userId, heroId))) return "That is not one of your heroes.";
  if (!(await allInTown(db, playerId, heroId))) return PARTY_IN_TOWN;
  const crew = await crewFor(db, playerId);
  if (!crew) return "Go into a world first.";
  const there = await crewFor(db, heroId);
  if (there?.id !== crew.id) {
    const joined = await joinCrew(db, heroId, crew.id, MAX_CREW);
    if (!joined) return "This world is full.";
  }
  await db.prepare("UPDATE players SET party = 1 WHERE id IN (?, ?)").bind(playerId, heroId).run();
  // The new member shows on the Harbor's roster.
  await refreshHarbor(env, crew.id);
  return null;
}

/** Take one of the account's heroes out of the party of the hero being played (`playerId`). They stay in the world. */
export async function dropFromParty(db: D1Database, userId: string, playerId: string, heroId: string): Promise<string | null> {
  if (!(await allInTown(db, playerId, heroId))) return PARTY_IN_TOWN;
  const done = await db.prepare("UPDATE players SET party = 0 WHERE id = ? AND user_id = ?").bind(heroId, userId).run();
  return done.meta.changes > 0 ? null : "That is not one of your heroes.";
}
