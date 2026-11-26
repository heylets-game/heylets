import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { stepZone, zoneUntimed } from "./zone";
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

  it("moves on a whole round from an enemy's turn, back round to that enemy's", () => {
    let state = dev(dev(board(), { op: "sandbox", on: true }), { op: "start_fight" });
    while (sideOfTurn(state) !== "enemy") state = dev(state, { op: "next_turn" });
    const foe = state.encounter!.acting[0];
    const round = state.encounter!.round;
    state = dev(state, { op: "next_turn", round: true });
    expect(state.encounter!.round).toBe(round + 1);
    expect(state.encounter!.acting).toEqual([foe]);
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

describe("acting in the combat sandbox", () => {
  const fight = () => {
    const state = board();
    Object.assign(standHero(state, "cat", at(4, 6), { ...kit, controller: "someone_else" }), { hp: 900, maxHp: 900 });
    return dev(dev(state, { op: "sandbox", on: true }), { op: "start_fight" });
  };

  it("lets the dev act as anyone in the fight, on anyone's turn, for nothing", () => {
    let state = fight();
    // Whoever's turn it is, cat (someone else's hero) can walk, and ann can strike, again and again.
    state = must(state, { type: "move", by: "ann", unit: "cat", to: at(3, 6) });
    expect(unit(state, "cat").pos).toEqual(at(3, 6));
    const foe = state.units.find((u) => u.side === "enemy" && u.kind === "wolf")!.id;
    Object.assign(unit(state, foe), { hp: 900, maxHp: 900 });
    for (let i = 0; i < 4; i++) {
      const events: ZoneEvent[] = [];
      state = must(state, { type: "use", by: "ann", unit: "ann", ability: "bash", target: foe }, events);
      expect(events.some((e) => e.t === "used" && e.id === "ann")).toBe(true);
      expect(state.encounter!.budgets.ann.ap).toBe(6);
      expect(unit(state, "ann").cooldowns).toEqual({});
    }
  });

  it("lets the dev walk an enemy", () => {
    let state = fight();
    const foe = state.units.find((u) => u.side === "enemy" && u.kind === "bandit")!.id;
    state = must(state, { type: "move", by: "ann", unit: foe, to: at(9, 9) });
    expect(unit(state, foe).pos).toEqual(at(9, 9));
  });

  it("puts anyone straight on a hex with room", () => {
    const state = fight();
    const events: ZoneEvent[] = [];
    const after = dev(state, { op: "place", unit: "ann", at: at(10, 3) }, events);
    expect(unit(after, "ann").pos).toEqual(at(10, 3));
    expect(events).toContainEqual(expect.objectContaining({ t: "blinked", id: "ann" }));
  });

  it("outside the sandbox, still only lets a player act as their own", () => {
    let state = board();
    Object.assign(standHero(state, "cat", at(4, 6), { ...kit, controller: "someone_else" }), { hp: 900, maxHp: 900 });
    state = dev(state, { op: "start_fight" });
    expect(stepZone(state, { type: "move", by: "ann", unit: "cat", to: at(3, 6) }).ok).toBe(false);
  });
});

describe("an enemy's ability, aimed by hand in the combat sandbox", () => {
  const fight = (extra?: (s: ZoneState) => void) => {
    const state = board();
    extra?.(state);
    return dev(dev(state, { op: "sandbox", on: true }), { op: "start_fight" });
  };
  const strike = (state: ZoneState, op: Omit<Extract<Parameters<typeof dev>[1], { op: "strike" }>, "op">) => {
    const events: ZoneEvent[] = [];
    const step = stepZone(state, { type: "dev", by: "ann", dev: { op: "strike", ...op } });
    if (step.ok) events.push(...step.events);
    return { step, events };
  };

  it("is used on the hero picked, again and again, for nothing", () => {
    let state = fight();
    const bandit = state.units.find((u) => u.kind === "bandit")!.id;
    state = dev(state, { op: "place", unit: bandit, at: at(4, 6) });
    for (let i = 0; i < 3; i++) {
      const { step, events } = strike(state, { unit: bandit, ability: "cheap_shot", target: "ann" });
      expect(step.ok).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({ t: "used", id: bandit, name: expect.any(String), target: "ann" }));
      state = (step as { state: ZoneState }).state;
    }
  });

  it("is refused out of reach, unless it may go anywhere", () => {
    let state = fight();
    const bandit = state.units.find((u) => u.kind === "bandit")!.id;
    state = dev(state, { op: "place", unit: bandit, at: at(12, 7) });
    expect(strike(state, { unit: bandit, ability: "slash", target: "ann" }).step.ok).toBe(false);
    expect(strike(state, { unit: bandit, ability: "slash", target: "ann", anywhere: true }).step.ok).toBe(true);
  });

  it("aims one that lands on a clump at any hex it reaches, with nobody on it", () => {
    const state = fight((s) => enemy(s, "cultist", at(9, 6)));
    const cultist = state.units.find((u) => u.kind === "cultist")!.id;
    const { step, events } = strike(state, { unit: cultist, ability: "immolate", at: at(7, 3) });
    expect(step.ok).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ t: "used", id: cultist, at: at(7, 3) }));
  });

  it("is only for an enemy in a fight in the sandbox", () => {
    const state = dev(board(), { op: "start_fight" });
    const bandit = state.units.find((u) => u.kind === "bandit")!.id;
    expect(strike(state, { unit: bandit, ability: "slash", target: "ann" }).step.ok).toBe(false);
  });
});

describe("setting the turn in the combat sandbox", () => {
  it("makes it the turn of whoever is picked, at once, with nobody between playing", () => {
    let state = dev(dev(board(), { op: "sandbox", on: true }), { op: "start_fight" });
    const order = state.encounter!.order;
    const last = order[order.length - 1];
    const round = state.encounter!.round;
    const events: ZoneEvent[] = [];
    state = dev(state, { op: "set_turn", unit: last }, events);
    expect(state.encounter!.acting).toEqual([last]);
    expect(state.encounter!.round).toBe(round);
    expect(events.filter((e) => e.t === "used" || e.t === "hit")).toEqual([]);
    // And back to the first: the round does not turn over.
    state = dev(state, { op: "set_turn", unit: order[0] });
    expect(state.encounter!.acting).toEqual([order[0]]);
    expect(state.encounter!.round).toBe(round);
  });

  it("is only for the sandbox", () => {
    const state = dev(board(), { op: "start_fight" });
    expect(stepZone(state, { type: "dev", by: "ann", dev: { op: "set_turn", unit: state.encounter!.order[0] } }).ok).toBe(false);
  });
});

describe("why a walk cannot be made", () => {
  it("says a big one has no room, not that it lacks the AP", () => {
    let state = board();
    const guardian = enemy(state, "guardian", at(9, 6)).id;
    // A wall of wolves round a hex: one fits there, the Guardian's three do not.
    for (const p of [at(12, 3), at(13, 3), at(12, 4)].slice(1)) enemy(state, "wolf", p, "g2");
    state = dev(dev(state, { op: "sandbox", on: true }), { op: "start_fight" });
    const step = stepZone(state, { type: "move", by: "ann", unit: guardian, to: at(12, 3) });
    expect(step.ok).toBe(false);
    expect(!step.ok && step.error).toMatch(/no room/);
  });

  it("says a big one has no way through wide enough, when the end has room but the way does not", () => {
    let state = board();
    const guardian = enemy(state, "guardian", at(2, 2)).id;
    // A gap one hex wide in a line of rock across the board: a wolf could go through, the Guardian cannot.
    state.map.tiles = state.map.tiles.map((t) => (t.r === 5 && t.q !== 8 ? { ...t, built: true } : t));
    state = dev(dev(state, { op: "sandbox", on: true }), { op: "start_fight" });
    const step = stepZone(state, { type: "move", by: "ann", unit: guardian, to: at(2, 9) });
    expect(step.ok).toBe(false);
    expect(!step.ok && step.error).toMatch(/no way through wide enough/);
  });
});
