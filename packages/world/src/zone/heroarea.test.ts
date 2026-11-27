import { describe, expect, it } from "vitest";
import { posKey } from "@gantt-quest/core";
import { at, flatBoard, standHero } from "../test/zoneBoard";
import { abilityArea } from "./combat";

// A hero's area (a burst round them) leaves out hexes with no ground, as an enemy's blast does.

describe("a hero's burst", () => {
  it("skips the hexes that have no ground", () => {
    const gone = at(5, 6);
    const state = flatBoard({ rng: 1, start: at(2, 6), gone: [gone] });
    const ann = standHero(state, "ann", at(4, 6), { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bellows_blast"], items: {} });
    const keys = abilityArea(state, ann, "bellows_blast").map(posKey);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).not.toContain(posKey(gone));
  });
});
