import { describe, expect, it } from "vitest";
import { stepZone } from "./zone";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import type { ZoneEvent, ZoneState } from "./types";

// A dev order (the Maps tab's Combat section): an enemy uses the ability it is told to, on its own turn, with every
// turn before it passed.

const kit = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function board(fight = true): { state: ZoneState; wolf: string; bandit: string } {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 } });
  Object.assign(standHero(state, "ann", at(5, 6), kit), { hp: 900, maxHp: 900 });
  Object.assign(standHero(state, "bob", at(5, 7), { ...kit, controller: "ann" }), { hp: 900, maxHp: 900 });
  const wolf = enemy(state, "wolf", at(6, 6)).id;
  const bandit = enemy(state, "bandit", at(6, 7)).id;
  if (fight) state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, wolf, bandit };
}

const order = (state: ZoneState, unit: string, ability: string, target?: string) => {
  const events: ZoneEvent[] = [];
  const after = must(state, { type: "dev", by: "ann", dev: { op: "enemy_use", unit, ability, ...(target ? { target } : {}) } }, events);
  return { after, events };
};
const used = (events: ZoneEvent[], id: string) => events.filter((e): e is Extract<ZoneEvent, { t: "used" }> => e.t === "used" && e.id === id);

describe("a dev order to an enemy", () => {
  it("has it use that ability, at the hero named, and every other enemy passes", () => {
    const { state, wolf, bandit } = board();
    state.aiOff = false;
    const { after, events } = order(state, bandit, "slash", "bob");
    expect(used(events, bandit)).toEqual([expect.objectContaining({ name: "Slash", target: "bob" })]);
    // The wolf's turn, if it came before the bandit's, was passed; one after it is played as ever.
    const order0 = state.encounter!.order;
    if (order0.indexOf(wolf) < order0.indexOf(bandit)) expect(events.findIndex((e) => e.t === "used" && e.id === wolf)).not.toBeLessThan(events.findIndex((e) => e.t === "used" && e.id === bandit));
    // And the fight waits on a hero again.
    expect(after.encounter!.acting.every((id) => unit(after, id).side === "hero")).toBe(true);
  });

  it("works with the AI off, and leaves it off for everyone else", () => {
    const { state, wolf } = board();
    state.aiOff = true;
    const { events } = order(state, wolf, "wolf_bite", "ann");
    expect(used(events, wolf)).toEqual([expect.objectContaining({ target: "ann" })]);
    expect(events.filter((e) => e.t === "used" && e.id !== wolf && unit(state, e.id).side === "enemy")).toEqual([]);
  });

  it("uses an ability that is cooling down", () => {
    const { state, bandit } = board();
    state.aiOff = true;
    unit(state, bandit).cooldowns.cheap_shot = 3;
    expect(used(order(state, bandit, "cheap_shot", "ann").events, bandit)).toHaveLength(1);
  });

  it("starts the fight of an enemy in none", () => {
    const { state, bandit } = board(false);
    state.aiOff = true;
    expect(state.encounter).toBeNull();
    const { after, events } = order(state, bandit, "slash");
    expect(after.encounter).not.toBeNull();
    expect(used(events, bandit)).toHaveLength(1);
  });

  it("is refused for an ability it does not have, or a hero who is not standing", () => {
    const { state, wolf } = board();
    expect(stepZone(state, { type: "dev", by: "ann", dev: { op: "enemy_use", unit: wolf, ability: "slash" } }).ok).toBe(false);
    unit(state, "bob").down = true;
    expect(stepZone(state, { type: "dev", by: "ann", dev: { op: "enemy_use", unit: wolf, ability: "wolf_bite", target: "bob" } }).ok).toBe(false);
  });
});
