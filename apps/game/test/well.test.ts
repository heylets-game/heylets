// The town well against a real SQLite database with the game's migrations applied (d1.ts): water skins, coins
// tossed in for luck, and the luck taken onto a map.

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LUCK_MAX, WELL_SKINS, WISHES_PER_DAY, WISH_COST } from "@gantt-quest/world";
import { fillSkin, returnLuck, takeLuck, tossCoin, wellView } from "../src/server/well";
import { addHero, openDb, type Row } from "./d1";

let sql: DatabaseSync;
let db: D1Database;
const T0 = Date.UTC(2026, 10, 22, 9);
const one = <T = Row>(text: string, ...args: (string | number)[]) => sql.prepare(text).get(...args) as T;
const gold = () => one<{ gold: number }>("SELECT gold FROM characters WHERE player_id = 'ann'").gold;
const skins = () => one<{ qty: number } | undefined>("SELECT qty FROM consumables WHERE player_id = 'ann' AND kind = 'water'")?.qty ?? 0;
const ok = <T>(r: T | string): T => {
  if (typeof r === "string") throw new Error(r);
  return r;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  ({ sql, db } = openDb());
  addHero(sql, { id: "ann", name: "Ann", crew: "CREWAA", gold: 100, at: T0 - 86_400_000 });
});
afterEach(() => vi.useRealTimers());

describe("water skins", () => {
  it("fills one at a time, up to a few in the pack", async () => {
    for (let i = 1; i <= WELL_SKINS; i++) expect(ok(await fillSkin(db, "ann"))).toEqual({ skins: i });
    expect(skins()).toBe(WELL_SKINS);
    expect(await fillSkin(db, "ann")).toMatch(/apothecary/);
    expect(skins()).toBe(WELL_SKINS);
  });
});

describe("coins in the well", () => {
  it("costs gold, gives a lucky roll a coin, and takes only a few a day", async () => {
    for (let i = 1; i <= WISHES_PER_DAY; i++) {
      const res = ok(await tossCoin(db, "ann"));
      expect(res.tossed).toBe(i);
      expect(res.luck).toBe(Math.min(LUCK_MAX, i));
    }
    expect(gold()).toBe(100 - WISHES_PER_DAY * WISH_COST);
    expect(await tossCoin(db, "ann")).toMatch(/tomorrow|all the luck/);
    // Tomorrow, the count starts again (the luck is still there until it is spent).
    expect(await takeLuck(db, "ann")).toBe(Math.min(LUCK_MAX, WISHES_PER_DAY));
    vi.setSystemTime(T0 + 86_400_000);
    expect(ok(await tossCoin(db, "ann"))).toMatchObject({ tossed: 1, luck: 1 });
    expect((await wellView(db, "ann")).tossed).toBe(1);
  });

  it("gives the same back for the same toss, and pays out what it says", async () => {
    const before = one<{ qty: number } | undefined>("SELECT qty FROM resources WHERE player_id = 'ann' AND kind = 'gem'")?.qty ?? 0;
    const res = ok(await tossCoin(db, "ann"));
    const gems = one<{ qty: number } | undefined>("SELECT qty FROM resources WHERE player_id = 'ann' AND kind = 'gem'")?.qty ?? 0;
    expect(gems - before).toBe(res.gift === "gem" ? 1 : 0);
    expect(res.gift === "xp" ? res.xp?.granted : 0).toBe(res.gift === "xp" ? 3 : 0);
  });

  it("takes nothing from someone without the gold", async () => {
    sql.prepare("UPDATE characters SET gold = ? WHERE player_id = 'ann'").run(WISH_COST - 1);
    expect(await tossCoin(db, "ann")).toMatch(/gold/);
    expect((await wellView(db, "ann")).luck).toBe(0);
  });

  it("counts one coin when two are tossed at the same moment", async () => {
    const both = await Promise.all([tossCoin(db, "ann"), tossCoin(db, "ann")]);
    expect(both.filter((r) => typeof r !== "string")).toHaveLength(1);
    expect(gold()).toBe(100 - WISH_COST);
  });
});

describe("luck onto a map", () => {
  it("is taken whole when a hero steps onto a map, and given back if the map could not take them", async () => {
    ok(await tossCoin(db, "ann"));
    ok(await tossCoin(db, "ann"));
    expect(await takeLuck(db, "ann")).toBe(2);
    expect(await takeLuck(db, "ann")).toBe(0);
    await returnLuck(db, "ann", 2);
    expect((await wellView(db, "ann")).luck).toBe(2);
  });
});
