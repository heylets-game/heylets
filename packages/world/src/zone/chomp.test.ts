import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { enemyStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent } from "./types";

// A troll's Chomp: a bite that grows back half of what it tears off.

const chomp = enemyStrikes("troll", 1).find((s) => s.name === "Chomp")!;

function bite(seed: number, trollHp: number, burning = false) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  Object.assign(standHero(state, "ann", at(5, 6), { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 });
  const troll = enemy(state, "troll", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  unit(state, troll).hp = trollHp;
  if (burning) unit(state, troll).conditions.push({ kind: "burning", rounds: 2, amount: 1 });
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, troll), chomp, unit(ctx.state, "ann"));
  return { troll, events, after: ctx.state };
}

describe("a troll's Chomp", () => {
  it("heals the troll for half the damage it deals, rounded to nearest and never less than 1", () => {
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { troll, events, after } = bite(seed, 5);
      const hit = events.find((e): e is Extract<ZoneEvent, { t: "hit" }> => e.t === "hit" && e.target === "ann");
      const healed = events.find((e): e is Extract<ZoneEvent, { t: "heal" }> => e.t === "heal" && e.target === troll);
      if (!hit) {
        expect(healed, `seed ${seed}`).toBeUndefined();
        expect(unit(after, troll).hp).toBe(5);
        continue;
      }
      landed++;
      expect(healed, `seed ${seed}`).toMatchObject({ actor: troll, what: "Chomp", amount: Math.max(1, Math.round(hit.amount / 2)) });
      expect(unit(after, troll).hp).toBe(5 + Math.max(1, Math.round(hit.amount / 2)));
    }
    expect(landed).toBeGreaterThan(0);
  });

  it("heals nothing while the troll is Burning", () => {
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { troll, events, after } = bite(seed, 5, true);
      if (events.some((e) => e.t === "hit" && e.target === "ann")) landed++;
      expect(events.some((e) => e.t === "heal" && e.target === troll), `seed ${seed}`).toBe(false);
      expect(unit(after, troll).hp).toBe(5);
    }
    expect(landed).toBeGreaterThan(0);
  });

  it("heals no more than the troll has lost", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { troll, after } = bite(seed, 28);
      expect(unit(after, troll).hp).toBeLessThanOrEqual(unit(after, troll).maxHp);
    }
  });
});
