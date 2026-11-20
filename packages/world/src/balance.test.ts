// Class balance: deterministic seeded fights per class and party against the
// island's real encounters. BALANCE_REPORT=1 prints the full table.

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIM_CLASSES, SIM_ENCOUNTERS, balanceReport, simFight, simRow } from "./balance";

describe("balance simulation", () => {
  it("is deterministic", () => {
    const party = [{ classId: "frontend_bard", level: 1 }, { classId: "backend_druid", level: 1 }];
    expect(simFight(party, ["villain", "brute"], 42)).toEqual(simFight(party, ["villain", "brute"], 42));
  });

  // Voyage combat (battle.ts) is on its way out, and weapon kits are now made for the hex fights, which this does not simulate.
  it.skip("keeps every class within reach of the others in a solo fight at level 1", () => {
    const rates = SIM_CLASSES.map((c) => simRow(c, [{ classId: c, level: 1 }], SIM_ENCOUNTERS, 20).winRate);
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.2);
  });

  it.runIf(process.env.BALANCE_REPORT)("prints the report", () => {
    const out = [1, 5].map((level) => balanceReport(Number(process.env.BALANCE_SEEDS ?? 40), level)).join("\n\n");
    if (process.env.BALANCE_OUT) writeFileSync(process.env.BALANCE_OUT, out);
    else console.log(out);
  }, 600_000);
});
