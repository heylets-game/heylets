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

/** Passives for the test alone, for a class of its own, taken out again after each one. */
const added: string[] = [];
function addPassives(defs: TraitDef[]) {
  for (const d of defs) {
    TRAITS.push(d);
    TRAIT_BY_ID[d.id] = d;
    added.push(d.id);
  }
}
afterEach(() => {
  for (const id of added.splice(0)) {
    TRAITS.splice(TRAITS.findIndex((d) => d.id === id), 1);
    delete TRAIT_BY_ID[id];
  }
});

describe("passives", () => {
  it("gives a class with passives two to choose from at each pick, with a name and a word on what it does", () => {
    for (const c of HERO_CLASSES) {
      const own = TRAITS.filter((d) => d.classId === c.id);
      if (own.length === 0) continue;
      for (const tier of [1, 2] as const) expect(own.filter((d) => d.tier === tier), `${c.id} tier ${tier}`).toHaveLength(2);
      for (const d of own) expect(d.name && d.blurb, d.id).toBeTruthy();
    }
    expect(new Set(TRAITS.map((d) => d.id)).size).toBe(TRAITS.length);
  });

  it("opens picks at levels 3 and 6, one per tier, for keeps", () => {
    addPassives([
      { id: "p1a", classId: "test_class", tier: 1, name: "A", blurb: "" },
      { id: "p1b", classId: "test_class", tier: 1, name: "B", blurb: "" },
      { id: "p2a", classId: "test_class", tier: 2, name: "C", blurb: "" },
      { id: "m1a", classId: "other_class", tier: 1, name: "D", blurb: "" },
    ]);
    expect(TRAIT_LEVELS).toEqual([3, 6]);
    expect(pendingTraitTiers("test_class", 2, [])).toEqual([]);
    expect(pendingTraitTiers("test_class", 3, [])).toEqual([1]);
    expect(pendingTraitTiers("test_class", 6, [])).toEqual([1, 2]);
    expect(pendingTraitTiers("test_class", 6, ["p1a"])).toEqual([2]);
    // A tier the class has nothing for asks for nothing.
    expect(pendingTraitTiers("other_class", 6, [])).toEqual([1]);
    expect(pendingTraitTiers("no_class", 10, [])).toEqual([]);
    expect(traitPickError("test_class", 3, [], "p1a")).toBeNull();
    expect(traitPickError("test_class", 3, ["p1a"], "p1b")).toMatch(/already/);
    expect(traitPickError("test_class", 5, [], "p2a")).toMatch(/level 6/);
    expect(traitPickError("test_class", 9, [], "m1a")).toMatch(/class/);
    expect(traitPickError("test_class", 9, [], "nope")).toMatch(/class/);
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
