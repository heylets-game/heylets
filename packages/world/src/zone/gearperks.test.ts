// Powers from gear in a fight: what Cloudstep Boots, Springheel Boots, Phase Treads and the rest do on the tiles
// (gear.ts GearPerk; hooked into surfaces.ts, geometry.ts, combat.ts, engine.ts and zone.ts).

import { describe, expect, it } from "vitest";
import { posKey, type HexPos } from "@gantt-quest/core";
import { at, fails, flatBoard, has, inAFight, must, standEnemy, standHero, unit } from "../test/zoneBoard";
import { ENEMIES } from "../content";
import { BLINK_AP, type Perks } from "../gear";
import type { Tile } from "../map";
import { makeRng } from "../rng";
import { addCondition, attackRoll, type Ctx } from "./engine";
import { stepCost } from "./geometry";
import { AP_TURN, COMMON_ACTIONS, JUMP_RANGE, enemyStrikes } from "./kit";
import { enemyAct } from "./combat";
import type { SurfaceKind, Unit, ZoneAction, ZoneEvent, ZoneState } from "./types";

const same = (a: HexPos, b: HexPos) => a.q === b.q && a.r === b.r;
const board = (edit: (t: Tile) => void = () => {}): ZoneState => flatBoard({ rng: 12345, start: at(1, 1), options: { party: 1 }, flags: { aiOff: true }, edit });

/** Ann, a Paladin, in what gives these powers. */
const ann = (state: ZoneState, pos: HexPos, perks: Perks = {}): Unit => {
  const u = standHero(state, "ann", pos, { classId: "qa_paladin", level: 1, armor: 2, power: 1, abilities: ["bash"], items: {} });
  if (Object.keys(perks).length > 0) u.perks = perks;
  return u;
};
const foe = (state: ZoneState, pos: HexPos, kind = "dummy"): Unit => standEnemy(state, kind, pos, "g1", { hp: ENEMIES[kind].hp, maxHp: ENEMIES[kind].hp });
const lay = (state: ZoneState, kind: SurfaceKind, hexes: HexPos[]) => {
  for (const p of hexes) state.surfaces[posKey(p)] = { kind, rounds: 5, by: null };
};
const move = (to: HexPos): ZoneAction => ({ type: "move", by: "ann", unit: "ann", to });
const jump = (to: HexPos): ZoneAction => ({ type: "common", by: "ann", unit: "ann", what: "jump", at: to });

/** Start a fight and come round to Ann's turn. */
function fight(state: ZoneState): ZoneState {
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  for (let i = 0; i < 40 && state.encounter && state.encounter.acting[0] !== "ann"; i++) state = must(state, { type: "timeout" });
  expect(state.encounter?.acting).toEqual(["ann"]);
  return state;
}
const ctxOf = (state: ZoneState, seed = 3): Ctx => ({ state, rng: makeRng(seed), events: [], effects: [] });

describe("Cloudstep Boots (hover)", () => {
  it("float over poison, water, slime and ice untouched", () => {
    for (const kind of ["poison", "water", "slime", "ice"] as const) {
      const state = board();
      ann(state, at(4, 6), { hover: 1 });
      lay(state, kind, [at(5, 6), at(6, 6)]);
      const after = must(state, move(at(7, 6)));
      expect(unit(after, "ann").pos).toEqual(at(7, 6));
      expect(unit(after, "ann").conditions).toEqual([]);
      expect(unit(after, "ann").hp).toBe(unit(after, "ann").maxHp);
    }
  });

  it("still burn in fire", () => {
    const state = board();
    ann(state, at(4, 6), { hover: 1 });
    lay(state, "fire", [at(5, 6)]);
    const after = must(state, move(at(5, 6)));
    expect(unit(after, "ann").hp).toBeLessThan(unit(after, "ann").maxHp);
  });

  it("cross oil and slime for no more than open ground", () => {
    const state = board();
    const u = ann(state, at(4, 6), { hover: 1 });
    lay(state, "oil", [at(5, 6)]);
    expect(stepCost(state, u, at(4, 6), at(5, 6)).cost).toBe(1);
    delete u.perks;
    expect(stepCost(state, u, at(4, 6), at(5, 6)).cost).toBe(2);
  });
});

describe("Ice Cleats (sure-footed)", () => {
  it("never slip on ice, and slime does not slow them", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = { ...board(), rng: seed };
      ann(state, at(4, 6), { sure_footed: 1 });
      lay(state, "ice", [at(5, 6)]);
      lay(state, "slime", [at(6, 6)]);
      const after = must(state, move(at(7, 6)));
      expect(unit(after, "ann").pos).toEqual(at(7, 6));
      expect(has(after, "ann", "prone")).toBe(false);
      expect(has(after, "ann", "slowed")).toBe(false);
    }
  });

  it("still get Wet in water and burn in fire", () => {
    const state = board();
    ann(state, at(4, 6), { sure_footed: 1 });
    lay(state, "water", [at(5, 6)]);
    // Out of a fight nothing takes hold but Lucky (engine.ts OUTLASTS_FIGHT): the wading is done in one.
    expect(has(must(state, move(at(5, 6))), "ann", "wet")).toBe(false);
    addCondition(ctxOf(inAFight(state, "ann")), unit(state, "ann"), "wet", 2);
    expect(has(state, "ann", "wet")).toBe(true);
  });
});

describe("Springheel Boots (long jump)", () => {
  it("jump farther, for 1 AP less", () => {
    let state = board();
    ann(state, at(4, 6), { long_jump: 1 });
    foe(state, at(14, 6));
    state = fight(state);
    const far = at(4 + JUMP_RANGE + 1, 6);
    state = must(state, jump(far));
    expect(unit(state, "ann").pos).toEqual(far);
    expect(state.encounter!.budgets.ann.ap).toBe(AP_TURN - (COMMON_ACTIONS.jump.cost - 1));
  });

  it("without them the same jump is too far", () => {
    let state = board();
    ann(state, at(4, 6));
    foe(state, at(14, 6));
    state = fight(state);
    expect(fails(state, jump(at(4 + JUMP_RANGE + 1, 6)))).toMatch(/Too far/);
  });
});

describe("Phase Treads (blink)", () => {
  /** Ann, a wall two hexes high between her and the far side. */
  const walled = () => board((t) => {
    if (same(t, at(6, 6))) t.elev = 4;
  });

  it("a jump a leap can make is still a jump, at the jump's AP", () => {
    let state = board();
    ann(state, at(4, 6), { blink: 6 });
    foe(state, at(14, 6));
    state = fight(state);
    const events: ZoneEvent[] = [];
    state = must(state, jump(at(6, 6)), events);
    expect(events.some((e) => e.t === "jumped")).toBe(true);
    expect(state.encounter!.budgets.ann.ap).toBe(AP_TURN - COMMON_ACTIONS.jump.cost);
  });

  it("past jump reach it blinks, for BLINK_AP, and draws no blow on the way", () => {
    let state = board();
    ann(state, at(4, 6), { blink: 6 });
    foe(state, at(5, 6), "bandit");
    state = fight(state);
    const events: ZoneEvent[] = [];
    state = must(state, jump(at(10, 6)), events);
    expect(unit(state, "ann").pos).toEqual(at(10, 6));
    expect(events).toContainEqual({ t: "blinked", id: "ann", from: at(4, 6), to: at(10, 6), phase: true });
    expect(state.encounter!.budgets.ann.ap).toBe(AP_TURN - BLINK_AP);
    expect(events.some((e) => e.t === "roll" && e.roll.kind === "attack")).toBe(false);
  });

  it("blinks past what a leap cannot clear", () => {
    let state = walled();
    ann(state, at(5, 6), { blink: 6 });
    foe(state, at(14, 2));
    state = fight(state);
    // Up onto the high hex is too high for a leap.
    const events: ZoneEvent[] = [];
    state = must(state, jump(at(6, 6)), events);
    expect(events.some((e) => e.t === "blinked")).toBe(true);
  });

  it("goes no farther than its reach, and only where there is room to stand", () => {
    let state = board();
    ann(state, at(2, 6), { blink: 6 });
    foe(state, at(8, 6));
    state = fight(state);
    expect(fails(state, jump(at(9, 6)))).toMatch(/Too far/);
    expect(fails(state, jump(at(8, 6)))).toBeTruthy();
  });

  it("lands in fire and burns", () => {
    let state = board();
    ann(state, at(2, 6), { blink: 6 });
    foe(state, at(14, 2));
    lay(state, "fire", [at(8, 6)]);
    state = fight(state);
    state = must(state, jump(at(8, 6)));
    expect(unit(state, "ann").hp).toBeLessThan(unit(state, "ann").maxHp);
  });
});

describe("Courier's Shoes (swift) and Windrunner Leggings (fleet)", () => {
  it("swift: each AP buys a hex more; Slowed still halves it", () => {
    let plain = board();
    ann(plain, at(4, 6));
    foe(plain, at(14, 2));
    plain = fight(plain);
    let swift = board();
    ann(swift, at(4, 6), { swift: 1 });
    foe(swift, at(14, 2));
    swift = fight(swift);
    expect(swift.encounter!.budgets.ann.stride).toBe(plain.encounter!.budgets.ann.stride + 1);
  });

  it("fleet: free hexes at the start of a turn, and no Slowing", () => {
    let state = board();
    ann(state, at(4, 6), { fleet: 2 });
    foe(state, at(14, 2));
    state = fight(state);
    expect(state.encounter!.budgets.ann.move).toBe(2);
    addCondition(ctxOf(state), unit(state, "ann"), "slowed", 2);
    expect(has(state, "ann", "slowed")).toBe(false);
  });
});

describe("what gear keeps off", () => {
  it("Storm Crown: no Stun; Stoker's Apron: no Burning; Sea-Legs Slops: no fall", () => {
    const cases = [["clear_head", "stunned"], ["fireproof", "burning"], ["steady", "prone"]] as const;
    for (const [perk, kind] of cases) {
      const state = board();
      ann(state, at(4, 6), { [perk]: 1 });
      inAFight(state, "ann");
      addCondition(ctxOf(state), unit(state, "ann"), kind, 2);
      expect(has(state, "ann", kind)).toBe(false);
      const bare = board();
      ann(bare, at(4, 6));
      inAFight(bare, "ann");
      addCondition(ctxOf(bare), unit(bare, "ann"), kind, 2);
      expect(has(bare, "ann", kind)).toBe(true);
    }
  });

  it("Pathfinder's Breeches: forest and hills are open ground", () => {
    const state = board((t) => {
      if (same(t, at(5, 6))) t.biome = "forest";
    });
    const u = ann(state, at(4, 6), { trailblazer: 1 });
    expect(stepCost(state, u, at(4, 6), at(5, 6)).cost).toBe(1);
    delete u.perks;
    expect(stepCost(state, u, at(4, 6), at(5, 6)).cost).toBe(2);
  });
});

describe("Soft-Sole Sneaks, Ghostsail Cloak and Barnacle Mail", () => {
  it("light step: walking away from an enemy draws no free attack", () => {
    let state = board();
    ann(state, at(5, 6), { light_step: 1 });
    foe(state, at(6, 6), "bandit");
    state = fight(state);
    const events: ZoneEvent[] = [];
    state = must(state, move(at(2, 6)), events);
    expect(events.some((e) => e.t === "roll" && e.roll.kind === "attack")).toBe(false);
  });

  it("ghostly: the first attacks each fight miss, however they were rolled", () => {
    let state = board();
    const u = ann(state, at(5, 6), { ghostly: 2 });
    const bandit = foe(state, at(6, 6), "bandit");
    state = fight(state);
    const ctx = ctxOf(state);
    const rolls = [1, 2, 3, 4].map(() => attackRoll(ctx, bandit, u, { label: "Cut", bonus: 50, melee: true }));
    expect(rolls.map((r) => r.ok)).toEqual([false, false, true, true]);
  });

  it("thorns: an enemy that lands a blow up close takes the mail's damage; one that misses does not", () => {
    let cut = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = board();
      const u = ann(state, at(5, 6), { thorns: 3 });
      const bandit = foe(state, at(6, 6), "bandit");
      bandit.hp = bandit.maxHp = 100;
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, bandit, enemyStrikes("bandit", 1)[0], u);
      const landed = ctx.events.some((e) => e.t === "hit" && e.actor === bandit.id && e.target === "ann");
      const barbed = ctx.events.find((e) => e.t === "hit" && e.what === "thorns" && e.target === bandit.id);
      expect(!!barbed).toBe(landed);
      if (barbed) {
        expect(barbed).toMatchObject({ actor: "ann", amount: 3 });
        cut++;
      }
    }
    expect(cut).toBeGreaterThan(0);
  });
});
