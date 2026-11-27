import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { ENEMIES } from "../content";
import { enterSurface, harms, placeSurface, standInSurface } from "./surfaces";
import type { Ctx } from "./engine";
import type { SurfaceKind, ZoneEvent, ZoneState } from "./types";

// Some creatures are at home in their own ground: whatever it does to anyone else, it does nothing to them (EnemyDef
// groundImmune). An Ember Hound walks through fire, a Giant Spider through poison and slime, and the frost's own
// (a Rime Wraith, a Snow Bear) cross ice without a slip.

const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };
const ctxOf = (state: ZoneState, seed = 1): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });

function board(kind: string) {
  let state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  Object.assign(standHero(state, "ann", at(3, 6), hero), { hp: 900, maxHp: 900 });
  const id = enemy(state, kind, at(8, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, id };
}

const CASES: [string, SurfaceKind][] = [
  ["ember_hound", "fire"],
  ["spider", "poison"],
  ["spider", "slime"],
  ["wraith", "ice"],
  ["snow_bear", "ice"],
];

describe("ground a creature is immune to", () => {
  it.each(CASES)("%s is immune to %s", (kind, ground) => {
    expect(ENEMIES[kind].groundImmune).toContain(ground);
  });

  it.each(CASES)("%s takes nothing from %s, walking in or standing in it", (kind, ground) => {
    for (let seed = 1; seed <= 20; seed++) {
      const { state, id } = board(kind);
      const ctx = ctxOf(state, seed);
      const me = unit(ctx.state, id);
      placeSurface(ctx, [me.pos], ground, 3, null);
      const hp = unit(ctx.state, id).hp;
      const stopped = enterSurface(ctx, unit(ctx.state, id));
      standInSurface(ctx, unit(ctx.state, id));
      const after = unit(ctx.state, id);
      expect(stopped).toBe(false);
      expect(after.hp).toBe(hp);
      expect(after.conditions.map((c) => c.kind)).toEqual(unit(state, id).conditions.map((c) => c.kind));
    }
  });

  it("still takes what other ground does to it", () => {
    const { state, id } = board("ember_hound");
    const ctx = ctxOf(state);
    placeSurface(ctx, [unit(ctx.state, id).pos], "poison", 3, null);
    standInSurface(ctx, unit(ctx.state, id));
    expect(unit(ctx.state, id).conditions.some((c) => c.kind === "poisoned")).toBe(true);
  });

  it("is not steered round, and a hero is not spared it", () => {
    const { state, id } = board("ember_hound");
    expect(harms(unit(state, id), "fire")).toBe(false);
    expect(harms(unit(state, id), "poison")).toBe(true);
    expect(harms(unit(state, "ann"), "fire")).toBe(true);
  });
});
