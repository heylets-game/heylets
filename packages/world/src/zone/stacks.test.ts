import { describe, expect, it } from "vitest";
import { at, flatBoard, standEnemy } from "../test/zoneBoard";
import { ABILITIES, EFFECT_TICK, STACK_TURNS, isStacking, type Inflict } from "../content";
import { makeRng } from "../rng";
import { addCondition, addStacks, burnOf, countDown, heal, tickStacks, type Ctx } from "./engine";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { FIRE_TILE_DAMAGE, placeSurface, standInSurface } from "./surfaces";
import type { Unit } from "./types";

describe("stacking Bleeding and Burning", () => {
  const setUp = () => {
    const state = flatBoard({ rng: 1, start: at(1, 1), options: { party: 1 }, flags: { aiOff: true } });
    const foe = standEnemy(state, "dummy", at(6, 6), "g1", { hp: 500, maxHp: 500 });
    const ctx: Ctx = { state, rng: makeRng(1), events: [], effects: [] };
    return { ctx, foe };
  };
  const cond = (u: Unit, kind: string) => u.conditions.find((c) => c.kind === kind);

  it("lasts as long as it always does, whatever leaves it: Bleeding 3 turns, Burning 2", () => {
    const { ctx, foe } = setUp();
    addCondition(ctx, foe, "bleeding", 9);
    addCondition(ctx, foe, "burning", 9);
    expect(cond(foe, "bleeding")).toMatchObject({ rounds: STACK_TURNS.bleeding, amount: 1 });
    expect(cond(foe, "burning")).toMatchObject({ rounds: STACK_TURNS.burning, amount: 1 });
    // No ability says how long one lasts.
    const left: (Inflict | undefined)[] = [
      ...Object.values(ABILITIES).flatMap((a) => [a.saveOr, a.targetEffect, a.selfEffect]),
      ...Object.values(ENEMY_ABILITIES).map((a) => a.saveOr),
    ];
    for (const what of left) if (what && isStacking(what.effect)) expect("turns" in what, what.effect).toBe(false);
  });

  it("a new stack of Bleeding starts every stack's count over, and each stack bleeds", () => {
    const { ctx, foe } = setUp();
    addStacks(ctx, foe, "bleeding");
    countDown(foe);
    countDown(foe);
    expect(cond(foe, "bleeding")).toMatchObject({ rounds: 1, amount: 1 });
    addStacks(ctx, foe, "bleeding");
    expect(cond(foe, "bleeding")).toMatchObject({ rounds: STACK_TURNS.bleeding, amount: 2 });
    const was = foe.hp;
    tickStacks(ctx, foe);
    expect(was - foe.hp).toBe(2 * EFFECT_TICK.bleeding);
  });

  it("any healing closes one stack of Bleeding", () => {
    const { ctx, foe } = setUp();
    addStacks(ctx, foe, "bleeding", 2);
    foe.hp -= 10;
    heal(ctx, foe, 1, { actor: null, what: "test" });
    expect(cond(foe, "bleeding")).toMatchObject({ amount: 1 });
    heal(ctx, foe, 1, { actor: null, what: "test" });
    expect(cond(foe, "bleeding")).toBeUndefined();
  });

  it("each stack of Burning keeps its own count, and goes out on its own", () => {
    const { ctx, foe } = setUp();
    addStacks(ctx, foe, "burning");
    countDown(foe);
    addStacks(ctx, foe, "burning");
    expect(cond(foe, "burning")).toMatchObject({ rounds: STACK_TURNS.burning, amount: 2 });
    expect(burnOf(foe)).toBe(2 * EFFECT_TICK.burning);
    // The first stack burns out; the second burns on.
    countDown(foe);
    expect(cond(foe, "burning")).toMatchObject({ rounds: 1, amount: 1 });
    countDown(foe);
    expect(cond(foe, "burning")).toBeUndefined();
  });

  it("fire on the ground does a little at once, and a stack of Burning every time", () => {
    const { ctx, foe } = setUp();
    // Fire set under it catches it at once.
    placeSurface(ctx, [foe.pos], "fire", 5, null);
    expect(cond(foe, "burning")).toMatchObject({ amount: 1 });
    const was = foe.hp;
    standInSurface(ctx, foe);
    standInSurface(ctx, foe);
    expect(was - foe.hp).toBe(2 * FIRE_TILE_DAMAGE);
    expect(cond(foe, "burning")).toMatchObject({ amount: 3 });
  });
});
