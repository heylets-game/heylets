// Bait from the fishmonger, against a real SQLite database with the game's migrations applied (d1.ts): buying it
// for gold up to what a hero can carry, a worm or a shrimp eaten on every cast, and a lure lost only with the line.

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BAIT_SALE, HARBOR_FISH_SPOTS, type GatherChoice } from "@gantt-quest/world";
import type { HexPos } from "@gantt-quest/core";
import { baitOf, buyBait } from "../src/server/bait";
import { startOuting, stepOuting, type Standing } from "../src/server/gather";
import { addHero, openDb } from "./d1";

let sql: DatabaseSync;
let db: D1Database;
let clock: number;
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const at = (ms: number) => vi.setSystemTime((clock = ms));
const gold = () => (sql.prepare("SELECT gold FROM characters WHERE player_id = 'ann'").get() as { gold: number }).gold;

const here: HexPos = HARBOR_FISH_SPOTS.west;
const where = (): Standing => ({ crewId: "CREWAA", pos: here });

async function step(choice: GatherChoice) {
  const r = await stepOuting(db, "ann", choice, where());
  if (typeof r === "string") throw new Error(r);
  return r;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(T0);
  ({ sql, db } = openDb());
  addHero(sql, { id: "ann", name: "Ann", str: 9, dex: 9, crew: "CREWAA", at: T0, gold: 100 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buying bait", () => {
  it("takes the gold and gives a lot, and refuses past what a hero carries or can pay for", async () => {
    expect(await baitOf(db, "ann")).toEqual({});
    const r = await buyBait(db, "ann", "worms");
    expect(r).toEqual({ bait: { worms: BAIT_SALE.worms.per }, gold: 100 - BAIT_SALE.worms.price });
    expect(gold()).toBe(100 - BAIT_SALE.worms.price);

    for (let i = 0; i < 2; i++) expect(typeof (await buyBait(db, "ann", "glow_lure"))).toBe("object");
    sql.prepare("UPDATE characters SET gold = 500 WHERE player_id = 'ann'").run();
    expect(typeof (await buyBait(db, "ann", "glow_lure"))).toBe("object");
    expect(await buyBait(db, "ann", "glow_lure")).toMatch(/only 3/);
    expect((await baitOf(db, "ann")).glow_lure).toBe(3);

    sql.prepare("UPDATE characters SET gold = 2 WHERE player_id = 'ann'").run();
    expect(await buyBait(db, "ann", "shrimp")).toMatch(/15 gold/);
    expect(await buyBait(db, "ann", "caviar")).toMatch(/doesn't sell/);
    expect(gold()).toBe(2);
  });
});

describe("bait on the hook", () => {
  it("eats a worm on every cast, and will not cast with bait the hero has none of", async () => {
    await buyBait(db, "ann", "worms");
    expect(typeof (await startOuting(db, "ann", "fishing", "west", where()))).toBe("object");
    const r = await step({ t: "cast", power: 0.6, bait: "worms" });
    expect(r.bait.worms).toBe(BAIT_SALE.worms.per - 1);
    await step({ t: "reel" });
    at(clock + 1000);
    await step({ t: "cast", power: 0.6, bait: "worms" });
    expect((await baitOf(db, "ann")).worms).toBe(BAIT_SALE.worms.per - 2);
    await step({ t: "reel" });

    await expect(step({ t: "cast", power: 0.6, bait: "shrimp" })).rejects.toThrow(/no shrimp left/);
    await expect(step({ t: "cast", power: 0.6, bait: "caviar" as never })).rejects.toThrow(/not bait/);
    // A bare hook is always fine, and takes nothing.
    await step({ t: "cast", power: 0.6, bait: null });
    expect((await baitOf(db, "ann")).worms).toBe(BAIT_SALE.worms.per - 2);
  });

  it("keeps a lure from cast to cast, and loses it only when the line goes with a fish", async () => {
    await buyBait(db, "ann", "glow_lure");
    await startOuting(db, "ann", "fishing", "west", where());
    // Wound in with nothing on: the lure comes back.
    await step({ t: "cast", power: 0.6, bait: "glow_lure" });
    await step({ t: "reel" });
    expect((await baitOf(db, "ann")).glow_lure).toBe(1);
    // Hooked, then the line cut: the fish has it.
    at(clock + 1000);
    const cast = (await step({ t: "cast", power: 0.6, bait: "glow_lure" })).outing!.sitting!.cast!;
    at(clock + cast.biteMs + 40);
    expect((await step({ t: "hook", at: cast.biteMs + 20 })).outing!.sitting!.cast!.hooked).toBe(true);
    const after = await step({ t: "reel" });
    expect(after.outing!.sitting!.last?.outcome).toBe("snapped");
    expect(after.bait.glow_lure).toBeUndefined();
  });
});
