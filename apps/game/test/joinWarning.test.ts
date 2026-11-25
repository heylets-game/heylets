// What a player is asked before walking onto a map under way (client/joinWarning.ts).

import { describe, expect, it } from "vitest";
import { JOIN_WARNING, joinQuestion } from "../src/client/joinWarning";

describe("walking onto a map under way", () => {
  it("asks nothing with nobody there, and warns of bigger bands with others there", () => {
    expect(joinQuestion({})).toBeNull();
    expect(joinQuestion({ others: true })).toBe(JOIN_WARNING);
  });

  it("says how many of the party stay behind when not all of it fits, and that a full map takes nobody", () => {
    expect(joinQuestion({ others: true, room: 2, bringing: 3 })).toMatch(/room for 2 more heroes, and your party is 3: the last of them stays behind/);
    expect(joinQuestion({ others: true, room: 1, bringing: 4 })).toMatch(/the last 3 of them stay behind/);
    expect(joinQuestion({ others: true, room: 0, bringing: 2 })).toBe("This map is full: nobody else can join it.");
  });
});
