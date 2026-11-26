// Enemy abilities with an animation of their own: each one has to be reachable from a fight, not only from the
// figure lab, which plays them straight (see src/client/zone/ownMoves.ts).

import { describe, expect, it } from "vitest";
import { ABILITIES, ENEMIES, ENEMY_ABILITIES } from "@gantt-quest/world";
import { SIGNATURE_MOVES, moveName } from "../src/client/render/signatureMoves";
import { ownMove, ownRoute, playsFor } from "../src/client/zone/ownMoves";

/** Whether an enemy kind has the ability, or the retort (a slime's Acid Armor), called `name`. */
const hasMove = (e: (typeof ENEMIES)[string], name: string) => e.abilities.some((id) => ENEMY_ABILITIES[id]?.name === name) || e.retort?.name === name;

describe("an enemy's own moves in a fight", () => {
  it("are each named for an enemy ability or retort, so a fight finds them by the name its events carry", () => {
    const names = new Set([...Object.values(ENEMY_ABILITIES).map((a) => a.name), ...Object.values(ENEMIES).flatMap((e) => (e.retort ? [e.retort.name] : []))]);
    for (const key of Object.keys(SIGNATURE_MOVES)) expect(names, key).toContain(moveName(key));
  });

  it("are each used by the kind the lab shows them for", () => {
    for (const [key, move] of Object.entries(SIGNATURE_MOVES)) {
      const users = Object.values(ENEMIES).filter((e) => hasMove(e, moveName(key))).map((e) => e.kind);
      expect(users, key).toContain(move.who);
    }
  });

  it("go round their user, to a spot, or at one target, by the ability's shape", () => {
    for (const key of Object.keys(SIGNATURE_MOVES)) expect(ownRoute(moveName(key)), key).not.toBeNull();
    expect(ownRoute("Slam")).toBe("burst");
    expect(ownRoute("Immolate")).toBe("at");
    expect(ownRoute("Club Smash")).toBe("blow");
    expect(ownRoute("Lunge")).toBe("blow");
    expect(ownRoute("Fell Swoop")).toBe("dash");
    expect(ownRoute("Acid Splash")).toBe("at");
    // A retort bites back at whoever struck its bearer: at one target.
    expect(ownRoute("Acid Armor")).toBe("blow");
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

  it("are a kind's own where it has one for an ability of a name others share (`Name@kind`)", () => {
    expect(ownMove("Bite", { kind: "bat" })).toBe(SIGNATURE_MOVES["Bite@bat"]);
    expect(ownMove("Bite", { kind: "wolf|r2" })).toBe(SIGNATURE_MOVES.Bite);
    expect(ownMove("Bite", { kind: "turtle" })).toBeUndefined();
    expect(ownMove("Fell Swoop", { kind: "bat" })).toBe(SIGNATURE_MOVES["Fell Swoop"]);
  });

  it("each play for every kind that has the ability they are shown for in the lab", () => {
    for (const [key, move] of Object.entries(SIGNATURE_MOVES)) {
      const users = Object.values(ENEMIES).filter((e) => hasMove(e, moveName(key)));
      expect(users.filter((e) => ownMove(moveName(key), e) === move).length, key).toBeGreaterThan(0);
    }
  });
});
