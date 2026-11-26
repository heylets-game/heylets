import { describe, expect, it } from "vitest";
import { at, fails, flatBoard, has, inAFight, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { ABILITIES, onlyInFights } from "../content";
import { FIGHTS_ONLY, checkAbility } from "./combat";
import type { ZoneEvent } from "./types";

// Out of a fight, no condition takes hold but Lucky, and the abilities for the user or an ally (onlyInFights) wait
// for one. A blow that starts a fight is part of it: what it leaves takes hold.

const kit = (abilities: string[]) => ({ classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities, items: {} });

function calm(abilities: string[]) {
  const state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 2 } });
  state.aiOff = true;
  standHero(state, "ann", at(5, 6), kit(abilities));
  standHero(state, "bo", at(4, 6), kit(abilities));
  const foe = enemy(state, "dummy", at(6, 6), "g1", { hp: 500, maxHp: 500 }).id;
  return { state, foe };
}

describe("out of a fight", () => {
  it("only abilities aimed at enemies can be used: those for the user or an ally are for a fight", () => {
    expect(onlyInFights(ABILITIES.take_aim)).toBe(true);
    expect(onlyInFights(ABILITIES.mend)).toBe(true);
    expect(onlyInFights(ABILITIES.hex)).toBe(false);
    const { state } = calm(["take_aim", "mend"]);
    expect(fails(state, { type: "use", by: "ann", unit: "ann", ability: "take_aim" })).toBe(FIGHTS_ONLY);
    expect(fails(state, { type: "use", by: "ann", unit: "ann", ability: "mend", target: "bo" })).toBe(FIGHTS_ONLY);
    expect(state.units.every((u) => u.conditions.length === 0)).toBe(true);
  });

  it("one for an ally can still go to a friend in a fight", () => {
    const { state } = calm(["mend"]);
    inAFight(state, "bo");
    expect(checkAbility(state, unit(state, "ann"), "mend", { target: "bo" })).toBeNull();
    expect(checkAbility(state, unit(state, "ann"), "mend", { target: "ann" })).toBe(FIGHTS_ONLY);
  });

  it("a blow that starts a fight leaves what it leaves, as the fight begins", () => {
    let landed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { state, foe } = calm(["hex"]);
      state.rng = seed;
      const events: ZoneEvent[] = [];
      const after = must(state, { type: "use", by: "ann", unit: "ann", ability: "hex", target: foe }, events);
      expect(after.encounter?.order).toContain(foe);
      const failed = events.some((e) => e.t === "roll" && e.roll.kind === "save" && e.roll.id === foe && !e.roll.ok);
      expect(has(after, foe, "fumbling"), `seed ${seed}`).toBe(failed);
      if (failed) landed++;
    }
    expect(landed).toBeGreaterThan(0);
  });
});
