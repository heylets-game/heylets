import { describe, expect, it } from "vitest";
import { swingsOf } from "./rules";
import type { Roll, RollMod } from "./types";

/** A roll as d20() would make it, from the die kept and its parts. */
const roll = (o: { kind?: Roll["kind"]; d20: number[]; adv?: -1 | 0 | 1; own?: number; mods?: RollMod[]; vs: number; vsMods?: RollMod[]; advWhy?: string[] }): Roll => {
  const kind = o.kind ?? "attack";
  const adv = o.adv ?? 0;
  const kept = adv === 1 ? Math.max(...o.d20) : adv === -1 ? Math.min(...o.d20) : o.d20[0];
  const bonus = (o.own ?? 0) + (o.mods ?? []).reduce((n, m) => n + m.n, 0);
  const total = kept + bonus;
  const crit = kind === "attack" && kept === 20;
  const ok = crit || (!(kind === "attack" && kept === 1) && total >= o.vs);
  return { kind, id: "a", label: "Test", d20: o.d20, kept, bonus, total, vs: o.vs, adv, ok, crit, mods: o.mods, vsMods: o.vsMods, advWhy: o.advWhy };
};
const HIGH = { name: "High ground", n: 2 };
const BEACON = { name: "Beacon", n: 1 };

describe("what made the difference to a roll", () => {
  it("names each bonus the roll needed: 10 + 2 + 1 against 13 needed both", () => {
    expect(swingsOf(roll({ d20: [10], mods: [HIGH, BEACON], vs: 13 }))).toEqual([{ names: ["High ground", "Beacon"], helped: true }]);
  });

  it("names only the one that turned it: against 12 the +2 did, the +1 did not", () => {
    expect(swingsOf(roll({ d20: [10], mods: [HIGH, BEACON], vs: 12 }))).toEqual([{ names: ["High ground"], helped: true }]);
  });

  it("names them together when neither alone turned it but both did: 10 + 2 + 1 against 11", () => {
    expect(swingsOf(roll({ d20: [10], mods: [HIGH, BEACON], vs: 11 }))).toEqual([{ names: ["High ground", "Beacon"], helped: true, between: true }]);
  });

  it("names nothing when the roll was made without them", () => {
    expect(swingsOf(roll({ d20: [10], mods: [HIGH, BEACON], vs: 10 }))).toEqual([]);
  });

  it("on a miss, names the penalty that cost it, not the bonus", () => {
    expect(swingsOf(roll({ d20: [11], mods: [BEACON, { name: "Trees", n: -2 }], vs: 12 }))).toEqual([{ names: ["Trees"], helped: false }]);
  });

  it("counts what moved the number to reach: Coral Armor turns a blow, Sundered lets one through", () => {
    expect(swingsOf(roll({ d20: [12], own: 3, vs: 16, vsMods: [{ name: "Coral Armor", n: 2 }] }))).toEqual([{ names: ["Coral Armor"], helped: false }]);
    expect(swingsOf(roll({ d20: [12], own: 3, vs: 14, vsMods: [{ name: "Sundered", n: -2 }] }))).toEqual([{ names: ["Sundered"], helped: true }]);
  });

  it("works for saves: Weakened fails one", () => {
    expect(swingsOf(roll({ kind: "save", d20: [12], own: 2, mods: [{ name: "Weakened", n: -2 }], vs: 14 }))).toEqual([{ names: ["Weakened"], helped: false }]);
  });

  it("names advantage when the die it dropped would have missed, and disadvantage when it would have hit", () => {
    expect(swingsOf(roll({ d20: [15, 4], adv: 1, own: 3, vs: 14, advWhy: ["Exposed"] }))).toEqual([{ names: ["Exposed"], helped: true, adv: true }]);
    expect(swingsOf(roll({ d20: [15, 4], adv: -1, own: 3, vs: 14, advWhy: ["Poisoned"] }))).toEqual([{ names: ["Poisoned"], helped: false, adv: true }]);
    expect(swingsOf(roll({ d20: [15, 14], adv: 1, own: 3, vs: 14 }))).toEqual([]);
  });

  it("names advantage that made a critical hit, though the other die would have hit too", () => {
    expect(swingsOf(roll({ d20: [20, 15], adv: 1, own: 3, vs: 14, advWhy: ["Exposed"] }))).toEqual([{ names: ["Exposed"], helped: true, adv: true, crit: true }]);
    // The other die would have missed: it made the hit, and the critical with it.
    expect(swingsOf(roll({ d20: [20, 4], adv: 1, own: 3, vs: 14, advWhy: ["Exposed"] }))).toEqual([{ names: ["Exposed"], helped: true, adv: true, crit: true }]);
  });

  it("names disadvantage that dropped a 20, even on a blow that landed, beside the bonus that landed it", () => {
    expect(swingsOf(roll({ d20: [20, 11], adv: -1, own: 1, mods: [HIGH], vs: 14, advWhy: ["Poisoned"] }))).toEqual([
      { names: ["High ground"], helped: true },
      { names: ["Poisoned"], helped: false, adv: true, crit: true },
    ]);
  });

  it("names no critical on a save, where a 20 is only a number", () => {
    expect(swingsOf(roll({ kind: "save", d20: [20, 15], adv: 1, own: 0, vs: 12 }))).toEqual([]);
  });

  it("can name a bonus and advantage both", () => {
    expect(swingsOf(roll({ d20: [12, 3], adv: 1, own: 1, mods: [HIGH], vs: 15, advWhy: ["Inspired"] }))).toEqual([
      { names: ["High ground"], helped: true },
      { names: ["Inspired"], helped: true, adv: true },
    ]);
  });

  it("names no bonus on a natural 20 or 1 to hit: those land or miss whatever is added", () => {
    expect(swingsOf(roll({ d20: [20], mods: [HIGH], vs: 25 }))).toEqual([]);
    expect(swingsOf(roll({ d20: [1], mods: [{ name: "Trees", n: -2 }], vs: 2 }))).toEqual([]);
  });

  it("names nothing for a roll whose outcome was set apart from its sum, nor for initiative", () => {
    expect(swingsOf({ ...roll({ d20: [14], mods: [HIGH], vs: 16 }), ok: false })).toEqual([]);
    expect(swingsOf(roll({ kind: "initiative", d20: [14], mods: [HIGH], vs: 0 }))).toEqual([]);
  });
});
