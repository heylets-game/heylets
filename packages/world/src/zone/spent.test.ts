import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { ABILITIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { addUses, attackContext, attackRoll, countDown, inflict, leaveFight, usesLeft, type Ctx } from "./engine";
import { loadZone } from "./zone";
import type { Condition, ZoneState } from "./types";

// Fumbling and Inspired are stacks spent a roll to hit at a time: they pile up, do not wear off with the turns, and go
// when the fight does.

const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function fight() {
  let state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 1 } });
  state.aiOff = true;
  standHero(state, "ann", at(5, 6), hero);
  const foe = enemy(state, "dummy", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(1), events: [], effects: [] };
  return { ctx, ann: unit(ctx.state, "ann"), foe: unit(ctx.state, foe) };
}

const stacks = (state: ZoneState, id: string, kind: Condition) => {
  const c = unit(state, id).conditions.find((c) => c.kind === kind);
  return c ? usesLeft(c) : 0;
};

describe("Fumbling and Inspired", () => {
  it("are left as stacks by what leaves them, with no turns to them", () => {
    for (const def of [ABILITIES.hex.saveOr, ABILITIES.disarming_chop.saveOr, ABILITIES.dissonance.targetEffect, ENEMY_ABILITIES.wail.saveOr]) {
      expect(def).toEqual({ effect: "fumbling", stacks: 1 });
    }
  });

  for (const kind of ["fumbling", "inspired"] as const) {
    it(`${kind}: stacks pile up past one, and each roll to hit spends one`, () => {
      const { ctx, ann, foe } = fight();
      if (kind === "fumbling") inflict(ctx, ann, { effect: "fumbling", stacks: 1 });
      else addUses(ctx, ann, kind, 1);
      addUses(ctx, ann, kind, 2);
      expect(stacks(ctx.state, "ann", kind)).toBe(3);
      expect(attackContext(ctx.state, ann, foe, { melee: true }).adv).toBe(kind === "fumbling" ? -1 : 1);
      attackRoll(ctx, ann, foe, { label: "Bash", bonus: 0, melee: true });
      expect(stacks(ctx.state, "ann", kind)).toBe(2);
      attackRoll(ctx, ann, foe, { label: "Bash", bonus: 0, melee: true });
      attackRoll(ctx, ann, foe, { label: "Bash", bonus: 0, melee: true });
      expect(unit(ctx.state, "ann").conditions.some((c) => c.kind === kind)).toBe(false);
      expect(attackContext(ctx.state, ann, foe, { melee: true }).adv).toBe(0);
    });

    it(`${kind}: keeps however many turns go by, and goes when the fight ends`, () => {
      const { ctx, ann } = fight();
      addUses(ctx, ann, kind, 2);
      for (let i = 0; i < 5; i++) countDown(ann);
      expect(stacks(ctx.state, "ann", kind)).toBe(2);
      leaveFight(ann);
      expect(stacks(ctx.state, "ann", kind)).toBe(0);
    });
  }

  it("a fight's end takes every condition off those in it but Lucky, and leaves those not in it alone", () => {
    let state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 2 } });
    state.aiOff = true;
    standHero(state, "ann", at(5, 6), hero);
    standHero(state, "bob", at(1, 1), hero);
    enemy(state, "dummy", at(6, 6));
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    expect(state.encounter!.order).not.toContain("bob");
    unit(state, "ann").conditions.push(
      { kind: "lucky", rounds: 1, amount: 2 },
      { kind: "inspired", rounds: 1, amount: 1 },
      { kind: "guarded", rounds: 1 },
      { kind: "burning", rounds: 2, amount: 1 },
    );
    unit(state, "bob").conditions.push({ kind: "wet", rounds: 2 });
    state = must(state, { type: "dev", by: "ann", dev: { op: "end_fight" } });
    expect(state.encounter).toBeNull();
    expect(unit(state, "ann").conditions).toEqual([{ kind: "lucky", rounds: 1, amount: 2 }]);
    expect(unit(state, "bob").conditions.map((c) => c.kind)).toEqual(["wet"]);
  });

  it("a fight saved with the old name for Fumbling loads with it as Fumbling", () => {
    const { ctx } = fight();
    unit(ctx.state, "ann").conditions.push({ kind: "glitched" as Condition, rounds: 1 });
    const loaded = loadZone(ctx.state);
    expect(unit(loaded, "ann").conditions.map((c) => c.kind)).toContain("fumbling");
    expect(stacks(loaded, "ann", "fumbling")).toBe(1);
  });
});
