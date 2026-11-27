import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct, sweepHexes } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMY_ABILITIES } from "./enemyabilities";
import type { Ctx } from "./engine";
import type { ZoneEvent } from "./types";

// A brute's Great Cleave: one swing through two arcs of three hexes, the one beside it and the one beyond, that
// everyone in them saves against for half.

const cleave = enemyStrikes("brute", 1).find((s) => s.name === "Great Cleave")!;
const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function swing(seed: number) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 3 }, flags: { shareTurns: true } });
  state.aiOff = true;
  for (const [id, pos] of [["ann", at(5, 6)], ["bob", at(4, 6)], ["cal", at(3, 6)]] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const brute = enemy(state, "brute", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, brute), cleave, unit(ctx.state, "ann"));
  return { events, state: ctx.state, brute };
}

describe("a brute's Great Cleave", () => {
  it("does 9, waits 4 turns, and weighs twice what Beatdown does", () => {
    expect(ENEMY_ABILITIES.great_cleave).toMatchObject({ damage: 9, cooldown: 4, weight: 2, spread: { shape: "sweep", rows: 2 } });
    expect(ENEMY_ABILITIES.beatdown.weight).toBe(1);
  });

  it("sweeps six hexes: three beside it, three just beyond", () => {
    const { state, brute } = swing(1);
    const from = unit(state, brute).pos;
    const hexes = sweepHexes(state, from, at(5, 6), 2);
    expect(hexes).toHaveLength(6);
    expect(hexes.filter((p) => hexDistance(p, from) === 1)).toHaveLength(3);
    expect(hexes.filter((p) => hexDistance(p, from) === 2)).toHaveLength(3);
  });

  it("has every hero in its two rows save for half, and no one further", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { events } = swing(seed);
      expect(events.some((e) => e.t === "miss"), `seed ${seed}`).toBe(false);
      const tried = (id: string) => events.some((e) => e.t === "hit" && e.target === id);
      expect(tried("ann"), `seed ${seed}`).toBe(true);
      expect(tried("bob"), `seed ${seed}`).toBe(true);
      expect(tried("cal"), `seed ${seed}`).toBe(false);
    }
  });
});
