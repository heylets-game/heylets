import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { addCondition, addUses, damage, tick, type Ctx } from "./engine";
import { BEHAVIOURS } from "./behaviours";
import type { ZoneEvent, ZoneState } from "./types";

// A Skeleton: a Rusted Cutlass, and Memento Mori at everyone beside it, which leaves those who fail to save Fumbling
// each time they are hurt, for 4 turns, unless they are Fumbling already.

const strike = (name: string) => enemyStrikes("skeleton", 1).find((s) => s.name === name)!;
const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };
const fumbles = (state: ZoneState, id: string) => unit(state, id).conditions.find((c) => c.kind === "fumbling")?.amount ?? 0;
const marked = (state: ZoneState, id: string) => unit(state, id).conditions.find((c) => c.kind === "memento_mori");

function board() {
  let state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 2 }, flags: { shareTurns: true } });
  state.aiOff = true;
  // Ann beside it, Bob two off: out of its reach.
  for (const [id, pos] of [["ann", at(5, 6)], ["bob", at(4, 6)]] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const skeleton = enemy(state, "skeleton", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, skeleton };
}

function mori(seed: number) {
  const { state, skeleton } = board();
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, skeleton), strike("Memento Mori"), unit(ctx.state, "ann"));
  return { events, state: ctx.state };
}

describe("a Skeleton", () => {
  it("swings its cutlass and reminds you that you will die", () => {
    expect(ENEMIES.skeleton.abilities).toContain("rusted_cutlass");
    expect(ENEMIES.skeleton.abilities).toContain("memento_mori");
    expect(ENEMIES.skeleton.abilities).not.toContain("bone_rattle");
    expect(ENEMY_ABILITIES.memento_mori).toMatchObject({ shape: "burst", range: 1, cooldown: 4, weight: 3, saveOr: { effect: "memento_mori", turns: 4 } });
    expect(strike("Memento Mori")).toMatchObject({ burst: true, range: 1, cooldown: 4, harmless: true });
  });

  it("marks only those beside it, on a failed save, and does them no harm", () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 12; seed++) {
      const { events, state } = mori(seed);
      expect(events.some((e) => e.t === "hit"), `seed ${seed}`).toBe(false);
      const saves = events.filter((e): e is Extract<ZoneEvent, { t: "roll" }> => e.t === "roll" && e.roll.kind === "save");
      expect(saves.map((s) => s.roll.id)).toEqual(["ann"]);
      seen.add(saves[0].roll.ok);
      expect(marked(state, "ann")?.rounds ?? 0).toBe(saves[0].roll.ok ? 0 : 4);
      expect(marked(state, "bob")).toBeUndefined();
    }
    expect(seen.size).toBe(2);
  });

  it("leaves one marked Fumbling each time they are hurt, never more than one stack", () => {
    const { state } = board();
    const ctx: Ctx = { state: structuredClone(state), rng: makeRng(1), events: [], effects: [] };
    const ann = unit(ctx.state, "ann");
    damage(ctx, ann, 5, { actor: null, what: "test" });
    expect(fumbles(ctx.state, "ann")).toBe(0);
    addCondition(ctx, ann, "memento_mori", 4);
    damage(ctx, ann, 5, { actor: null, what: "test" });
    expect(fumbles(ctx.state, "ann")).toBe(1);
    // Fumbling already: no more.
    damage(ctx, ann, 5, { actor: null, what: "test" });
    tick(ctx, ann, "bleeding", 2);
    expect(fumbles(ctx.state, "ann")).toBe(1);
    // Spent, it comes back with the next wound, from a burn as much as a blow.
    ann.conditions = ann.conditions.filter((c) => c.kind !== "fumbling");
    tick(ctx, ann, "burning", 2);
    expect(fumbles(ctx.state, "ann")).toBe(1);
    // More Fumbling from elsewhere is not taken off.
    addUses(ctx, ann, "fumbling", 2);
    damage(ctx, ann, 5, { actor: null, what: "test" });
    expect(fumbles(ctx.state, "ann")).toBe(3);
  });

  it("thinks it worth using on those beside it who are not marked yet", () => {
    const { state, skeleton } = board();
    const look = { state, enemy: unit(state, skeleton) };
    const heroes = [unit(state, "ann"), unit(state, "bob")];
    const use = BEHAVIOURS.burst.value(look as never, look.enemy.pos, strike("Memento Mori"), heroes);
    expect(use?.worth).toBeGreaterThan(0);
    unit(state, "ann").conditions.push({ kind: "memento_mori", rounds: 4 });
    expect(BEHAVIOURS.burst.value(look as never, look.enemy.pos, strike("Memento Mori"), heroes)).toBeNull();
  });
});
