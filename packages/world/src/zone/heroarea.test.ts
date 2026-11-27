import { describe, expect, it } from "vitest";
import { posKey } from "@gantt-quest/core";
import { at, flatBoard, standHero } from "../test/zoneBoard";
import { abilityArea, spreadOver } from "./combat";
import type { Spread } from "./geometry";

// No area covers a hex with no ground under it, whatever its shape, a hero's or an enemy's (combat.ts spreadOver).

const gone = at(5, 6);
const board = () => flatBoard({ rng: 1, start: at(2, 6), gone: [gone] });
const hero = (abilities: string[]) => ({ classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities, items: {} });

describe("an area and the hexes with no ground", () => {
  it("a hero's burst, splash, swing and the hexes beside skip them", () => {
    const state = board();
    const ann = standHero(state, "ann", at(4, 6), hero(["bellows_blast", "revitalizing_splash", "cleave", "stoke_the_fire"]));
    for (const [id, aim] of [["bellows_blast", undefined], ["revitalizing_splash", gone], ["cleave", gone], ["stoke_the_fire", undefined]] as const) {
      const keys = abilityArea(state, ann, id, aim).map(posKey);
      expect(keys.length, id).toBeGreaterThan(0);
      expect(keys, id).not.toContain(posKey(gone));
    }
  });

  it("every shape skips them", () => {
    const state = board();
    const shapes: Spread[] = [
      { shape: "cluster", size: 7 }, { shape: "blast", radius: 1 }, { shape: "sweep", rows: 2 }, { shape: "cone", rows: 3 },
      { shape: "line", length: 5 }, { shape: "arc" }, { shape: "burst", radius: 1 }, { shape: "adjacent" },
    ];
    for (const spread of shapes) expect(spreadOver(state, spread, at(4, 6), gone).map(posKey), spread.shape).not.toContain(posKey(gone));
  });
});
