import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { zoneUntimed } from "./zone";
import type { ZoneEvent, ZoneState } from "./types";

// The combat sandbox (the Maps tab): a fight that goes by the dev's hand.

const kit = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function board(): ZoneState {
  const state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 } });
  Object.assign(standHero(state, "ann", at(5, 6), kit), { hp: 900, maxHp: 900 });
  enemy(state, "wolf", at(6, 6));
  enemy(state, "bandit", at(6, 7));
  return state;
}
const dev = (state: ZoneState, op: Parameters<typeof must>[1] extends infer A ? (A extends { type: "dev"; dev: infer D } ? D : never) : never, events: ZoneEvent[] = []) => must(state, { type: "dev", by: "ann", dev: op }, events);
const sideOfTurn = (state: ZoneState) => unit(state, state.encounter!.acting[0]).side;

describe("the combat sandbox", () => {
  it("is switched on and off, and untimes turns", () => {
    const on = dev(board(), { op: "sandbox", on: true });
    expect(on.sandbox).toBe(true);
    expect(zoneUntimed(on)).toBe(true);
    expect(dev(on, { op: "sandbox", on: false }).sandbox).toBeUndefined();
  });

  it("stops on every turn, enemies' too, and plays none of them", () => {
    let state = dev(board(), { op: "sandbox", on: true });
    const events: ZoneEvent[] = [];
    state = dev(state, { op: "start_fight" }, events);
    const order = state.encounter!.order;
    expect(state.encounter!.acting).toEqual([order[0]]);
    // Through the whole order, one turn at a time: nobody but the dev does anything.
    for (let i = 1; i < order.length; i++) {
      state = dev(state, { op: "next_turn" }, events);
      expect(state.encounter!.acting).toEqual([order[i]]);
    }
    expect(events.filter((e) => e.t === "used" || e.t === "hit")).toEqual([]);
    // And round again to the first.
    state = dev(state, { op: "next_turn" }, events);
    expect(state.encounter!.round).toBe(2);
    expect(state.encounter!.acting).toEqual([order[0]]);
  });

  it("moves on a whole round at once", () => {
    let state = dev(dev(board(), { op: "sandbox", on: true }), { op: "start_fight" });
    const first = state.encounter!.acting;
    state = dev(state, { op: "next_turn", round: true });
    expect(state.encounter!.round).toBe(2);
    expect(state.encounter!.acting).toEqual(first);
  });

  it("switched off on an enemy's turn, has that enemy play it", () => {
    let state = dev(dev(board(), { op: "sandbox", on: true }), { op: "start_fight" });
    while (sideOfTurn(state) !== "enemy") state = dev(state, { op: "next_turn" });
    const foe = state.encounter!.acting[0];
    const events: ZoneEvent[] = [];
    state = dev(state, { op: "sandbox", on: false }, events);
    expect(events.some((e) => e.t === "used" && e.id === foe)).toBe(true);
    // And the fight goes on by itself to a hero's turn.
    expect(sideOfTurn(state)).toBe("hero");
  });
});

describe("placing enemies", () => {
  const place = (at0: { q: number; r: number }) => {
    let state = board();
    state.aiOff = true;
    state = dev(state, { op: "start_fight" });
    const before = new Set(state.units.map((u) => u.id));
    state = dev(state, { op: "spawn", kinds: ["wolf"], at: at0 });
    const placed = state.units.filter((u) => !before.has(u.id));
    expect(placed).toHaveLength(1);
    return state.encounter!.order.includes(placed[0].id);
  };

  it("brings a group put down within earshot of a fight straight into it", () => {
    expect(place(at(8, 6))).toBe(true);
  });

  it("leaves one put down out of earshot out of it", () => {
    expect(place(at(14, 6))).toBe(false);
  });
});
