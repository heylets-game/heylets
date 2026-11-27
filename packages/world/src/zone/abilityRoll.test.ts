import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { ABILITIES } from "../content";
import { abilityDice, healDice } from "./kit";
import { damageRoll, healRoll } from "./combat";
import type { ZoneEvent } from "./types";

// What an ability's tooltip says it rolls is what it rolls: the ability's own dice, and the hero's stat, weapon and
// level on top.

function board(level: number, power: number) {
  let state = flatBoard({ rng: 1, start: at(1, 6), options: { party: 2 } });
  state.aiOff = true;
  const ann = Object.assign(standHero(state, "ann", at(5, 6), { classId: "qa_paladin", level, armor: 0, power, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 });
  const foe = Object.assign(enemy(state, "skeleton", at(6, 6)), { hp: 900, maxHp: 900 });
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, ann: ann.id, foe: foe.id };
}

describe("an ability's roll as its user would make it", () => {
  it("adds the hero's stat, weapon and level to the ability's own dice", () => {
    const low = board(1, 0);
    const high = board(9, 4);
    const bash = ABILITIES.bash;
    expect(damageRoll(low.state, unit(low.state, "ann"), bash)).toMatchObject({ n: abilityDice(bash).n, d: abilityDice(bash).d });
    expect(damageRoll(high.state, unit(high.state, "ann"), bash).plus - damageRoll(low.state, unit(low.state, "ann"), bash).plus).toBe(4 + Math.floor(9 / 2) - Math.floor(1 / 2));
    const heal = Object.values(ABILITIES).find((a) => a.heal && !a.damage)!;
    expect(healRoll(unit(high.state, "ann"), heal).plus).toBeGreaterThan(healDice(heal).plus);
  });

  it("is what a blow then rolls", () => {
    for (let seed = 1; seed < 40; seed++) {
      let { state, foe } = board(7, 3);
      state.rng = seed;
      const shown = damageRoll(state, unit(state, "ann"), ABILITIES.bash);
      const events: ZoneEvent[] = [];
      state = must(state, { type: "use", by: "ann", unit: "ann", ability: "bash", target: foe }, events);
      const hit = events.find((e) => e.t === "hit" && e.what === "bash");
      if (hit?.t !== "hit" || hit.crit) continue;
      expect(hit.dice).toMatchObject({ d: shown.d, plus: shown.plus });
      expect(hit.dice!.faces).toHaveLength(shown.n);
      return;
    }
    throw new Error("never landed");
  });
});
