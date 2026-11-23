// Lucky: coins tossed in the town well (well.ts) bring lucky rolls out onto the next map. Each roll to hit has
// advantage while there are any left, and spends one; the turns going by do not wear them away.

import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy, standHero, unit } from "../test/zoneBoard";
import { attackContext } from "./engine";
import { zoneHero } from "./zone";
import type { ZoneAction, ZoneState } from "./types";

const board = (): ZoneState => flatBoard({ rng: 4242, start: at(1, 1), options: { party: 1 }, flags: { aiOff: true } });
const luckOf = (state: ZoneState, id = "ann") => unit(state, id).conditions.find((c) => c.kind === "lucky")?.rounds ?? 0;
const sheet = { id: "ann", name: "Ann", classId: "qa_paladin", level: 1, base: { str: 9, int_stat: 4, vit: 9, agi: 4, dex: 4 }, bonus: {}, weapon: "mace", weaponPower: 1, armor: 2 };

describe("Lucky", () => {
  it("comes onto the map with a hero who tossed coins in the well, and adds to what they still had on coming back", () => {
    const first = must(board(), { type: "join", hero: zoneHero(sheet, {}, 2) });
    expect(luckOf(first)).toBe(2);
    const after = must(first, { type: "join", hero: zoneHero(sheet, {}, 1) });
    expect(luckOf(after)).toBe(3);
  });

  it("gives every roll to hit advantage, spends one each, and does not wear off with the turns", () => {
    let state = board();
    standHero(state, "ann", at(4, 4), { classId: "qa_paladin", level: 1, armor: 2, power: 1, abilities: ["bash"], items: {} });
    const foe = standEnemy(state, "bandit", at(5, 4), "g1", { hp: 500, maxHp: 500 });
    unit(state, "ann").conditions.push({ kind: "lucky", rounds: 2 });
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    for (let i = 0; i < 40 && state.encounter && state.encounter.acting[0] !== "ann"; i++) state = must(state, { type: "timeout" });
    expect(attackContext(state, unit(state, "ann"), unit(state, foe.id), { melee: true }).notes).toContain("Advantage: you are Lucky");
    // A turn goes by without a roll: the luck keeps.
    state = must(state, { type: "end_turn", by: "ann", unit: "ann" });
    for (let i = 0; i < 40 && state.encounter && state.encounter.acting[0] !== "ann"; i++) state = must(state, { type: "timeout" });
    expect(luckOf(state)).toBe(2);
    // Two blows, a lucky roll each, and it is gone.
    state = must(state, { type: "use", by: "ann", unit: "ann", ability: "bash", target: foe.id } as ZoneAction);
    expect(luckOf(state)).toBe(1);
    for (let i = 0; i < 40 && state.encounter && state.encounter.acting[0] !== "ann"; i++) state = must(state, { type: "end_turn", by: "ann", unit: "ann" });
    state = must(state, { type: "end_turn", by: "ann", unit: "ann" });
    for (let i = 0; i < 40 && state.encounter && state.encounter.acting[0] !== "ann"; i++) state = must(state, { type: "timeout" });
    state = must(state, { type: "use", by: "ann", unit: "ann", ability: "bash", target: foe.id } as ZoneAction);
    expect(luckOf(state)).toBe(0);
    expect(attackContext(state, unit(state, "ann"), unit(state, foe.id), { melee: true }).notes).not.toContain("Advantage: you are Lucky");
  });
});
