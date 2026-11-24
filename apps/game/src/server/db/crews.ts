// Crews in D1: founding, joining and leaving one, and the board everyone
// in its Harbor is shown (who is in it and where, its works, the maps it has
// open).

import { asCrop, atlasNodeById, roofColor, type GardenBed, type HarborBoard } from "@gantt-quest/world";
import { crewWorks } from "../projects";
import { crewPresence } from "../zones";
import { parseBin } from "./plots";
import { currentCrewSql, now, type Env } from "./rows";

// ---------- crews and the Harbor ----------

export interface Crew {
  id: string;
  name: string;
}

function randomCode(length: number): string {
  // No vowels, so codes never spell anything.
  const alphabet = "BCDFGHJKLMNPQRSTVWXZ";
  return [...crypto.getRandomValues(new Uint8Array(length))].map((b) => alphabet[b % alphabet.length]).join("");
}

/** The world (crew) a hero is in now: one of the worlds they belong to (rows.ts currentCrewSql). */
export async function crewFor(db: D1Database, playerId: string): Promise<Crew | null> {
  return db.prepare(`SELECT id, name FROM crews WHERE id = ${currentCrewSql("?1")}`).bind(playerId).first<Crew>();
}

/** A world one of an account's heroes belongs to, as Join world lists it: which of the heroes are in it. */
export interface AccountWorld extends Crew {
  heroes: { id: string; name: string }[];
  members: number;
}

/** Every world an account's heroes belong to, the most recently joined first. */
export async function worldsOfAccount(db: D1Database, userId: string): Promise<AccountWorld[]> {
  const rows = await db
    .prepare(
      `SELECT cr.id, cr.name, m.player_id AS heroId, ch.name AS heroName, m.joined_at AS joinedAt,
              (SELECT COUNT(*) FROM crew_members x WHERE x.crew_id = cr.id) AS members
         FROM players p
         JOIN crew_members m ON m.player_id = p.id
         JOIN crews cr ON cr.id = m.crew_id
         LEFT JOIN characters ch ON ch.player_id = p.id AND ch.status = 'active'
        WHERE p.user_id = ?
        ORDER BY m.joined_at DESC`,
    )
    .bind(userId)
    .all<{ id: string; name: string; heroId: string; heroName: string | null; joinedAt: number; members: number }>();
  const worlds = new Map<string, AccountWorld>();
  for (const r of rows.results) {
    const w = worlds.get(r.id) ?? { id: r.id, name: r.name, heroes: [], members: r.members };
    if (r.heroName) w.heroes.push({ id: r.heroId, name: r.heroName });
    worlds.set(r.id, w);
  }
  return [...worlds.values()];
}

export async function getCrew(db: D1Database, crewId: string): Promise<Crew | null> {
  return db.prepare("SELECT id, name FROM crews WHERE id = ?").bind(crewId).first<Crew>();
}

/** Found a crew, make the founder its first member, and put them in it. They stay in any other worlds they belong to. */
export async function createCrew(db: D1Database, playerId: string, name: string): Promise<Crew> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomCode(6);
    try {
      await db.batch([
        db.prepare("INSERT INTO crews (id, name, created_by, created_at) VALUES (?, ?, ?, ?)").bind(id, name, playerId, now()),
        db.prepare("INSERT INTO crew_members (crew_id, player_id, joined_at) VALUES (?, ?, ?)").bind(id, playerId, now()),
        db.prepare("UPDATE players SET current_crew_id = ? WHERE id = ?").bind(id, playerId),
      ]);
      return { id, name };
    } catch {
      // Code collision; try another.
    }
  }
  throw new Error("could not allocate a crew code");
}

/**
 * Go into a world by its code: join it if the hero does not belong to it yet, and make it the one they are in. They
 * stay in their other worlds. `joined` is false if they already belonged. Null if there is no such world, or it is
 * full and they are not in it.
 */
export async function joinCrew(db: D1Database, playerId: string, crewId: string, maxMembers: number): Promise<(Crew & { joined: boolean }) | null> {
  const crew = await getCrew(db, crewId);
  if (!crew) return null;
  const already = await db.prepare("SELECT 1 FROM crew_members WHERE crew_id = ? AND player_id = ?").bind(crewId, playerId).first();
  if (!already) {
    const count = await db.prepare("SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?").bind(crewId).first<{ n: number }>();
    if ((count?.n ?? 0) >= maxMembers) return null;
  }
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO crew_members (crew_id, player_id, joined_at) VALUES (?, ?, ?)").bind(crewId, playerId, now()),
    db.prepare("UPDATE players SET current_crew_id = ? WHERE id = ?").bind(crewId, playerId),
  ]);
  return { ...crew, joined: !already };
}

/**
 * Leave a world for good (the one they are in now, unless one is named). A plot is land in that world's Harbor, so
 * a hut standing there gives it up, garden and all; the hut's contents stay with the hero. They are then in the
 * next of their worlds, if any.
 */
export async function leaveCrew(db: D1Database, playerId: string, crewId?: string): Promise<void> {
  const crew = crewId ?? (await crewFor(db, playerId))?.id;
  if (!crew) return;
  await db.batch([
    db.prepare("DELETE FROM crew_members WHERE player_id = ? AND crew_id = ?").bind(playerId, crew),
    db.prepare("UPDATE players SET current_crew_id = NULL WHERE id = ? AND current_crew_id = ?").bind(playerId, crew),
    // The garden was by the hut's door on that plot: it goes with it.
    db.prepare("DELETE FROM garden_beds WHERE player_id = ? AND EXISTS (SELECT 1 FROM huts WHERE player_id = ?1 AND plot_crew_id = ?2)").bind(playerId, crew),
    db.prepare("UPDATE huts SET plot = NULL, plot_crew_id = NULL WHERE player_id = ? AND plot_crew_id = ?").bind(playerId, crew),
  ]);
}

/** How long a map nobody has walked on still counts as open: as long as the atlas itself keeps a map (zones.ts CAVE_IDLE_MS). */
const OPEN_MAP_MS = 12 * 60 * 60_000;

/** What everyone in a Harbor is told about its crew: who is in it and where, its works and the maps it has open. */
export async function harborBoard(db: D1Database, crewId: string): Promise<HarborBoard> {
  // None of these needs another's answer, so they are all asked for together.
  const [works, members, zoneOf, open, gardens] = await Promise.all([
    crewWorks(db, crewId),
    db
      .prepare(
        `SELECT m.player_id AS id, c.name, c.class_id AS classId, c.level, COALESCE(h.tier, 1) AS hutTier, h.plot AS plot, h.bin_json AS bin, h.roof AS roof
         FROM crew_members m JOIN characters c ON c.player_id = m.player_id AND c.status = 'active'
         -- A hut is drawn only in the world it stands in.
         LEFT JOIN huts h ON h.player_id = m.player_id AND h.plot_crew_id = m.crew_id
         WHERE m.crew_id = ? ORDER BY m.joined_at, m.player_id`,
      )
      .bind(crewId)
      .all<{ id: string; name: string; classId: string; level: number; hutTier: number; plot: number | null; bin: string | null; roof: string | null }>(),
    // Who is out on a zone, and whether they are fighting there.
    crewPresence(db, crewId),
    // The maps the crew has open out through the waygate: made for a place on its atlas, not cleared, and walked on
    // lately (as long as the atlas itself keeps a map: zones.ts CAVE_IDLE_MS). The crew's id is its chart's seed.
    db
      .prepare("SELECT code, node FROM zones WHERE kind = 'atlas' AND crew_id = ?1 AND status != 'cleared' AND updated_at > ?2 ORDER BY updated_at DESC LIMIT 6")
      .bind(crewId, now() - OPEN_MAP_MS)
      .all<{ code: string; node: string | null }>(),
    // What is growing in each member's garden, by their hut's door.
    db
      .prepare("SELECT g.player_id, g.bed, g.crop, g.planted_at, g.ready_at, g.watered_by, g.fed_by FROM garden_beds g JOIN crew_members m ON m.player_id = g.player_id WHERE m.crew_id = ? ORDER BY g.bed")
      .bind(crewId)
      .all<{ player_id: string; bed: number; crop: string | null; planted_at: number; ready_at: number; watered_by: string | null; fed_by: string | null }>(),
  ]);
  const gardenOf = new Map<string, GardenBed[]>();
  for (const g of gardens.results) {
    const bed: GardenBed = { bed: g.bed, crop: asCrop(g.crop), plantedAt: g.planted_at, readyAt: g.ready_at, ...(g.watered_by ? { wateredBy: g.watered_by } : {}), ...(g.fed_by ? { fedBy: g.fed_by } : {}) };
    gardenOf.set(g.player_id, [...(gardenOf.get(g.player_id) ?? []), bed]);
  }

  // Members whose shack is not up yet carry what is in its bin, so the site can be drawn filling up.
  // Members whose shack stands carry what grows in their garden (an empty list for a bare one).
  // And the roof they chose for their hut, if it is still one Nell sells.
  const roster = members.results.map(({ bin, roof, ...m }) => ({
    ...m,
    ...(m.plot !== null && bin === null && roofColor(roof) ? { roof: roof! } : {}),
    ...(m.plot !== null && bin !== null ? { bin: parseBin(bin) } : {}),
    ...(m.plot !== null && bin === null ? { garden: gardenOf.get(m.id) ?? [] } : {}),
    ...(zoneOf.has(m.id) ? { zone: zoneOf.get(m.id) } : {}),
  }));
  const maps = open.results.map((z) => ({ code: z.code, node: z.node ?? "", place: (z.node ? atlasNodeById(crewId, z.node)?.name : null) ?? "a landfall" }));
  return { members: roster, works,...(maps.length > 0 ? { maps } : {}) };
}

/** Ask a crew's Harbor to re-read its notice board and tell everyone present. Never throws. */
export async function refreshHarbor(env: Env, crewId: string | null): Promise<void> {
  if (!crewId) return;
  try {
    await env.HARBOR_ROOM.get(env.HARBOR_ROOM.idFromName(crewId)).fetch("https://harbor/refresh", { headers: { "x-crew-id": crewId } });
  } catch (err) {
    console.warn("harbor:refresh-failed", { err: err instanceof Error ? err.message : String(err) });
  }
}
