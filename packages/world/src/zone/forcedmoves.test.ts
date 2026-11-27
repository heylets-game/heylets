import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct, fieldsCatch, resolveAbility } from "./combat";
import { abilityStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// Whoever is moved by force (shoved, pulled, swept, blinked) arrives on the hex as one who walked there does: the
// fields of the other side's there catch them at once (combat.ts arrive).

const hero = { classId: "qa_paladin", level: 3, armor: 0, power: 1, abilities: ["bash"], items: {} };

/** A context whose arrivals are told as the reducer tells them (zone.ts onStep: a field catches whoever comes in), and counted. */
function ctxOf(state: ZoneState, seed: number) {
  const arrivals: string[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] };
  ctx.onStep = (u) => {
    arrivals.push(u.id);
    fieldsCatch(ctx, u);
    return false;
  };
  return { ctx, arrivals };
}

/** A fight with Ann at (6,6), a brute at (4,6) who shoves her east, and `holder` (a kind with a field up) at (8,6). */
function setUp(holder: string, field: string) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  Object.assign(standHero(state, "ann", at(6, 6), hero), { hp: 900, maxHp: 900 });
  const brute = enemy(state, "brute", at(5, 6), "g1", { hp: 900, maxHp: 900 }).id;
  const keeper = enemy(state, holder, at(8, 6), "g1", { hp: 900, maxHp: 900 }).id;
  unit(state, keeper).conditions.push({ kind: field, rounds: 3, amount: field === "slowing_field" ? 2 : 1 } as never);
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, brute, keeper };
}

/** Run the brute's Shove at Ann for seeds until it lands, and give the first context that did. */
function shoved(state: ZoneState, brute: string) {
  for (let seed = 1; seed <= 40; seed++) {
    const run = ctxOf(state, seed);
    enemyAct(run.ctx, unit(run.ctx.state, brute), abilityStrikes(["shove"], 3)[0], unit(run.ctx.state, "ann"));
    if (run.ctx.events.some((e) => e.t === "shoved" && e.target === "ann" && e.to)) return run;
  }
  throw new Error("the shove never landed");
}

describe("being shoved into a field", () => {
  it("a hero shoved into a Snow Bear's Blizzard Aura is caught by it at once", () => {
    const { state, brute } = setUp("snow_bear", "blizzard_aura");
    const { ctx, arrivals } = shoved(state, brute);
    expect(arrivals).toContain("ann");
    expect(unit(ctx.state, "ann").caughtBy).toEqual([unit(ctx.state, "e102").id]);
    // It bit (damage) and asked for a save.
    expect(ctx.events.some((e) => e.t === "roll" && e.roll.kind === "save" && e.roll.id === "ann" && /Blizzard/.test(e.roll.label))).toBe(true);
  });

  it("a hero shoved into a Guardian's Slowing Field is Slowed at once", () => {
    const { state, brute } = setUp("guardian", "slowing_field");
    const { ctx } = shoved(state, brute);
    expect(unit(ctx.state, "ann").conditions.some((c) => c.kind === "slowed")).toBe(true);
  });
});

describe("a blink arrives once", () => {
  it("Smuggler's Route meets the hex once, not twice", () => {
    let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
    state.aiOff = true;
    Object.assign(standHero(state, "ann", at(3, 6), { ...hero, abilities: ["smugglers_route"] }), { hp: 900, maxHp: 900 });
    const bear = enemy(state, "snow_bear", at(9, 6), "g1", { hp: 900, maxHp: 900 }).id;
    unit(state, bear).conditions.push({ kind: "blizzard_aura", rounds: 3, amount: 1 });
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    const { ctx, arrivals } = ctxOf(state, 1);
    resolveAbility(ctx, unit(ctx.state, "ann"), "smugglers_route", { at: at(8, 6) });
    expect(unit(ctx.state, "ann").pos).toEqual(at(8, 6));
    expect(arrivals).toEqual(["ann"]);
    expect(ctx.events.some((e) => e.t === "roll" && e.roll.id === "ann" && /Blizzard/.test(e.roll.label))).toBe(true);
  });
});
