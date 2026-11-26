// Enemy abilities with an animation of their own: each one has to be reachable from a fight, not only from the
// figure lab, which plays them straight (see src/client/zone/ownMoves.ts).

import { describe, expect, it } from "vitest";
import { ABILITIES, ENEMIES, ENEMY_ABILITIES } from "@gantt-quest/world";
import { SIGNATURE_MOVES } from "../src/client/render/signatureMoves";
import { ownRoute, playsFor } from "../src/client/zone/ownMoves";

describe("an enemy's own moves in a fight", () => {
  it("are each named for an enemy ability, so a fight finds them by the name its events carry", () => {
    const names = new Set(Object.values(ENEMY_ABILITIES).map((a) => a.name));
    for (const name of Object.keys(SIGNATURE_MOVES)) expect(names, name).toContain(name);
  });

  it("are each used by the kind the lab shows them for", () => {
    for (const [name, move] of Object.entries(SIGNATURE_MOVES)) {
      const users = Object.values(ENEMIES).filter((e) => e.abilities.some((id) => ENEMY_ABILITIES[id]?.name === name)).map((e) => e.kind);
      expect(users, name).toContain(move.who);
    }
  });

  it("go round their user, to a spot, or at one target, by the ability's shape", () => {
    for (const name of Object.keys(SIGNATURE_MOVES)) expect(ownRoute(name), name).not.toBeNull();
    expect(ownRoute("Slam")).toBe("burst");
    expect(ownRoute("Immolate")).toBe("at");
    expect(ownRoute("Club Smash")).toBe("blow");
    expect(ownRoute("Lunge")).toBe("blow");
    expect(ownRoute("No Such Thing")).toBeNull();
  });

  it("play only for the kinds they were made for, though others have abilities of the same name", () => {
    const { Bite, Maul, "Rending Swipe": swipe } = SIGNATURE_MOVES;
    // A rendered unit's kind is its sprite key.
    expect(playsFor(Bite, { kind: "wolf|r2" })).toBe(true);
    expect(playsFor(Bite, { kind: "bat" })).toBe(false);
    // A hero's sea turtle bites too.
    expect(Object.values(ABILITIES).some((a) => a.name === "Bite")).toBe(true);
    expect(playsFor(Bite, { kind: "turtle" })).toBe(false);
    expect(playsFor(Maul, { kind: "snow_bear" })).toBe(true);
    expect(playsFor(Maul, { kind: "brute" })).toBe(false);
    expect(playsFor(swipe, { kind: "snow_bear" })).toBe(true);
  });

  it("each play for every kind that has the ability they are shown for in the lab", () => {
    for (const [name, move] of Object.entries(SIGNATURE_MOVES)) {
      const users = Object.values(ENEMIES).filter((e) => e.abilities.some((id) => ENEMY_ABILITIES[id]?.name === name));
      expect(users.filter((e) => playsFor(move, e)).length, name).toBeGreaterThan(0);
    }
  });
});
