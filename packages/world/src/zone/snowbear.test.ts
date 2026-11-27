import { describe, expect, it } from "vitest";
import { at, has, must, standEnemy as enemy, standHero, flatBoard, unit } from "../test/zoneBoard";
import type { HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { enemyAct, fieldsCatch } from "./combat";
import { BEHAVIOURS } from "./behaviours";
import { ENEMIES } from "../content";
import { enemyStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Snow Bear: the Cave Bear's Rending Swipe, and a Blizzard Aura that bites whoever starts a turn beside it or steps up
// to it.

const strike = (name: string) => enemyStrikes("snow_bear", 1).find((s) => s.name === name)!;
const blizzard = strike("Blizzard Aura");

/** A Snow Bear at `bearAt` and a hardy hero at each of `heroes` (ann, bo, ...), in a fight with the AI off. */
function setUp(bearAt: HexPos, heroes: HexPos[]) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: heroes.length }, flags: { shareTurns: true } });
  state.aiOff = true;
  const ids = ["ann", "bo", "cy"].slice(0, heroes.length);
  ids.forEach((id, i) => Object.assign(standHero(state, id, heroes[i], { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 }));
  const bear = enemy(state, "snow_bear", bearAt).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, bear, ids };
}

const ctxOf = (state: ZoneState, seed: number): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });

const raise = (state: ZoneState, bear: string) => unit(state, bear).conditions.push({ kind: "blizzard_aura", rounds: 3, amount: 1 });

function annsTurn(state: ZoneState): ZoneState {
  for (let n = 0; n < 6 && !(state.encounter!.acting.includes("ann") && !state.encounter!.done.includes("ann")); n++) state = must(state, { type: "timeout" });
  return state;
}

describe("a Snow Bear's kit", () => {
  it("is the Cave Bear's Rending Swipe, a Blizzard Aura and a Shove", () => {
    expect(ENEMIES.snow_bear.abilities).toEqual(["mauling_swipe", "blizzard_aura", "shove"]);
  });
});

describe("a Snow Bear's Blizzard Aura", () => {
  it("lasts 3 of its turns, a hex deep, waits 4 turns, and leaves Reeling 1 for a turn on a failed save", () => {
    expect(blizzard).toMatchObject({ cooldown: 4, harmless: false, behaviour: "field", saveOr: { effect: "reeling", turns: 1, amount: 1 } });
    expect(blizzard.kit.field).toEqual({ rounds: 3, radius: 1, kind: "blizzard_aura" });
  });

  it("goes up round it and harms nobody yet", () => {
    const { state, bear } = setUp(at(8, 6), [at(7, 6)]);
    const ctx = ctxOf(state, 1);
    enemyAct(ctx, unit(ctx.state, bear), blizzard, null);
    expect(unit(ctx.state, bear).conditions.find((c) => c.kind === "blizzard_aura")).toMatchObject({ rounds: 3, amount: 1 });
    expect(unit(ctx.state, "ann").hp).toBe(900);
  });

  it("bites a hero whose turn starts beside it, and not one two hexes off", () => {
    let { state, bear } = setUp(at(8, 6), [at(9, 6), at(10, 6)]);
    raise(state, bear);
    const hpAtTurn = new Map<string, number>();
    const began = state.encounter!.turnNo;
    for (let n = 0; n < 8 && hpAtTurn.size < 2; n++) {
      state = must(state, { type: "timeout" });
      const enc = state.encounter!;
      if (enc.turnNo === began) continue;
      for (const id of ["ann", "bo"]) if (enc.acting.includes(id) && !enc.done.includes(id) && !hpAtTurn.has(id)) hpAtTurn.set(id, unit(state, id).hp);
    }
    expect(hpAtTurn.get("ann")).toBeLessThan(900);
    expect(hpAtTurn.get("bo")).toBe(900);
  });

  it("bites a hero who walks up to it, once in the turn however often they step back in", () => {
    let { state, bear } = setUp(at(8, 6), [at(11, 6)]);
    raise(state, bear);
    state = annsTurn(state);
    // Stunned, it takes no swing at her as she steps away: only its blizzard can hurt her.
    unit(state, bear).conditions.push({ kind: "stunned", rounds: 3 });
    expect(unit(state, "ann").hp).toBe(900);
    state = must(state, { type: "move", by: "ann", unit: "ann", to: at(9, 6) });
    const bitten = unit(state, "ann").hp;
    expect(bitten).toBeLessThan(900);
    state = must(state, { type: "move", by: "ann", unit: "ann", to: at(10, 6) });
    state = must(state, { type: "move", by: "ann", unit: "ann", to: at(9, 6) });
    expect(unit(state, "ann").hp).toBe(bitten);
  });

  it("leaves Reeling 1 on a failed save and nothing on a good one; at a turn's start it counts for that turn", () => {
    const { state, bear } = setUp(at(8, 6), [at(9, 6)]);
    raise(state, bear);
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = ctxOf(state, seed);
      const ann = unit(ctx.state, "ann");
      fieldsCatch(ctx, ann, true);
      expect(ann.hp).toBeLessThan(900);
      const reel = ann.conditions.find((c) => c.kind === "reeling");
      seen.add(!!reel);
      if (reel) {
        expect(reel).toMatchObject({ rounds: 1, amount: 1 });
        expect(reel.fresh).toBeFalsy();
      }
      // Caught once this turn: not again.
      const hp = ann.hp;
      fieldsCatch(ctx, ann);
      expect(ann.hp).toBe(hp);
    }
    expect(seen).toEqual(new Set([true, false]));
  });

  it("is worth raising with a hero beside it, and nothing with none", () => {
    const near = setUp(at(8, 6), [at(9, 6)]);
    const far = setUp(at(8, 6), [at(12, 6)]);
    const look = (s: ZoneState, b: string) => ({ state: s, enemy: unit(s, b) });
    const heroes = (s: ZoneState) => s.units.filter((u) => u.side === "hero");
    expect(BEHAVIOURS.field.value(look(near.state, near.bear) as never, at(8, 6), blizzard, heroes(near.state))?.worth).toBeGreaterThan(0);
    expect(BEHAVIOURS.field.value(look(far.state, far.bear) as never, at(8, 6), blizzard, heroes(far.state))).toBeNull();
  });

  it("does not Slow", () => {
    let { state, bear } = setUp(at(8, 6), [at(11, 6)]);
    raise(state, bear);
    state = annsTurn(state);
    state = must(state, { type: "move", by: "ann", unit: "ann", to: at(9, 6) });
    expect(has(state, "ann", "slowed")).toBe(false);
  });
});
