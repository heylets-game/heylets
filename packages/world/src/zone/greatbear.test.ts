import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct, sweepHexes } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import type { Ctx } from "./engine";
import type { ZoneEvent } from "./types";

// A Great Bear: a Rending Cleave through the three hexes in front of it, and a Thunderous Roar that leaves everyone
// round it reeling. Both are saved against, for half and nothing left on them.

const strike = (name: string) => enemyStrikes("great_bear", 1).find((s) => s.name === name)!;
const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function use(name: string, seed: number) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 3 }, flags: { shareTurns: true } });
  state.aiOff = true;
  // Ann beside it, Bob beside it too (in the same arc), Cal two off, out of the arc but in reach of a roar.
  for (const [id, pos] of [["ann", at(5, 6)], ["bob", at(5, 5)], ["cal", at(4, 6)]] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const bear = enemy(state, "great_bear", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, bear), strike(name), unit(ctx.state, "ann"));
  return { events, state: ctx.state, bear };
}

/** Each hero the blow was told on: whether they saved, what they took, and whether it left `effect` on them. */
function outcomes(events: ZoneEvent[], state: ReturnType<typeof use>["state"], effect: string) {
  return ["ann", "bob", "cal"].flatMap((id) => {
    const hit = events.find((e): e is Extract<ZoneEvent, { t: "hit" }> => e.t === "hit" && e.target === id);
    if (!hit) return [];
    const save = events.find((e): e is Extract<ZoneEvent, { t: "roll" }> => e.t === "roll" && e.roll.id === id && e.roll.kind === "save")!;
    return [{ id, saved: save.roll.ok, amount: hit.amount, rolled: hit.dice!.total, left: unit(state, id).conditions.some((c) => c.kind === effect) }];
  });
}

describe("a Great Bear", () => {
  it("cleaves, roars and shoves", () => {
    expect(ENEMIES.great_bear.abilities).toEqual(["rending_cleave", "thunderous_roar", "shove"]);
    expect(ENEMY_ABILITIES.rending_cleave).toMatchObject({ name: "Rending Cleave", damage: 10, spread: { shape: "sweep", rows: 1 }, saveOr: { effect: "bleeding" } });
    expect(ENEMY_ABILITIES.thunderous_roar).toMatchObject({ damage: 8, shape: "burst", cooldown: 3, saveOr: { effect: "reeling", amount: 2 } });
  });

  it("cleaves the three hexes in front of it: no roll to hit, full and Bleeding on a failed save, half and no wound on a good one", () => {
    const { state, bear } = use("Rending Cleave", 1);
    expect(sweepHexes(state, unit(state, bear).pos, at(5, 6), 1)).toHaveLength(3);
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 12; seed++) {
      const { events, state } = use("Rending Cleave", seed);
      expect(events.some((e) => e.t === "roll" && e.roll.kind === "attack")).toBe(false);
      const out = outcomes(events, state, "bleeding");
      expect(out.map((o) => o.id).sort(), `seed ${seed}`).toEqual(["ann", "bob"]);
      for (const o of out) {
        seen.add(o.saved);
        expect(o.amount).toBe(Math.max(1, o.saved ? Math.floor(o.rolled / 2) : o.rolled));
        expect(o.left, `seed ${seed}: ${o.id}`).toBe(!o.saved);
      }
    }
    expect(seen.size).toBe(2);
  });

  it("roars at everyone round it: full and Reeling on a failed save, half and steady on a good one", () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 12; seed++) {
      const { events, state } = use("Thunderous Roar", seed);
      const out = outcomes(events, state, "reeling");
      expect(out.map((o) => o.id).sort(), `seed ${seed}`).toEqual(["ann", "bob", "cal"]);
      for (const o of out) {
        seen.add(o.saved);
        expect(o.amount).toBe(Math.max(1, o.saved ? Math.floor(o.rolled / 2) : o.rolled));
        expect(o.left, `seed ${seed}: ${o.id}`).toBe(!o.saved);
      }
    }
    expect(seen.size).toBe(2);
  });
});
