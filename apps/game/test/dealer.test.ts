// Hollis Crane, the dealer in materials, against a real SQLite database with the game's migrations applied (d1.ts):
// selling to him and buying from him within his daily limits, and his supply contracts from taking to settling.

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACTS_PER_DAY, CONTRACT_EARLY_MS, DEALER_BUY_DAILY, DEALER_SELL_DAILY, contractOffers, dealerBoard, gatherDay, lapsedPayout } from "@gantt-quest/world";
import { buyFromDealer, dealerView, deliverContract, dropContract, sellToDealer, takeContract } from "../src/server/dealer";
import { addHero, openDb, type Row } from "./d1";

let sql: DatabaseSync;
let db: D1Database;
const T0 = Date.UTC(2026, 10, 23, 9);
const HOUR = 60 * 60_000;
const one = <T = Row>(text: string, ...args: (string | number)[]) => sql.prepare(text).get(...args) as T;
const gold = () => one<{ gold: number }>("SELECT gold FROM characters WHERE player_id = 'ann'").gold;
const has = (kind: string) => one<{ qty: number } | undefined>("SELECT qty FROM resources WHERE player_id = 'ann' AND kind = ?", kind)?.qty ?? 0;
const give = (kind: string, qty: number) => sql.prepare("INSERT INTO resources (player_id, kind, qty) VALUES ('ann', ?, ?) ON CONFLICT(player_id, kind) DO UPDATE SET qty = ?").run(kind, qty, qty);
const ok = <T>(r: T | string): T => {
  if (typeof r === "string") throw new Error(r);
  return r;
};
const board = () => dealerBoard("CREWAA", Date.now());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  ({ sql, db } = openDb());
  addHero(sql, { id: "ann", name: "Ann", crew: "CREWAA", gold: 1000, at: T0 - 86_400_000 });
});
afterEach(() => vi.useRealTimers());

describe("trading with Hollis", () => {
  it("buys what you bring at his board's price, up to his daily limit", async () => {
    give("wood", 60);
    const price = board().buys.wood;
    expect(ok(await sellToDealer(db, "ann", "wood", 10))).toEqual({ gold: 10 * price, price });
    expect(has("wood")).toBe(50);
    expect(gold()).toBe(1000 + 10 * price);
    expect(await sellToDealer(db, "ann", "wood", DEALER_BUY_DAILY)).toMatch(/at most/);
    ok(await sellToDealer(db, "ann", "wood", DEALER_BUY_DAILY - 10));
    expect(has("wood")).toBe(60 - DEALER_BUY_DAILY);
    // A new day, a new limit.
    vi.setSystemTime(T0 + 24 * HOUR);
    expect(typeof (await sellToDealer(db, "ann", "wood", 5))).toBe("object");
  });

  it("will not take what you do not have, or what he does not deal in, and never twice over", async () => {
    give("iron", 5);
    expect(await sellToDealer(db, "ann", "iron", 6)).toMatch(/do not have/);
    expect(await sellToDealer(db, "ann", "gem", 1)).toMatch(/does not deal/);
    expect(await sellToDealer(db, "ann", "iron", 0)).toMatch(/1 to/);
    // Two sales of all five at once: only one goes through.
    const both = await Promise.all([sellToDealer(db, "ann", "iron", 5), sellToDealer(db, "ann", "iron", 5)]);
    expect(both.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(has("iron")).toBe(0);
    expect(gold()).toBe(1000 + 5 * board().buys.iron);
  });

  it("sells you what you are short of, for gold, up to his daily limit", async () => {
    const price = board().sells.stone;
    expect(ok(await buyFromDealer(db, "ann", "stone", 10))).toEqual({ gold: 10 * price, price });
    expect(has("stone")).toBe(10);
    expect(gold()).toBe(1000 - 10 * price);
    expect(await buyFromDealer(db, "ann", "stone", DEALER_SELL_DAILY)).toMatch(/at most/);
    sql.prepare("UPDATE characters SET gold = 1 WHERE player_id = 'ann'").run();
    expect(await buyFromDealer(db, "ann", "copper", 1)).toMatch(/gold/);
    expect(has("copper")).toBe(0);
  });

  it("shows his board, what you have traded today, and what you carry", async () => {
    give("fur", 4);
    ok(await sellToDealer(db, "ann", "fur", 2));
    const v = await dealerView(db, "ann");
    expect(v.board).toEqual(board());
    expect(v.traded.fur).toEqual({ bought: 2, sold: 0 });
    expect(v.have.fur).toBe(2);
    expect(v.offers).toHaveLength(3);
    expect(v.contract).toBeNull();
  });
});

describe("supply contracts", () => {
  const offers = () => contractOffers("ann", gatherDay(Date.now()));
  const stock = (wants: Record<string, number | undefined>) => {
    for (const [k, n] of Object.entries(wants)) give(k, n ?? 0);
  };

  it("are taken one at a time, each once, and only a few a day", async () => {
    const [a, b] = offers();
    ok(await takeContract(db, "ann", a.id));
    expect(await takeContract(db, "ann", b.id)).toMatch(/Finish or drop/);
    ok(await dropContract(db, "ann"));
    expect(await takeContract(db, "ann", a.id)).toMatch(/already/);
    ok(await takeContract(db, "ann", b.id));
    ok(await dropContract(db, "ann"));
    expect(CONTRACTS_PER_DAY).toBe(2);
    expect(await takeContract(db, "ann", offers()[2].id)).toMatch(/2 contracts today/);
    expect(await takeContract(db, "ann", "nonsense")).toMatch(/not on his slate/);
  });

  it("are handed in as you gather, and pay gold and XP when filled, with more XP filled early", async () => {
    const offer = offers()[0];
    ok(await takeContract(db, "ann", offer.id));
    const [kind] = Object.keys(offer.wants);
    const want = offer.wants[kind as keyof typeof offer.wants]!;
    give(kind, 2);
    const part = ok(await deliverContract(db, "ann"));
    expect(part.gave).toEqual({ [kind]: 2 });
    expect(part.paid).toBeUndefined();
    expect(has(kind)).toBe(0);
    expect(await deliverContract(db, "ann")).toMatch(/nothing he is still owed/);
    stock(offer.wants);
    const xpBefore = one<{ xp: number; level: number }>("SELECT xp, level FROM characters WHERE player_id = 'ann'");
    const done = ok(await deliverContract(db, "ann"));
    expect(done.contract).toBeNull();
    expect(done.paid).toBe(offer.gold);
    expect(done.early).toBe(true);
    expect(done.xp?.granted).toBeGreaterThan(8);
    expect(gold()).toBe(1000 + offer.gold);
    // What was owed left the pack (and only that: 2 delivered first, then the rest).
    expect(has(kind)).toBe(2);
    const xpAfter = one<{ xp: number; level: number }>("SELECT xp, level FROM characters WHERE player_id = 'ann'");
    expect(xpAfter.level * 1000 + xpAfter.xp).toBeGreaterThan(xpBefore.level * 1000 + xpBefore.xp);
    expect(want).toBeGreaterThan(2);
    expect((await dealerView(db, "ann")).contract).toBeNull();
  });

  it("pays no early XP after the first day", async () => {
    const offer = offers()[1];
    ok(await takeContract(db, "ann", offer.id));
    vi.setSystemTime(T0 + CONTRACT_EARLY_MS + HOUR);
    stock(offer.wants);
    const done = ok(await deliverContract(db, "ann"));
    expect(done.early).toBe(false);
    expect(done.paid).toBe(offer.gold);
  });

  it("lapse when their time runs out, paying for what was brought at his buying price", async () => {
    const offer = offers()[0];
    ok(await takeContract(db, "ann", offer.id));
    const [kind] = Object.keys(offer.wants);
    give(kind, 3);
    ok(await deliverContract(db, "ann"));
    vi.setSystemTime(T0 + offer.days * 24 * HOUR + 1);
    const v = await dealerView(db, "ann");
    const paid = lapsedPayout({ delivered: { [kind]: 3 } });
    expect(v.settled).toEqual({ outcome: "lapsed", paid });
    expect(v.contract).toBeNull();
    expect(gold()).toBe(1000 + paid);
    // Settled once.
    expect((await dealerView(db, "ann")).settled).toBeUndefined();
    expect(gold()).toBe(1000 + paid);
  });

  it("can be dropped, paying for what was brought", async () => {
    const offer = offers()[2];
    ok(await takeContract(db, "ann", offer.id));
    const [kind] = Object.keys(offer.wants);
    give(kind, 1);
    ok(await deliverContract(db, "ann"));
    expect(ok(await dropContract(db, "ann")).paid).toBe(lapsedPayout({ delivered: { [kind]: 1 } }));
    expect(await dropContract(db, "ann")).toMatch(/no contract/);
  });
});
