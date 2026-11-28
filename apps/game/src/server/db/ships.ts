// The crew's ship in D1 (packages/world/src/voyage/ships.ts has the ships and
// the rules).
//
// Which ships a crew owns is not stored apart: every crew has the Sloop, and
// the bigger ones are crew projects, owned once built (crew_projects). The
// crew sails the best of them. What is kept here, in crew_ships, is how each
// ship's hull stands: a row from the first time it is written, and a sound
// hull where there is none. Nothing wears a hull yet (the sea encounters
// will); this file reads it, and mends it with a hero's wood.

import { checkMend, cleanHull, crewShip, projectById, type CrewShip, type ShipDef } from "@gantt-quest/world";

/** The ship a crew sails (the best it owns) and how her hull stands. */
export async function shipOf(db: D1Database, crewId: string): Promise<{ ship: ShipDef; hull: number }> {
  const [built, hulls] = await db.batch([
    db.prepare("SELECT project_id FROM crew_projects WHERE crew_id = ? AND built_at IS NOT NULL").bind(crewId),
    db.prepare("SELECT ship_id, hull FROM crew_ships WHERE crew_id = ?").bind(crewId),
  ]);
  const ship = crewShip((built.results as { project_id: string }[]).map((r) => r.project_id).filter((id) => !!projectById(id)));
  const row = (hulls.results as { ship_id: string; hull: number }[]).find((r) => r.ship_id === ship.id);
  return { ship, hull: cleanHull(ship, row?.hull) };
}

/** A crew's ship as its Harbor is told of it. */
export async function crewShipState(db: D1Database, crewId: string): Promise<CrewShip> {
  const { ship, hull } = await shipOf(db, crewId);
  return { id: ship.id, hull };
}

/**
 * Mend the crew's ship with the player's own wood: as much as her hull needs, or as far as their wood goes. Says
 * how much wood went and how her hull stands, or why nothing was mended.
 *
 * The write is one batch, and both halves of it or neither: the hull is written only if it still stands as it was
 * read and the player still holds the wood, and the wood is taken only if that write was made (it is known by its
 * time). So a second press, or a crewmate mending at the same moment, cannot spend wood for nothing.
 */
export async function mendShip(db: D1Database, crewId: string, playerId: string): Promise<{ error: string } | { wood: number; ship: CrewShip }> {
  const [{ ship, hull }, held] = await Promise.all([
    shipOf(db, crewId),
    db.prepare("SELECT qty FROM resources WHERE player_id = ? AND kind = 'wood'").bind(playerId).first<{ qty: number }>(),
  ]);
  const check = checkMend(ship, hull, held?.qty ?? 0);
  if (!check.ok) return { error: check.error };
  const at = Date.now();
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO crew_ships (crew_id, ship_id, hull, updated_at)
         SELECT ?1, ?2, ?3, ?4
         WHERE COALESCE((SELECT hull FROM crew_ships WHERE crew_id = ?1 AND ship_id = ?2), ?5) = ?6
           AND COALESCE((SELECT qty FROM resources WHERE player_id = ?7 AND kind = 'wood'), 0) >= ?8
         ON CONFLICT(crew_id, ship_id) DO UPDATE SET hull = excluded.hull, updated_at = excluded.updated_at`,
      )
      .bind(crewId, ship.id, check.hull, at, ship.hull, hull, playerId, check.wood),
    db
      .prepare(
        `UPDATE resources SET qty = qty - ?1 WHERE player_id = ?2 AND kind = 'wood' AND qty >= ?1
           AND EXISTS (SELECT 1 FROM crew_ships WHERE crew_id = ?3 AND ship_id = ?4 AND hull = ?5 AND updated_at = ?6)`,
      )
      .bind(check.wood, playerId, crewId, ship.id, check.hull, at),
  ]);
  if (res[1].meta.changes === 0) return { error: "Someone else was mending her, or your wood changed. Look again." };
  return { wood: check.wood, ship: await crewShipState(db, crewId) };
}
