import { describe, expect, it } from "vitest";
import { CONDITION_INFO, conditionText } from "./kit";
import type { Condition } from "./types";

describe("conditionText", () => {
  it("says something for every condition", () => {
    for (const kind of Object.keys(CONDITION_INFO) as Condition[]) expect(conditionText({ kind, rounds: 2 }).length, kind).toBeGreaterThan(10);
  });

  it("tells the stacks a condition has on the unit", () => {
    expect(conditionText({ kind: "bleeding", rounds: 3, amount: 2 })).toMatch(/^Loses 4 HP .* 2 stacks\), for 3 more turns/);
    expect(conditionText({ kind: "burning", rounds: 2, amount: 2, stacks: [{ rounds: 1 }, { rounds: 2 }] })).toContain("in 2, 1 turns");
    expect(conditionText({ kind: "reeling", rounds: 1, amount: 3 })).toContain("3 AP less");
    expect(conditionText({ kind: "fumbling", rounds: 1, amount: 1 })).toMatch(/^Its next roll to hit is made with disadvantage/);
    expect(conditionText({ kind: "fumbling", rounds: 3, amount: 3 })).toMatch(/^Each of its next 3 rolls to hit/);
  });

  it("names whoever laid it, where it can", () => {
    expect(conditionText({ kind: "taunted", rounds: 2, by: "u1" }, () => "Ann")).toContain("no one but Ann");
    expect(conditionText({ kind: "taunted", rounds: 2, by: "u1" })).toContain("the one who taunted it");
  });
});
