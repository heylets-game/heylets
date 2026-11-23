import { describe, expect, it } from "vitest";
import { LUCK_MAX, WELL_GEM_CHANCE, WELL_SKINS, WELL_XP_CHANCE, WISHES_PER_DAY, WISH_COST, skinProblem, wishGift, wishProblem } from "./well";
import { makeRng } from "./rng";

describe("the town well", () => {
  it("fills water skins up to a few", () => {
    expect(skinProblem(0)).toBeNull();
    expect(skinProblem(WELL_SKINS - 1)).toBeNull();
    expect(skinProblem(WELL_SKINS)).toMatch(/apothecary/);
  });

  it("takes a few coins a day, while there is room for the luck, from whoever has the gold", () => {
    const ok = { gold: WISH_COST, tossed: 0, luck: 0 };
    expect(wishProblem(ok)).toBeNull();
    expect(wishProblem({ ...ok, tossed: WISHES_PER_DAY })).toMatch(/tomorrow/);
    expect(wishProblem({ ...ok, luck: LUCK_MAX })).toMatch(/all the luck/);
    expect(wishProblem({ ...ok, gold: WISH_COST - 1 })).toMatch(/gold/);
  });

  it("gives something back now and then: XP more often, a gem rarely", () => {
    const n = 20000;
    const got = { gem: 0, xp: 0, none: 0 };
    for (let i = 0; i < n; i++) got[wishGift(makeRng(i * 7919 + 1)) ?? "none"]++;
    expect(got.gem / n).toBeCloseTo(WELL_GEM_CHANCE, 1);
    expect(got.xp / n).toBeCloseTo(WELL_XP_CHANCE, 1);
    expect(got.none).toBeGreaterThan(got.xp);
  });
});
