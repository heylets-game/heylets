import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { stopped } from "./unless";

// What stops an effect (unless.ts): a condition on the unit, a foe beside it, standing in water.

function setUp() {
  let state = flatBoard({ rng: 1, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  standHero(state, "ann", at(5, 6), { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} });
  const far = enemy(state, "bandit", at(9, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, far };
}

describe("stopped", () => {
  it("never, for nothing or an empty list", () => {
    const { state } = setUp();
    expect(stopped(state, unit(state, "ann"), undefined)).toBe(false);
    expect(stopped(state, unit(state, "ann"), [])).toBe(false);
  });

  it("while the unit has the condition", () => {
    const { state } = setUp();
    const ann = unit(state, "ann");
    expect(stopped(state, ann, [{ has: "burning" }])).toBe(false);
    ann.conditions.push({ kind: "burning", rounds: 2 });
    expect(stopped(state, ann, [{ has: "burning" }])).toBe(true);
    expect(stopped(state, ann, [{ has: "slowed" }, { has: "burning" }])).toBe(true);
  });

  it("while a standing foe in the fight is beside it, and not one further off", () => {
    const { state, far } = setUp();
    const ann = unit(state, "ann");
    expect(stopped(state, ann, [{ besideFoe: true }])).toBe(false);
    unit(state, far).pos = at(6, 6);
    expect(stopped(state, ann, [{ besideFoe: true }])).toBe(true);
    unit(state, far).down = true;
    expect(stopped(state, ann, [{ besideFoe: true }])).toBe(false);
  });

  it("while it stands in water", () => {
    const { state } = setUp();
    const ann = unit(state, "ann");
    expect(stopped(state, ann, [{ inWater: true }])).toBe(false);
    state.surfaces[`${ann.pos.q},${ann.pos.r}`] = { kind: "water", rounds: 3, by: null };
    expect(stopped(state, ann, [{ inWater: true }])).toBe(true);
  });
});
