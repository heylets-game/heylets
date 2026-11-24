// The garden by a hut's door against a real SQLite database with the game's migrations applied (the stand-in
// for D1 in d1.ts, where a batch is one transaction).

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BONEMEAL_PER_BONE, CAN_CAPACITY, CAN_PRICE, CROP_GROW_MS, GARDEN_YIELD, GROW_MS, HARBOR_XP, SEED_PRICE, bedYield } from "@gantt-quest/world";
import { buyCan, buySeeds, canOf, feedBed, fillCan, gardenView, grindBone, pickGarden, plantBed, waterBed } from "../src/server/garden";
import { harborBoard, leaveCrew } from "../src/server/db";
import { addHero, openDb, type Row } from "./d1";

const CREW = "CREWAA";
const T0 = Date.UTC(2026, 10, 20, 9);
let sql: DatabaseSync;
let db: D1Database;

const one = <T = Row>(text: string, ...args: (string | number)[]) => sql.prepare(text).get(...args) as T;
const qty = (kind: string, id = "ann") => one<{ qty: number } | undefined>("SELECT qty FROM resources WHERE player_id = ? AND kind = ?", id, kind)?.qty ?? 0;
const give = (kind: string, n: number, id = "ann") => sql.prepare("INSERT INTO resources (player_id, kind, qty) VALUES (?, ?, ?) ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + excluded.qty").run(id, kind, n);
const gold = (id = "ann") => one<{ gold: number }>("SELECT gold FROM characters WHERE player_id = ?", id).gold;
const bedRow = (bed: number, id = "ann") => one<Row | undefined>("SELECT * FROM garden_beds WHERE player_id = ? AND bed = ?", id, bed);
/** A hut standing on plot `plot`, of `tier`. */
/** A watering can holding `water`. */
const can = (id: string, water = CAN_CAPACITY) => sql.prepare("INSERT OR REPLACE INTO watering_cans (player_id, water) VALUES (?, ?)").run(id, water);
const shack = (id: string, plot: number, tier = 1) => sql.prepare("INSERT INTO huts (player_id, tier, plot, bin_json) VALUES (?, ?, ?, NULL)").run(id, tier, plot);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  ({ sql, db } = openDb());
  for (const [id, name, crew] of [["ann", "Ann", CREW], ["bo", "Bo", CREW], ["cy", "Cy", "OTHERS"]] as const) addHero(sql, { id, name, crew, at: T0 - 86_400_000 });
  shack("ann", 0);
});
afterEach(() => vi.useRealTimers());

describe("planting", () => {
  it("needs a shack standing", async () => {
    expect(await gardenView(db, "bo", "bo")).toMatch(/shack stands/);
    give("seeds", 1, "bo");
    expect(await plantBed(db, "bo", 0, "seeds")).toMatch(/shack has to stand/);
    expect(qty("seeds", "bo")).toBe(1);
  });

  it("sows a bed with a packet of seeds or a herb, and only one thing to a bed", async () => {
    give("seeds", 2);
    give("herbs", 1);
    expect(await plantBed(db, "ann", 0, "seeds")).toBeNull();
    expect(qty("seeds")).toBe(1);
    expect(bedRow(0)).toMatchObject({ crop: "herbs", planted_at: T0, ready_at: T0 + GROW_MS, watered_by: null, fed_by: null });
    expect(await plantBed(db, "ann", 0, "herbs")).toMatch(/already growing/);
    expect(await plantBed(db, "ann", 1, "herbs")).toBeNull();
    expect(qty("herbs")).toBe(0);
    // A Shack's garden has two beds.
    expect(await plantBed(db, "ann", 2, "seeds")).toMatch(/no such bed/);
    expect(qty("seeds")).toBe(1);
  });

  it("plants a mushroom from your stock, and it grows mushrooms, more slowly", async () => {
    expect(await plantBed(db, "ann", 0, "mushrooms")).toMatch(/caverns/);
    give("mushrooms", 2);
    expect(await plantBed(db, "ann", 0, "mushrooms")).toBeNull();
    expect(qty("mushrooms")).toBe(1);
    expect(bedRow(0)).toMatchObject({ crop: "mushrooms", planted_at: T0, ready_at: T0 + CROP_GROW_MS.mushrooms });
    const v = await gardenView(db, "ann", "ann");
    expect(typeof v !== "string" && v.growing).toEqual([{ bed: 0, crop: "mushrooms", plantedAt: T0, readyAt: T0 + CROP_GROW_MS.mushrooms }]);
    expect(typeof v !== "string" && v.held.mushrooms).toBe(1);
  });

  it("plants once when asked twice at the same moment, and keeps the second seed", async () => {
    give("seeds", 2);
    const both = await Promise.all([plantBed(db, "ann", 0, "seeds"), plantBed(db, "ann", 0, "seeds")]);
    expect(both.filter((e) => e === null)).toHaveLength(1);
    expect(qty("seeds")).toBe(1);
  });

  it("has a bed more for each tier of hut", async () => {
    sql.prepare("UPDATE huts SET tier = 3 WHERE player_id = 'ann'").run();
    const v = await gardenView(db, "ann", "ann");
    expect(typeof v !== "string" && v.beds).toBe(4);
  });
});

describe("tending", () => {
  beforeEach(async () => {
    give("seeds", 1);
    expect(await plantBed(db, "ann", 0, "seeds")).toBeNull();
  });

  it("is watered once, by anyone with water in their can, for one more herb", async () => {
    expect(await waterBed(db, "bo", "ann", 0)).toMatch(/no watering can/);
    can("bo", 0);
    expect(await waterBed(db, "bo", "ann", 0)).toMatch(/empty/);
    can("bo", 2);
    expect(await waterBed(db, "bo", "ann", 0)).toBeNull();
    expect(await canOf(db, "bo")).toBe(1);
    expect(bedRow(0)?.watered_by).toBe("Bo");
    can("ann");
    expect(await waterBed(db, "ann", "ann", 0)).toMatch(/Bo has watered it/);
    expect(await canOf(db, "ann")).toBe(CAN_CAPACITY);
    expect(await waterBed(db, "ann", "ann", 1)).toMatch(/Nothing is growing/);
  });

  it("is fed bonemeal once, which halves the growing left, and spends the feeder's", async () => {
    vi.setSystemTime(T0 + GROW_MS / 2);
    expect(await feedBed(db, "bo", "ann", 0)).toMatch(/no bonemeal/);
    give("bonemeal", 2, "bo");
    expect(await feedBed(db, "bo", "ann", 0)).toBeNull();
    expect(qty("bonemeal", "bo")).toBe(1);
    expect(bedRow(0)).toMatchObject({ fed_by: "Bo", ready_at: T0 + GROW_MS / 2 + GROW_MS / 4 });
    expect(await feedBed(db, "bo", "ann", 0)).toMatch(/fed it bonemeal already/);
    expect(qty("bonemeal", "bo")).toBe(1);
  });

  it("feeds once when two feed at the same moment, and gives the loser's bonemeal back", async () => {
    give("bonemeal", 1, "bo");
    give("bonemeal", 1, "ann");
    const both = await Promise.all([feedBed(db, "bo", "ann", 0), feedBed(db, "ann", "ann", 0)]);
    expect(both.filter((e) => e === null)).toHaveLength(1);
    expect(qty("bonemeal", "bo") + qty("bonemeal", "ann")).toBe(1);
  });

  it("waters once when two water at the same moment, and the loser keeps their water", async () => {
    can("bo", 1);
    can("ann", 1);
    const both = await Promise.all([waterBed(db, "bo", "ann", 0), waterBed(db, "ann", "ann", 0)]);
    expect(both.filter((e) => e === null)).toHaveLength(1);
    expect((await canOf(db, "bo"))! + (await canOf(db, "ann"))!).toBe(1);
  });

  it("is not watered once it is ready", async () => {
    can("bo");
    vi.setSystemTime(T0 + GROW_MS);
    expect(await waterBed(db, "bo", "ann", 0)).toMatch(/ready to pick/);
  });
});

describe("picking", () => {
  beforeEach(async () => {
    give("seeds", 2);
    expect(await plantBed(db, "ann", 0, "seeds")).toBeNull();
    vi.setSystemTime(T0 + 1000);
    expect(await plantBed(db, "ann", 1, "seeds")).toBeNull();
    can("bo");
    expect(await waterBed(db, "bo", "ann", 1)).toBeNull();
  });

  it("waits for a bed to be ready", async () => {
    vi.setSystemTime(T0 + GROW_MS - 1);
    expect(await pickGarden(db, "ann")).toMatch(/Nothing is ready/);
  });

  it("picks every ready bed for herbs and a little XP, and leaves them bare", async () => {
    vi.setSystemTime(T0 + GROW_MS * 3);
    const want = bedYield("ann", { bed: 0, plantedAt: T0 }) + bedYield("ann", { bed: 1, plantedAt: T0 + 1000, wateredBy: "Bo" });
    const res = await pickGarden(db, "ann");
    if (typeof res === "string") throw new Error(res);
    expect(res).toMatchObject({ herbs: want, mushrooms: 0, beds: 2 });
    expect(res.xp?.granted).toBe(HARBOR_XP.gardenBed * 2);
    expect(want).toBeGreaterThanOrEqual(GARDEN_YIELD[0] * 2 + 1);
    expect(qty("herbs")).toBe(want);
    expect(bedRow(0)).toBeUndefined();
    expect(bedRow(1)).toBeUndefined();
    expect(await pickGarden(db, "ann")).toMatch(/Nothing is ready/);
  });

  it("picks herbs and mushrooms together, each to its own stock", async () => {
    sql.prepare("UPDATE huts SET tier = 2 WHERE player_id = 'ann'").run();
    give("mushrooms", 1);
    expect(await plantBed(db, "ann", 2, "mushrooms")).toBeNull();
    // The herbs are ready long before the mushrooms: only they are picked.
    vi.setSystemTime(T0 + GROW_MS + 1000);
    const first = await pickGarden(db, "ann");
    if (typeof first === "string") throw new Error(first);
    expect(first).toMatchObject({ mushrooms: 0, beds: 2 });
    expect(bedRow(2)?.crop).toBe("mushrooms");
    // Then the mushrooms, and a herb bed planted alongside them.
    give("seeds", 1);
    expect(await plantBed(db, "ann", 0, "seeds")).toBeNull();
    vi.setSystemTime(T0 + 1000 + CROP_GROW_MS.mushrooms + GROW_MS);
    const herbsBefore = qty("herbs");
    const res = await pickGarden(db, "ann");
    if (typeof res === "string") throw new Error(res);
    const mushrooms = bedYield("ann", { bed: 2, plantedAt: T0 + 1000 });
    expect(res).toMatchObject({ mushrooms, beds: 2 });
    expect(res.herbs).toBeGreaterThanOrEqual(GARDEN_YIELD[0]);
    expect(qty("mushrooms")).toBe(mushrooms);
    expect(qty("herbs")).toBe(herbsBefore + res.herbs);
  });

  it("pays once when picked twice at the same moment", async () => {
    vi.setSystemTime(T0 + GROW_MS * 3);
    const both = await Promise.all([pickGarden(db, "ann"), pickGarden(db, "ann")]);
    const paid = both.filter((r) => typeof r !== "string");
    expect(paid).toHaveLength(1);
    expect(qty("herbs")).toBe((paid[0] as { herbs: number }).herbs);
  });

  it("pays once for herbs and mushrooms when picked twice at the same moment", async () => {
    sql.prepare("UPDATE huts SET tier = 2 WHERE player_id = 'ann'").run();
    give("mushrooms", 1);
    expect(await plantBed(db, "ann", 2, "mushrooms")).toBeNull();
    vi.setSystemTime(T0 + CROP_GROW_MS.mushrooms * 2);
    const both = await Promise.all([pickGarden(db, "ann"), pickGarden(db, "ann")]);
    const paid = both.filter((r) => typeof r !== "string") as { herbs: number; mushrooms: number }[];
    expect(paid).toHaveLength(1);
    expect(paid[0].mushrooms).toBeGreaterThan(0);
    expect(qty("herbs")).toBe(paid[0].herbs);
    expect(qty("mushrooms")).toBe(paid[0].mushrooms);
  });
});

describe("the shed and the stall", () => {
  it("grinds bones into bonemeal", async () => {
    expect(await grindBone(db, "ann", 1)).toMatch(/no bones/);
    give("bone", 3);
    expect(await grindBone(db, "ann", 2)).toEqual({ bonemeal: 2 * BONEMEAL_PER_BONE });
    expect(qty("bone")).toBe(1);
    expect(qty("bonemeal")).toBe(2 * BONEMEAL_PER_BONE);
  });

  it("sells a watering can, once, and it is filled at the well", async () => {
    expect(await fillCan(db, "ann")).toMatch(/no watering can/);
    expect(await buyCan(db, "ann")).toBeNull();
    expect(gold()).toBe(100 - CAN_PRICE);
    expect(await canOf(db, "ann")).toBe(0);
    expect(await buyCan(db, "ann")).toMatch(/already/);
    expect(gold()).toBe(100 - CAN_PRICE);
    expect(await fillCan(db, "ann")).toEqual({ water: CAN_CAPACITY });
    expect(await fillCan(db, "ann")).toMatch(/full/);
  });

  it("sells herb seeds for gold", async () => {
    expect(await buySeeds(db, "ann", 5)).toEqual({ seeds: 5, gold: 5 * SEED_PRICE });
    expect(gold()).toBe(100 - 5 * SEED_PRICE);
    expect(qty("seeds")).toBe(5);
    expect(await buySeeds(db, "ann", 21)).toMatch(/between/);
    sql.prepare("UPDATE characters SET gold = 1 WHERE player_id = 'ann'").run();
    expect(await buySeeds(db, "ann", 1)).toMatch(/gold/);
    expect(qty("seeds")).toBe(5);
  });
});

describe("the Harbor's board", () => {
  it("shows what grows in each garden whose shack stands, and a garden goes with its plot", async () => {
    give("seeds", 1);
    expect(await plantBed(db, "ann", 1, "seeds")).toBeNull();
    const board = await harborBoard(db, CREW);
    expect(board.members.find((m) => m.id === "ann")?.garden).toEqual([{ bed: 1, crop: "herbs", plantedAt: T0, readyAt: T0 + GROW_MS }]);
    expect(board.members.find((m) => m.id === "bo")?.garden).toBeUndefined();
    await leaveCrew(db, "ann");
    expect(bedRow(1)).toBeUndefined();
  });
});
