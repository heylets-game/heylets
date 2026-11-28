// The crew's ship on the server: how far she lets a crew set out and how many she carries (src/server/atlas.ts),
// her hull and mending it (src/server/db/ships.ts), what the Harbor's board says of her, and the migration that
// gave a ship to every crew that had already been further out than the Sloop goes (0069). Against a real SQLite
// database with the game's migrations applied (the stand-in for D1 in d1.ts).

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { HULL_PER_WOOD, SHIPS, atlasNodeById, crewShip, projectById, stoneItem, type AtlasNode, type ZoneOptions } from "@gantt-quest/world";
import { atlasSeed, clearNode, openNode, scoutNode } from "../src/server/atlas";
import { harborBoard } from "../src/server/db";
import { mendShip, shipOf } from "../src/server/db/ships";
import { contribute } from "../src/server/projects";
import { getZoneRow } from "../src/server/zones";
import { addHero, openDb } from "./d1";

let sql: DatabaseSync;
let db: D1Database;
const CREW = "CREWAA";
const [sloop, brig, galleon] = SHIPS;

beforeEach(() => {
  ({ sql, db } = openDb());
  for (const [id, name] of [["ann", "Ann"], ["bo", "Bo"]]) addHero(sql, { id, name, crew: CREW });
});

const node = (id: string, crew = CREW) => atlasNodeById(atlasSeed(crew), id)!;
/** A place in this ring, and the places a route runs through to it from the Harbor, the nearest first. */
function wayTo(ring: number, crew = CREW): { place: AtlasNode; through: AtlasNode[] } {
  const place = node(`${ring},0`, crew);
  const through: AtlasNode[] = [];
  for (let at = place; at.ring > 1; ) {
    at = at.links.map((id) => node(id, crew)).find((n) => n.ring === at.ring - 1)!;
    through.unshift(at);
  }
  return { place, through };
}
/** The crew has cleared its way out to a place in this ring, which is now open to it. */
async function reached(ring: number, crew = CREW): Promise<AtlasNode> {
  const { place, through } = wayTo(ring, crew);
  for (const n of through) await clearNode(db, crew, n.id);
  return place;
}
const giveStone = (who = "ann") => sql.prepare("INSERT INTO consumables (player_id, kind, qty) VALUES (?, ?, 1) ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + 1").run(who, stoneItem([]));
const launch = (ship: string, crew = CREW) => sql.prepare("INSERT INTO crew_projects (crew_id, project_id, built_at) VALUES (?, ?, 1)").run(crew, ship);
const wood = (who: string) => (sql.prepare("SELECT qty FROM resources WHERE player_id = ? AND kind = 'wood'").get(who) as { qty: number } | undefined)?.qty ?? 0;
const stock = (who: string, kind: string, qty: number) => sql.prepare("INSERT INTO resources (player_id, kind, qty) VALUES (?, ?, ?) ON CONFLICT(player_id, kind) DO UPDATE SET qty = excluded.qty").run(who, kind, qty);
const wear = (ship: string, hull: number, crew = CREW) => sql.prepare("INSERT INTO crew_ships (crew_id, ship_id, hull, updated_at) VALUES (?, ?, ?, 1) ON CONFLICT(crew_id, ship_id) DO UPDATE SET hull = excluded.hull").run(crew, ship, hull);

describe("the crew's ship", () => {
  it("is the Sloop for a new crew, sound, and the board says so", async () => {
    expect(await shipOf(db, CREW)).toEqual({ ship: sloop, hull: sloop.hull });
    expect((await harborBoard(db, CREW)).ship).toEqual({ id: "sloop", hull: sloop.hull });
  });

  it("becomes the Brig the moment the crew's last gift finishes her at the works, and the Galleon after that", async () => {
    const pay = async (id: string) => {
      const cost = projectById(id)!.cost;
      sql.prepare("UPDATE characters SET gold = ? WHERE player_id = 'ann'").run(cost.gold ?? 0);
      for (const [kind, qty] of Object.entries(cost)) if (kind !== "gold") stock("ann", kind, qty!);
      return contribute(db, CREW, "ann", id, cost);
    };
    // The Galleon cannot be started before the Brig is afloat.
    expect(await pay("galleon")).toEqual({ error: "The Galleon is locked. Unlocks once the Brig is built." });
    expect(await pay("brig")).toMatchObject({ completed: true });
    expect((await shipOf(db, CREW)).ship).toBe(brig);
    expect((await harborBoard(db, CREW)).ship).toEqual({ id: "brig", hull: brig.hull });
    expect(await pay("galleon")).toMatchObject({ completed: true });
    expect((await shipOf(db, CREW)).ship).toBe(galleon);
  });
});

describe("how far she sails", () => {
  it("lets the Sloop set out for ring 3 and no further, and says what would", async () => {
    const near = await reached(3);
    giveStone();
    expect(await scoutNode(db, CREW, near.id, "")).toMatchObject({ node: near.id });
    expect(await openNode(db, CREW, "ann", near.id, 1, "")).toMatchObject({ fresh: true });

    await clearNode(db, CREW, near.id);
    const far = await reached(4);
    giveStone();
    const why = `${far.name} lies too far out for the Sloop: she sails no further than 3 landfalls from the Harbor. The Brig will reach it, once the crew has built her at the works.`;
    expect(await scoutNode(db, CREW, far.id, "")).toEqual({ error: why, status: 409 });
    expect(await openNode(db, CREW, "ann", far.id, 1, "")).toEqual({ error: why, status: 409 });
    // Nothing was spent on the refusal.
    expect(sql.prepare("SELECT qty FROM consumables WHERE player_id = 'ann'").get()).toEqual({ qty: 1 });

    launch("brig");
    expect(await scoutNode(db, CREW, far.id, "")).toMatchObject({ node: far.id, most: brig.heroes });
    expect(await openNode(db, CREW, "ann", far.id, 1, "")).toMatchObject({ fresh: true });
  });

  it("lets the Brig go to ring 7 and the Galleon past it", async () => {
    launch("brig");
    const far = await reached(8);
    giveStone();
    expect(await openNode(db, CREW, "ann", far.id, 1, "")).toMatchObject({ error: expect.stringMatching(/too far out for the Brig.*The Galleon will reach it/) });
    launch("galleon");
    expect(await openNode(db, CREW, "ann", far.id, 1, "")).toMatchObject({ fresh: true });
  });

  it("always lets a crew back onto a map it is already fighting through, whatever its ship", async () => {
    // Opened before ships (as if through the waygate): a map at ring 5, still live, the crew with only its Sloop.
    launch("brig");
    const far = await reached(5);
    giveStone();
    const went = await openNode(db, CREW, "ann", far.id, 1, "");
    if ("error" in went) throw new Error(went.error);
    sql.prepare("DELETE FROM crew_projects WHERE crew_id = ?").run(CREW);
    expect((await shipOf(db, CREW)).ship).toBe(sloop);
    expect(await openNode(db, CREW, "bo", far.id, 1)).toEqual({ code: went.code, fresh: false });
    expect(await scoutNode(db, CREW, far.id)).toEqual({ live: went.code });
  });
});

describe("how many she carries", () => {
  const partyOf = async (code: string) => (JSON.parse((await getZoneRow(db, code))!.options_json) as ZoneOptions).party;

  it("sizes the muster and the map by the ship: four in the Sloop, five in the Brig, six in the Galleon", async () => {
    const beside = node("1,0");
    for (const [ship, most] of [[null, 4], ["brig", 5], ["galleon", 6]] as const) {
      if (ship) launch(ship);
      expect(await scoutNode(db, CREW, beside.id)).toMatchObject({ most });
      // A map made for more than she carries is made for as many as she carries.
      const went = await openNode(db, CREW, "ann", beside.id, 6);
      if ("error" in went) throw new Error(went.error);
      expect(await partyOf(went.code)).toBe(most);
      sql.prepare("DELETE FROM atlas_nodes WHERE crew_id = ?").run(CREW);
      sql.prepare("DELETE FROM zones WHERE crew_id = ?").run(CREW);
    }
  });

  it("still makes a small map for a small party", async () => {
    const went = await openNode(db, CREW, "ann", node("1,0").id, 2);
    if ("error" in went) throw new Error(went.error);
    expect(await partyOf(went.code)).toBe(2);
  });
});

describe("mending her hull", () => {
  it("has nothing to mend on a sound ship, and takes no wood", async () => {
    stock("ann", "wood", 20);
    expect(await mendShip(db, CREW, "ann")).toEqual({ error: "The Sloop's hull is sound: there is nothing to mend." });
    expect(wood("ann")).toBe(20);
  });

  it("takes only the wood she needs, and the board shows her sound again", async () => {
    wear("sloop", sloop.hull - 3 * HULL_PER_WOOD + 1);
    expect((await harborBoard(db, CREW)).ship).toEqual({ id: "sloop", hull: sloop.hull - 3 * HULL_PER_WOOD + 1 });
    stock("ann", "wood", 20);
    expect(await mendShip(db, CREW, "ann")).toEqual({ wood: 3, ship: { id: "sloop", hull: sloop.hull } });
    expect(wood("ann")).toBe(17);
    expect((await harborBoard(db, CREW)).ship).toEqual({ id: "sloop", hull: sloop.hull });
  });

  it("goes as far as the wood does, and needs wood at all", async () => {
    wear("sloop", 10);
    expect(await mendShip(db, CREW, "ann")).toEqual({ error: "Mending takes wood, and you have none." });
    stock("ann", "wood", 2);
    expect(await mendShip(db, CREW, "ann")).toEqual({ wood: 2, ship: { id: "sloop", hull: 10 + 2 * HULL_PER_WOOD } });
    expect(wood("ann")).toBe(0);
  });

  it("mends the ship the crew sails, and keeps each ship's hull apart", async () => {
    wear("sloop", 5);
    launch("brig");
    expect(await shipOf(db, CREW)).toEqual({ ship: brig, hull: brig.hull });
    wear("brig", brig.hull - HULL_PER_WOOD);
    stock("bo", "wood", 9);
    expect(await mendShip(db, CREW, "bo")).toEqual({ wood: 1, ship: { id: "brig", hull: brig.hull } });
    expect(sql.prepare("SELECT ship_id, hull FROM crew_ships WHERE crew_id = ? ORDER BY ship_id").all(CREW)).toEqual([{ ship_id: "brig", hull: brig.hull }, { ship_id: "sloop", hull: 5 }]);
  });

  it("holds a stored hull to what the ship can have", async () => {
    wear("sloop", 9999);
    expect((await shipOf(db, CREW)).hull).toBe(sloop.hull);
  });
});

describe("migration 0069", () => {
  it("gives every crew that had cleared a place past a ship's reach the ship that covers it", () => {
    const dir = new URL("../migrations/", import.meta.url);
    const files = readdirSync(dir).sort();
    const old = new DatabaseSync(":memory:");
    for (const f of files.filter((f) => f < "0069")) old.exec(readFileSync(new URL(f, dir), "utf8"));
    const run = (text: string, ...args: (string | number | null)[]) => old.prepare(text).run(...args);
    run("INSERT INTO players (id, name, created_at) VALUES ('ann', 'Ann', 0)");
    // Five crews: one that has cleared nothing; one out to ring 3; one to ring 4; one to ring 8; and one to ring 5
    // that had already begun the Brig and has a place past ring 7 open but not cleared.
    for (const id of ["NEW", "NEAR", "MID", "FAR", "PAID"]) run("INSERT INTO crews (id, name, created_by, created_at) VALUES (?, ?, 'ann', 0)", id, id);
    const cleared = (crew: string, node: string, status = "cleared") => run("INSERT INTO atlas_nodes (crew_id, node, status, attempts, opened_at) VALUES (?, ?, ?, 0, 0)", crew, node, status);
    for (const n of ["1,0", "2,-1", "-3,1", "0,3", "3,-3"]) cleared("NEAR", n);
    for (const n of ["1,0", "2,0", "3,0", "-2,-2"]) cleared("MID", n);
    for (const n of ["1,0", "4,0", "-8,3", "5,-5"]) cleared("FAR", n);
    for (const n of ["1,0", "0,-5"]) cleared("PAID", n);
    cleared("PAID", "9,0", "open");
    run("INSERT INTO crew_projects (crew_id, project_id, built_at) VALUES ('PAID', 'brig', NULL), ('PAID', 'smithy', 77)");
    run("INSERT INTO crew_project_paid (crew_id, project_id, kind, qty, cap) VALUES ('PAID', 'brig', 'wood', 30, 120)");

    old.exec(readFileSync(new URL(files.find((f) => f.startsWith("0069"))!, dir), "utf8"));

    const built = (crew: string) => (old.prepare("SELECT project_id FROM crew_projects WHERE crew_id = ? AND built_at IS NOT NULL ORDER BY project_id").all(crew) as { project_id: string }[]).map((r) => r.project_id);
    expect(built("NEW")).toEqual([]);
    expect(built("NEAR")).toEqual([]);
    expect(built("MID")).toEqual(["brig"]);
    expect(built("FAR")).toEqual(["brig", "galleon"]);
    expect(built("PAID")).toEqual(["brig", "smithy"]);
    expect(["NEW", "NEAR", "MID", "FAR", "PAID"].map((crew) => crewShip(built(crew)).id)).toEqual(["sloop", "sloop", "brig", "galleon", "brig"]);
    // Every one of them can still sail to the furthest place it had cleared.
    const ring = (id: string) => {
      const [q, r] = id.split(",").map(Number);
      return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
    };
    for (const crew of ["NEAR", "MID", "FAR", "PAID"]) {
      const far = Math.max(...(old.prepare("SELECT node FROM atlas_nodes WHERE crew_id = ? AND status = 'cleared'").all(crew) as { node: string }[]).map((n) => ring(n.node)));
      const ship = crewShip(built(crew));
      expect(ship.reach === null || far <= ship.reach, crew).toBe(true);
    }
    // What a crew had paid toward a ship it was then given is left as it was, and the smithy keeps its own date.
    expect(old.prepare("SELECT qty FROM crew_project_paid WHERE crew_id = 'PAID' AND project_id = 'brig'").get()).toEqual({ qty: 30 });
    expect(old.prepare("SELECT built_at FROM crew_projects WHERE crew_id = 'PAID' AND project_id = 'smithy'").get()).toEqual({ built_at: 77 });
    // The hull table is there, and empty: every ship is sound.
    expect(old.prepare("SELECT COUNT(*) AS n FROM crew_ships").get()).toEqual({ n: 0 });
  });
});
