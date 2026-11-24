// The garden by a hut's door in D1 (packages/world/src/garden.ts has the rules): a row per bed with something
// growing in it. Its owner plants and picks it; anyone in their crew may water it and feed it bonemeal. Every
// change is one batch whose first statement re-checks what the rules checked on a read, so two requests at once
// (a double click, two crewmates watering together) cannot both go through.

import {
  BONEMEAL_PER_BONE,
  CAN_CAPACITY,
  CAN_PRICE,
  canBuyProblem,
  fillProblem,
  SEED_PRICE,
  CROP_GROW_MS,
  CROPS,
  asCrop,
  cropOf,
  feedProblem,
  fedReadyAt,
  gardenBeds,
  grindProblem,
  plantProblem,
  seedBuyProblem,
  waterProblem,
  gardenHarvest,
  HARBOR_XP,
  type GardenBed,
  type Resources,
  type SowWith,
} from "@gantt-quest/world";
import { getCharacter, getHut, homeOf, resourceStatements } from "./db";
import { prepareXp, xpOutcome, type XpResult } from "./harbor-xp";

const now = () => Date.now();

interface BedRow {
  player_id: string;
  bed: number;
  crop: string;
  planted_at: number;
  ready_at: number;
  watered_by: string | null;
  fed_by: string | null;
}

const toBed = (r: BedRow): GardenBed => ({ bed: r.bed, crop: asCrop(r.crop), plantedAt: r.planted_at, readyAt: r.ready_at, ...(r.watered_by ? { wateredBy: r.watered_by } : {}), ...(r.fed_by ? { fedBy: r.fed_by } : {}) });

/** What is growing in a player's garden, a bed at a time. */
export async function gardenOf(db: D1Database, playerId: string): Promise<GardenBed[]> {
  const rows = await db.prepare("SELECT * FROM garden_beds WHERE player_id = ? ORDER BY bed").bind(playerId).all<BedRow>();
  return rows.results.map(toBed);
}

/** The garden as its panel shows it: how many beds, what grows in them, and what the asker holds to tend it with. */
export interface GardenView {
  owner: string;
  beds: number;
  growing: GardenBed[];
  /** The asker's own stock of what a garden takes. */
  held: Pick<Resources, "seeds" | "herbs" | "mushrooms" | "bonemeal" | "bone">;
  /** The asker's watering can: how many waterings are in it (null: they have none). */
  can: number | null;
  gold: number;
  now: number;
}

/** The owner's garden, if their shack stands: else why there is none. */
async function gardenSize(db: D1Database, ownerId: string): Promise<number | string> {
  const [home, hut] = await Promise.all([homeOf(db, ownerId), getHut(db, ownerId)]);
  if (home.plot === null || home.bin !== null) return "There is no garden there until the shack stands.";
  return gardenBeds(hut.tier);
}

export async function gardenView(db: D1Database, askerId: string, ownerId: string): Promise<GardenView | string> {
  const [size, growing, hut, c, can] = await Promise.all([gardenSize(db, ownerId), gardenOf(db, ownerId), getHut(db, askerId), getCharacter(db, askerId), canOf(db, askerId)]);
  if (typeof size === "string") return size;
  const r = hut.resources;
  return { owner: ownerId, beds: size, growing, held: { seeds: r.seeds ?? 0, herbs: r.herbs ?? 0, mushrooms: r.mushrooms ?? 0, bonemeal: r.bonemeal ?? 0, bone: r.bone ?? 0 }, can, gold: c?.gold ?? 0, now: now() };
}

/** Plant one of your own beds with a packet of seeds or a herb (it grows herbs), or a mushroom (it grows mushrooms). */
export async function plantBed(db: D1Database, playerId: string, bed: unknown, with_: unknown): Promise<string | null> {
  const [size, growing, hut] = await Promise.all([gardenSize(db, playerId), gardenOf(db, playerId), getHut(db, playerId)]);
  if (typeof size === "string") return "Your shack has to stand before there is a garden by its door.";
  const problem = plantProblem({ tier: hut.tier, beds: growing, resources: hut.resources }, bed, with_);
  if (problem) return problem;
  const t = now();
  const sow = with_ as SowWith;
  const crop = cropOf(sow);
  const [took, planted] = await db.batch([
    db.prepare("UPDATE resources SET qty = qty - 1 WHERE player_id = ?1 AND kind = ?2 AND qty >= 1").bind(playerId, sow),
    db
      .prepare("INSERT OR IGNORE INTO garden_beds (player_id, bed, crop, planted_at, ready_at) SELECT ?1, ?2, ?5, ?3, ?4 WHERE changes() > 0")
      .bind(playerId, bed as number, t, t + CROP_GROW_MS[crop], crop),
  ]).then((res) => res.map((r) => r.meta.changes));
  if (!took) return "You no longer have that to plant.";
  if (!planted) {
    // Planted already, by a request a moment before this one: this one's seed goes back.
    await db.batch(resourceStatements(db, playerId, { [sow]: 1 }));
    return "Something is already growing there.";
  }
  return null;
}

/** A name for whoever is tending: their hero's. */
async function tender(db: D1Database, playerId: string): Promise<string | null> {
  const c = await getCharacter(db, playerId);
  return c?.status === "active" ? c.name : null;
}

// ---------- the watering can ----------

/** How many waterings are in a player's watering can, or null if they have none. */
export async function canOf(db: D1Database, playerId: string): Promise<number | null> {
  const row = await db.prepare("SELECT water FROM watering_cans WHERE player_id = ?").bind(playerId).first<{ water: number }>();
  return row ? row.water : null;
}

/** Buy a watering can at the market stall. It comes empty: fill it at the well. */
export async function buyCan(db: D1Database, playerId: string): Promise<string | null> {
  const [c, can] = await Promise.all([getCharacter(db, playerId), canOf(db, playerId)]);
  if (c?.status !== "active") return "Create a character first.";
  const problem = canBuyProblem(can, c.gold);
  if (problem) return problem;
  const [paid] = await db.batch([
    db
      .prepare("UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND status = 'active' AND gold >= ?2 AND NOT EXISTS (SELECT 1 FROM watering_cans WHERE player_id = ?1)")
      .bind(playerId, CAN_PRICE),
    db.prepare("INSERT OR IGNORE INTO watering_cans (player_id, water) SELECT ?1, 0 WHERE changes() > 0").bind(playerId),
  ]);
  return paid.meta.changes > 0 ? null : "You have a watering can already.";
}

/** Fill your watering can to the brim at the town well. */
export async function fillCan(db: D1Database, playerId: string): Promise<string | { water: number }> {
  const problem = fillProblem(await canOf(db, playerId));
  if (problem) return problem;
  await db.prepare("UPDATE watering_cans SET water = ?2 WHERE player_id = ?1").bind(playerId, CAN_CAPACITY).run();
  return { water: CAN_CAPACITY };
}

/** Water a bed in `ownerId`'s garden (yours, or a crewmate's: the route checks the crew) from your watering can. */
export async function waterBed(db: D1Database, playerId: string, ownerId: string, bed: unknown): Promise<string | null> {
  const [growing, name, can] = await Promise.all([gardenOf(db, ownerId), tender(db, playerId), canOf(db, playerId)]);
  if (!name) return "Create a character first.";
  const t = now();
  const problem = waterProblem(growing.find((b) => b.bed === bed), t, can);
  if (problem) return problem;
  // A watering from the can, and the bed watered only if the can had it.
  const [poured, watered] = await db.batch([
    db.prepare("UPDATE watering_cans SET water = water - 1 WHERE player_id = ?1 AND water >= 1").bind(playerId),
    db
      .prepare("UPDATE garden_beds SET watered_by = ?3 WHERE player_id = ?1 AND bed = ?2 AND watered_by IS NULL AND ready_at > ?4 AND changes() > 0")
      .bind(ownerId, bed as number, name, t),
  ]).then((res) => res.map((r) => r.meta.changes));
  if (!poured) return "Your watering can is empty. Fill it at the well on the green.";
  if (!watered) {
    // Someone watered it a moment before: the water goes back in the can.
    await db.prepare("UPDATE watering_cans SET water = MIN(?2, water + 1) WHERE player_id = ?1").bind(playerId, CAN_CAPACITY).run();
    return "Someone has just watered it.";
  }
  return null;
}

/** Feed a bed in `ownerId`'s garden a scoop of your bonemeal: what it still has to grow is halved. */
export async function feedBed(db: D1Database, playerId: string, ownerId: string, bed: unknown): Promise<string | null> {
  const [growing, name, hut] = await Promise.all([gardenOf(db, ownerId), tender(db, playerId), getHut(db, playerId)]);
  if (!name) return "Create a character first.";
  const t = now();
  const b = growing.find((x) => x.bed === bed);
  const problem = feedProblem(b, hut.resources, t);
  if (problem) return problem;
  const [took, fed] = await db.batch([
    db.prepare("UPDATE resources SET qty = qty - 1 WHERE player_id = ?1 AND kind = 'bonemeal' AND qty >= 1").bind(playerId),
    db
      .prepare("UPDATE garden_beds SET fed_by = ?3, ready_at = ?4 WHERE player_id = ?1 AND bed = ?2 AND fed_by IS NULL AND ready_at = ?5 AND changes() > 0")
      .bind(ownerId, bed as number, name, fedReadyAt(b!, t), b!.readyAt),
  ]).then((res) => res.map((r) => r.meta.changes));
  if (!took) return "You no longer have any bonemeal.";
  if (!fed) {
    await db.batch(resourceStatements(db, playerId, { bonemeal: 1 }));
    return "Someone has just fed it.";
  }
  return null;
}

/**
 * Pick every ready bed in your garden: what grew in them (herbs, mushrooms) goes to you, the beds are bare again,
 * and a little Harbor XP.
 */
export async function pickGarden(db: D1Database, playerId: string): Promise<string | { herbs: number; mushrooms: number; beds: number; xp?: XpResult }> {
  const t = now();
  const ready = (await gardenOf(db, playerId)).filter((b) => b.readyAt <= t);
  if (ready.length === 0) return "Nothing is ready to pick yet.";
  const harvest = gardenHarvest(playerId, ready);
  const crops = CROPS.filter((c) => (harvest[c] ?? 0) > 0);
  const xp = await prepareXp(db, playerId, HARBOR_XP.gardenBed * ready.length);
  // The beds are cleared in one statement, only as they were read (the same plantings), and each crop given only if
  // every one of them was (the first) or the crop before it was (the rest): a second pick at the same moment clears
  // nothing and is paid nothing.
  const plantings = ready.map((b) => `'${b.bed}:${b.plantedAt}'`).join(",");
  const results = await db.batch([
    db.prepare(`DELETE FROM garden_beds WHERE player_id = ?1 AND ready_at <= ?2 AND (bed || ':' || planted_at) IN (${plantings})`).bind(playerId, t),
    ...crops.map((crop, i) =>
      db
        .prepare("INSERT INTO resources (player_id, kind, qty) SELECT ?1, ?2, ?3 WHERE changes() = ?4 ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + ?3")
        .bind(playerId, crop, harvest[crop]!, i === 0 ? ready.length : 1),
    ),
    ...(xp?.statements() ?? []),
  ]);
  if (results[0].meta.changes !== ready.length || crops.some((_, i) => results[1 + i].meta.changes === 0)) return "Someone picked it just now.";
  return { herbs: harvest.herbs ?? 0, mushrooms: harvest.mushrooms ?? 0, beds: ready.length, xp: xpOutcome(xp, results) };
}

/** Grind bones into bonemeal: BONEMEAL_PER_BONE scoops a bone. */
export async function grindBone(db: D1Database, playerId: string, qty: unknown): Promise<string | { bonemeal: number }> {
  const hut = await getHut(db, playerId);
  const problem = grindProblem(qty, hut.resources);
  if (problem) return problem;
  const n = qty as number;
  const [took] = await db.batch([
    db.prepare("UPDATE resources SET qty = qty - ?2 WHERE player_id = ?1 AND kind = 'bone' AND qty >= ?2").bind(playerId, n),
    db
      .prepare("INSERT INTO resources (player_id, kind, qty) SELECT ?1, 'bonemeal', ?2 WHERE changes() > 0 ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + ?2")
      .bind(playerId, n * BONEMEAL_PER_BONE),
  ]);
  return took.meta.changes > 0 ? { bonemeal: n * BONEMEAL_PER_BONE } : "You no longer have those bones.";
}

/** Buy packets of herb seeds at the market stall. */
export async function buySeeds(db: D1Database, playerId: string, qty: unknown): Promise<string | { seeds: number; gold: number }> {
  const c = await getCharacter(db, playerId);
  if (c?.status !== "active") return "Create a character first.";
  const problem = seedBuyProblem(qty, c.gold);
  if (problem) return problem;
  const n = qty as number;
  const cost = n * SEED_PRICE;
  const [paid] = await db.batch([
    db.prepare("UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND status = 'active' AND gold >= ?2").bind(playerId, cost),
    db
      .prepare("INSERT INTO resources (player_id, kind, qty) SELECT ?1, 'seeds', ?2 WHERE changes() > 0 ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + ?2")
      .bind(playerId, n),
  ]);
  return paid.meta.changes > 0 ? { seeds: n, gold: cost } : "Not enough gold.";
}
