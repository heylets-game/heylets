// The enemy tables: bears, ogres and trolls as data, and how many of each
// kind a band brings for a party of a given size. How they fight on the
// tiles is in zone/zone.test.ts.

import { describe, expect, it } from "vitest";
import { ENEMIES, ENEMY_ABILITIES, LURKERS, TROLL_REGEN, bandKinds, type EnemyDef } from "./index";

/** What an enemy kind starts with, as ability definitions. */
const attacksOf = (def: EnemyDef) => def.abilities.map((id) => ENEMY_ABILITIES[id]);

describe("the bear", () => {
  it("is a slow, tough bruiser that hits harder than a wolf and tears rather than clubs", () => {
    const { bear, wolf, brute } = ENEMIES;
    expect(bear.boss).toBeFalsy();
    expect(bear.hp).toBeGreaterThan(brute.hp);
    expect(bear.hp).toBeGreaterThan(wolf.hp * 2);
    expect(bear.move).toBeLessThan(wolf.move);
    expect(bear.init).toBeLessThanOrEqual(brute.init);
    const hardest = Math.max(...attacksOf(bear).map((a) => a.damage));
    expect(hardest).toBeGreaterThan(Math.max(...attacksOf(wolf).map((a) => a.damage)));
    // Its heavy blow makes them bleed; only its roar stuns.
    const swipe = attacksOf(bear).find((a) => a.damage === hardest)!;
    expect(swipe.perfect?.effect).toBe("bleeding");
    expect(attacksOf(bear).some((a) => a.name === "Roar" && a.perfect?.effect === "stunned")).toBe(true);
  });

  it("has a boss of its own: bigger, and its roar shakes the whole party", () => {
    const big = ENEMIES.great_bear;
    expect(big.boss).toBe(true);
    expect(big.hp).toBeGreaterThan(ENEMIES.bear.hp);
    expect(big.move).toBeLessThan(ENEMIES.alpha.move);
    expect(attacksOf(big).some((a) => a.shape === "burst" && a.perfect?.effect === "stunned")).toBe(true);
  });

  it("roams alone, or as a pair for a full party", () => {
    expect(bandKinds("bear", 1)).toEqual(["bear"]);
    expect(bandKinds("bear", 3)).toEqual(["bear"]);
    expect(bandKinds("bear", 4)).toEqual(["bear", "bear"]);
    // The other bands are sized as they always were.
    expect(bandKinds("wolf", 2)).toEqual(["wolf", "wolf"]);
    expect(bandKinds("bandit", 4)).toEqual(["bandit", "archer", "bandit"]);
  });
});

describe("the ogre", () => {
  it("is the slowest, toughest rank-and-file there is, and its club hits hardest", () => {
    const { ogre, bear, brute } = ENEMIES;
    expect(ogre.boss).toBeFalsy();
    expect(ogre.hp).toBeGreaterThan(bear.hp);
    expect(ogre.init).toBeLessThan(bear.init);
    const rank = Object.values(ENEMIES).filter((e) => !e.boss && e.kind !== "dummy");
    expect(Math.max(...attacksOf(ogre).map((a) => a.damage))).toBe(Math.max(...rank.flatMap((e) => attacksOf(e).map((a) => a.damage))));
    expect(attacksOf(ogre).find((a) => a.name === "Club Smash")?.perfect?.effect).toBe("stunned");
    // Its stomp reaches the whole party, and leaves them slow.
    expect(attacksOf(ogre).some((a) => a.shape === "burst" && a.perfect?.effect === "slowed")).toBe(true);
    expect(ogre.xp).toBeGreaterThan(brute.xp);
  });

  it("roams alone, with its keeper for a full party", () => {
    expect(bandKinds("ogre", 1)).toEqual(["ogre"]);
    expect(bandKinds("ogre", 3)).toEqual(["ogre"]);
    expect(bandKinds("ogre", 4)).toEqual(["ogre", "bandit"]);
  });
});

describe("the troll", () => {
  it("regenerates, and fire stops it", () => {
    expect(ENEMIES.troll.regen).toEqual({ amount: TROLL_REGEN, unless: "burning", name: "Regenerate" });
  });

  it("keeps a cave chamber to itself", () => {
    expect(LURKERS).toContainEqual(["troll"]);
  });
});

describe("the training dummy", () => {
  it("is feeble: worth nothing, never a boss, and tougher than anything in the ranks", () => {
    const dummy = ENEMIES.dummy;
    expect(dummy.xp).toBe(0);
    expect(dummy.boss).toBeFalsy();
    const softest = Math.min(...Object.values(ENEMIES).filter((e) => e.kind !== "dummy").flatMap((e) => attacksOf(e).map((a) => a.damage)));
    for (const a of attacksOf(dummy)) expect(a.damage).toBeLessThan(softest);
    expect(dummy.hp).toBeGreaterThan(Math.max(...Object.values(ENEMIES).filter((e) => !e.boss && e.kind !== "dummy").map((e) => e.hp)));
  });
});
