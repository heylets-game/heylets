// A hut in D1: the materials its owner holds, the blueprints they know
// and the furnishings they own, read whole by getHut. What a container
// holds is in containers.ts, what is built and bought in spending.ts, and
// the ground the hut stands on in plots.ts.

import { RESOURCE_KINDS, STARTER_BLUEPRINTS, cleanFinish, type FurnishingGrant, type HutSummary, type ResourceKind, type Resources } from "@gantt-quest/world";
import { homeCrewSql, homeFurnishingIdsSql, inHomeSql, newFurnishingCrewSql, now, type Env } from "./rows";

// ---------- huts: materials, blueprints and furnishings ----------

/** Statements that add (or, with negative amounts, spend) resources. Amounts never go below zero. */
export function resourceStatements(db: D1Database, playerId: string, resources: Resources): D1PreparedStatement[] {
  return RESOURCE_KINDS.filter((kind) => resources[kind]).map((kind) =>
    db
      .prepare(
        `INSERT INTO resources (player_id, kind, qty) VALUES (?1, ?2, MAX(0, ?3))
         ON CONFLICT(player_id, kind) DO UPDATE SET qty = MAX(0, qty + ?3)`,
      )
      .bind(playerId, kind, resources[kind]!),
  );
}

export function blueprintStatement(db: D1Database, playerId: string, blueprintId: string): D1PreparedStatement {
  return db.prepare("INSERT OR IGNORE INTO blueprints (player_id, blueprint_id) VALUES (?, ?)").bind(playerId, blueprintId);
}

/** A new furnishing goes into storage, unplaced, in the hut of the world the player is in now (a boat: in every world). */
export function furnishingStatement(db: D1Database, playerId: string, furnishing: FurnishingGrant): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO furnishings (player_id, def_id, label, meta_json, created_at, crew_id) VALUES (?1, ?2, ?3, '{}', ?4, ${newFurnishingCrewSql("?1", "?2")})`)
    .bind(playerId, furnishing.defId, furnishing.label, now());
}

/**
 * SQL for the world a read of `playerId`'s home is about, and what to bind after their id: the world `crewId` names
 * (someone else's hut is read for the world the asker is in), or else the one the player is in now.
 */
export function homeWorld(crewId: string | null | undefined): { sql: string; bind: string[] } {
  return crewId === undefined ? { sql: homeCrewSql("?1"), bind: [] } : { sql: "?2", bind: [crewId ?? ""] };
}

/**
 * A player's hut tier, materials, known blueprints and furnishings. Everyone has a tier 1 hut by default. The hut,
 * its furniture and what its chests hold are those of the world `crewId` (by default the one the player is in now);
 * the materials and blueprints are the player's in every world.
 */
export async function getHut(db: D1Database, playerId: string, crewId?: string | null): Promise<HutSummary> {
  const world = homeWorld(crewId);
  const inHome = homeFurnishingIdsSql("?1", world.sql);
  const [hut, resources, blueprints, furnishings, stash, stowed] = await Promise.all([
    db
      .prepare(`SELECT tier, wall, floor, roof FROM huts WHERE player_id = ?1 AND crew_id = ${world.sql}`)
      .bind(playerId, ...world.bind)
      .first<{ tier: number; wall: string | null; floor: string | null; roof: string | null }>(),
    db.prepare("SELECT kind, qty FROM resources WHERE player_id = ? AND qty > 0").bind(playerId).all<{ kind: ResourceKind; qty: number }>(),
    db.prepare("SELECT blueprint_id FROM blueprints WHERE player_id = ?").bind(playerId).all<{ blueprint_id: string }>(),
    db
      .prepare(`SELECT id, def_id AS defId, label, q, r, facing, x, z, y, angle, on_id AS onId, in_id AS inId, meta_json AS meta FROM furnishings WHERE player_id = ?1 AND ${inHomeSql(world.sql)} ORDER BY id`)
      .bind(playerId, ...world.bind)
      .all<HutSummary["furnishings"][number] & { meta?: string | null }>(),
    db
      .prepare(`SELECT furnishing_id AS containerId, kind, qty FROM stash WHERE player_id = ?1 AND qty > 0 AND furnishing_id IN ${inHome} ORDER BY furnishing_id, kind`)
      .bind(playerId, ...world.bind)
      .all<HutSummary["stash"][number]>(),
    db
      .prepare(
        `SELECT id AS itemId, stored_in AS containerId, name, icon, slot, rarity, kind, ref, power, level_req, stat_bonus_json, upgrades, perk_amount FROM inventory
         WHERE player_id = ?1 AND stored_in IN ${inHome} ORDER BY id`,
      )
      .bind(playerId, ...world.bind)
      .all<HutSummary["stowed"][number]>(),
  ]);
  return {
    tier: hut?.tier ?? 1,
    resources: Object.fromEntries(resources.results.map((r) => [r.kind, r.qty])),
    blueprints: [...new Set([...STARTER_BLUEPRINTS, ...blueprints.results.map((b) => b.blueprint_id)])],
    // A Mounted Fish carries the catch hung on it; nothing else uses its meta yet.
    furnishings: furnishings.results.map(({ meta, ...f }) => (f.defId === "mounted_fish" ? { ...f, fish: (JSON.parse(meta || "{}") as { fish?: HutSummary["furnishings"][number]["fish"] }).fish ?? null } : f)),
    stash: stash.results,
    stowed: stowed.results,
    finish: cleanFinish(hut ?? {}),
  };
}

/** The room of `ownerId`'s hut in world `crewId`: one a hero and world, as each world's hut is its own. */
export function hutRoomOf(env: Env, ownerId: string, crewId: string) {
  return env.HUT_ROOM.get(env.HUT_ROOM.idFromName(`${ownerId}:${crewId}`));
}

/** The headers that tell a hut's room whose hut it is, in which world. */
export const hutHeaders = (ownerId: string, crewId: string): Record<string, string> => ({ "x-hut-owner": ownerId, "x-hut-crew": crewId });

/** The world a hero is in now, as a home's key ('' in none): which of their huts is "their hut" right now. */
export async function homeCrewOf(db: D1Database, playerId: string): Promise<string> {
  const row = await db.prepare(`SELECT ${homeCrewSql("?1")} AS crew`).bind(playerId).first<{ crew: string }>();
  return row?.crew ?? "";
}

/** Ask a hut's room (the owner's in world `crewId`, by default the one they are in now) to re-read the hut and tell everyone inside. Never throws. */
export async function refreshHut(env: Env, ownerId: string, crewId?: string): Promise<void> {
  try {
    const crew = crewId ?? (await homeCrewOf(env.DB, ownerId));
    await hutRoomOf(env, ownerId, crew).fetch("https://hut/refresh", { headers: hutHeaders(ownerId, crew) });
  } catch (err) {
    console.warn("hut:refresh-failed", { err: err instanceof Error ? err.message : String(err) });
  }
}
