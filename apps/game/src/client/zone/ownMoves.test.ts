import { describe, expect, it } from "vitest";
import { ENEMIES, ENEMY_ABILITIES } from "@gantt-quest/world";
import { SIGNATURE_MOVES } from "../render/signatureMoves";
import { RETORTS, ownMove } from "./ownMoves";

// The enemies' own animations are keyed by ability id (so renaming an ability loses none), and found again from an event by
// its id, or by its name for one told without (a tab on an older build).

describe("signature moves", () => {
  it("are each keyed by an enemy ability's id, or a retort's name", () => {
    for (const key of Object.keys(SIGNATURE_MOVES)) expect(key in ENEMY_ABILITIES || RETORTS.has(key), key).toBe(true);
  });

  it("are found for every kind they were made for, by id and by name", () => {
    for (const [key, move] of Object.entries(SIGNATURE_MOVES)) {
      const def = ENEMY_ABILITIES[key];
      if (!def) continue;
      for (const kind of move.only ?? [move.who]) {
        if (!ENEMIES[kind]?.abilities.includes(key)) continue;
        expect(ownMove(def.name, { kind }, key), `${key} for ${kind} by id`).toBe(move);
        expect(ownMove(def.name, { kind }), `${key} for ${kind} by name`).toBe(move);
      }
    }
  });

  it("keep a bat's Bite apart from a wolf's", () => {
    expect(ownMove("Bite", { kind: "bat" })).toBe(SIGNATURE_MOVES.bat_bite);
    expect(ownMove("Bite", { kind: "wolf" })).toBe(SIGNATURE_MOVES.wolf_bite);
    expect(ownMove("Bite", { kind: "bat" }, "wolf_bite")).toBeUndefined();
  });

  it("are not played for a kind they were not made for", () => {
    expect(ownMove("Slam", { kind: "wolf" })).toBeUndefined();
  });
});
