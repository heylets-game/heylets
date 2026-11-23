// Home finishes against a real SQLite database with the game's migrations applied (the stand-in for D1 in d1.ts,
// where a batch is one transaction): buying from Nell once, and dressing a hut in what you own.

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishById, finishDay, finishStock, finishesOf } from "@gantt-quest/world";
import { buyFinish, finishesView, hutFinish, ownedFinishes, setFinish } from "../src/server/finishes";
import { getHut, harborBoard } from "../src/server/db";
import { addHero, openDb } from "./d1";

const CREW = "CREWAA";
let sql: DatabaseSync;
let db: D1Database;

const gold = (id = "ann") => (sql.prepare("SELECT gold FROM characters WHERE player_id = ?").get(id) as { gold: number }).gold;
const setGold = (n: number, id = "ann") => sql.prepare("UPDATE characters SET gold = ? WHERE player_id = ?").run(n, id);
const shack = (id: string, plot: number) => sql.prepare("INSERT INTO huts (player_id, tier, plot, bin_json) VALUES (?, 1, ?, NULL)").run(id, plot);
const price = (id: string) => finishById(id)!.price;
const T0 = Date.UTC(2026, 10, 23, 12);
/** A wallpaper and a floor Nell has out on the test's day, and a wallpaper she has not. */
const STOCK = finishStock(finishDay(T0));
const WALL = STOCK.find((id) => id.startsWith("wall_"))!;
const FLOOR = STOCK.find((id) => id.startsWith("floor_"))!;
const OFF_TODAY = finishesOf("wall").map((f) => f.id).find((id) => !STOCK.includes(id))!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  ({ sql, db } = openDb());
  for (const [id, name] of [["ann", "Ann"], ["bo", "Bo"]] as const) addHero(sql, { id, name, crew: CREW });
  setGold(500);
  shack("ann", 0);
});
afterEach(() => vi.useRealTimers());

describe("buying from Nell", () => {
  it("takes the price once and keeps the finish for good", async () => {
    expect(await buyFinish(db, "ann", "roof_plum")).toEqual({ gold: 500 - price("roof_plum") });
    expect(gold()).toBe(500 - price("roof_plum"));
    expect(await ownedFinishes(db, "ann")).toEqual(["roof_plum"]);
    expect(await buyFinish(db, "ann", "roof_plum")).toMatch(/already/);
    expect(gold()).toBe(500 - price("roof_plum"));
  });

  it("charges once when asked twice at the same moment", async () => {
    const both = await Promise.all([buyFinish(db, "ann", WALL), buyFinish(db, "ann", WALL)]);
    expect(both.filter((r) => typeof r !== "string")).toHaveLength(1);
    expect(gold()).toBe(500 - price(WALL));
  });

  it("sells only what she has out today, and says what that is", async () => {
    expect(await buyFinish(db, "ann", OFF_TODAY)).toMatch(/out today/);
    const view = await finishesView(db, "ann");
    expect(view.stock).toEqual(STOCK);
    expect(view.restock).toBe(Date.UTC(2026, 10, 24));
    // Tomorrow it may be out; owning it, it can always be put up.
    vi.setSystemTime(T0 + 86_400_000);
    const tomorrow = finishStock(finishDay(Date.now()));
    expect(tomorrow).not.toEqual(STOCK);
  });

  it("refuses what it does not sell, or what you cannot pay for", async () => {
    expect(await buyFinish(db, "ann", "roof_gold")).toMatch(/doesn't sell/);
    setGold(10);
    expect(await buyFinish(db, "ann", "roof_tar")).toMatch(/gold/);
    expect(gold()).toBe(10);
    expect(await ownedFinishes(db, "ann")).toEqual([]);
  });
});

describe("dressing a hut", () => {
  it("puts on a finish you own, shows it in the hut, and takes it off again", async () => {
    expect(await setFinish(db, "ann", "wall", WALL)).toMatch(/Buy it/);
    await buyFinish(db, "ann", WALL);
    await buyFinish(db, "ann", FLOOR);
    expect(await setFinish(db, "ann", "wall", WALL)).toEqual({ wall: WALL, floor: null, roof: null });
    expect(await setFinish(db, "ann", "floor", FLOOR)).toEqual({ wall: WALL, floor: FLOOR, roof: null });
    expect(await setFinish(db, "ann", "floor", WALL)).toMatch(/not for the floor/);
    expect((await getHut(db, "ann")).finish).toEqual({ wall: WALL, floor: FLOOR, roof: null });
    expect(await setFinish(db, "ann", "wall", null)).toEqual({ wall: null, floor: FLOOR, roof: null });
  });

  it("needs a hut standing", async () => {
    setGold(500, "bo");
    await buyFinish(db, "bo", "roof_brick");
    expect(await setFinish(db, "bo", "roof", "roof_brick")).toMatch(/no hut/);
    expect((await finishesView(db, "bo")).hut).toBe(false);
    expect((await finishesView(db, "ann")).hut).toBe(true);
  });

  it("shows a chosen roof to the whole crew, and none until one is chosen", async () => {
    expect((await harborBoard(db, CREW)).members.find((m) => m.id === "ann")?.roof).toBeUndefined();
    await buyFinish(db, "ann", "roof_brick");
    await setFinish(db, "ann", "roof", "roof_brick");
    expect((await harborBoard(db, CREW)).members.find((m) => m.id === "ann")?.roof).toBe("roof_brick");
  });

  it("forgets a finish no longer in the catalogue", async () => {
    sql.prepare("UPDATE huts SET wall = 'wall_gone', roof = 'wall_shell' WHERE player_id = 'ann'").run();
    expect(await hutFinish(db, "ann")).toEqual({ wall: null, floor: null, roof: null });
    expect((await harborBoard(db, CREW)).members.find((m) => m.id === "ann")?.roof).toBeUndefined();
  });
});
