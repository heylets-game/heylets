import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { ABILITIES } from "../content";
import { makeRng } from "../rng";
import { resolveAbility } from "./combat";
import type { Ctx } from "./engine";
import { TACTICS } from "./kit";
import type { ZoneEvent } from "./types";

// A wave or blast that does more to one who is Wet (Tactic `vsWet`) shows it with that one's dice, as a part of the
// moment, and the dice add up to what they took.

describe("a wave that does more to the Wet", () => {
  it("shows a Wet victim's extra as a part of their dice, and does the same damage as before", () => {
    // No ability in the book sweeps with `vsWet` just now, so this one is made up for the test.
    ABILITIES.test_wave = { ...ABILITIES.tidal_wave, id: "test_wave" };
    TACTICS.test_wave = { ...TACTICS.tidal_wave, vsWet: 3 };
    try {
      let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
      state.aiOff = true;
      Object.assign(standHero(state, "ann", at(4, 6), { classId: "qa_paladin", level: 3, armor: 0, power: 1, abilities: ["test_wave"], items: {} }), { hp: 900, maxHp: 900 });
      const dry = enemy(state, "bandit", at(5, 6), "g1", { hp: 900, maxHp: 900 }).id;
      const wet = enemy(state, "bandit", at(6, 6), "g1", { hp: 900, maxHp: 900 }).id;
      unit(state, wet).conditions.push({ kind: "wet", rounds: 3 });
      state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
      for (let seed = 1; seed <= 8; seed++) {
        const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] };
        resolveAbility(ctx, unit(ctx.state, "ann"), "test_wave", { at: at(6, 6) });
        const hits = ctx.events.filter((e): e is Extract<ZoneEvent, { t: "hit" }> => e.t === "hit");
        const drySide = hits.find((e) => e.target === dry);
        const wetSide = hits.find((e) => e.target === wet);
        expect(wetSide?.dice?.mods).toEqual([{ name: "Wet", n: 3 }]);
        expect(wetSide?.dice?.total).toBe((drySide?.dice?.total ?? 0) + 3);
        expect(drySide?.dice?.mods?.some((m) => m.name === "Wet")).toBeFalsy();
        // Unsaved, each took the whole of what their dice say.
        if (!wetSide?.dice?.halved) expect(wetSide?.amount).toBe(wetSide?.dice?.total);
      }
    } finally {
      delete ABILITIES.test_wave;
      delete TACTICS.test_wave;
    }
  });
});
