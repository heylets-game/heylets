// Passives (traits, picked at levels 3 and 6) and the signature weapons' abilities.

import { afterEach, describe, expect, it } from "vitest";
import {
  ABILITIES,
  HERO_CLASSES,
  TRAITS,
  TRAIT_BY_ID,
  TRAIT_LEVELS,
  WEAPONS,
  makeRng,
  parseTraits,
  pendingTraitTiers,
  rollItem,
  traitPickError,
  type TraitDef,
} from "./index";

/** Passives for the test alone, taken out again after each one. */
function addPassives(defs: TraitDef[]) {
  for (const d of defs) {
    TRAITS.push(d);
    TRAIT_BY_ID[d.id] = d;
  }
}
afterEach(() => {
  for (const d of TRAITS.splice(0)) delete TRAIT_BY_ID[d.id];
});

describe("passives", () => {
  it("has none written yet, so no level asks for a pick", () => {
    expect(TRAITS).toEqual([]);
    for (const c of HERO_CLASSES) expect(pendingTraitTiers(c.id, 10, [])).toEqual([]);
  });

  it("opens picks at levels 3 and 6, one per tier, for keeps, once a class has some", () => {
    addPassives([
      { id: "p1a", classId: "qa_paladin", tier: 1, name: "A", blurb: "" },
      { id: "p1b", classId: "qa_paladin", tier: 1, name: "B", blurb: "" },
      { id: "p2a", classId: "qa_paladin", tier: 2, name: "C", blurb: "" },
      { id: "m1a", classId: "devops_mage", tier: 1, name: "D", blurb: "" },
    ]);
    expect(TRAIT_LEVELS).toEqual([3, 6]);
    expect(pendingTraitTiers("qa_paladin", 2, [])).toEqual([]);
    expect(pendingTraitTiers("qa_paladin", 3, [])).toEqual([1]);
    expect(pendingTraitTiers("qa_paladin", 6, [])).toEqual([1, 2]);
    expect(pendingTraitTiers("qa_paladin", 6, ["p1a"])).toEqual([2]);
    // A tier the class has nothing for asks for nothing.
    expect(pendingTraitTiers("devops_mage", 6, [])).toEqual([1]);
    expect(traitPickError("qa_paladin", 3, [], "p1a")).toBeNull();
    expect(traitPickError("qa_paladin", 3, ["p1a"], "p1b")).toMatch(/already/);
    expect(traitPickError("qa_paladin", 5, [], "p2a")).toMatch(/level 6/);
    expect(traitPickError("qa_paladin", 9, [], "m1a")).toMatch(/class/);
    expect(traitPickError("qa_paladin", 9, [], "nope")).toMatch(/class/);
    expect(parseTraits('["p1a","nope",3]')).toEqual(["p1a"]);
    expect(parseTraits("not json")).toEqual([]);
    expect(parseTraits(null)).toEqual([]);
  });
});

describe("signature abilities", () => {
  it("every class has a signature weapon of its own, with its own ability first", () => {
    for (const c of HERO_CLASSES) {
      const w = WEAPONS[c.signature];
      expect(w?.classId).toBe(c.id);
      expect(ABILITIES[w.abilities[0]]).toBeTruthy();
      expect(WEAPONS[w.looksLike!]).toBeTruthy();
    }
  });

  it("drops only from good loot", () => {
    const sig = new Set(HERO_CLASSES.map((c) => c.signature));
    let low = 0;
    let high = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (sig.has(rollItem(makeRng(seed), "qa_paladin", 0.2, 3, "main_hand").ref)) low += 1;
      if (sig.has(rollItem(makeRng(seed), "qa_paladin", 0.6, 3, "main_hand").ref)) high += 1;
    }
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(50);
  });

});
