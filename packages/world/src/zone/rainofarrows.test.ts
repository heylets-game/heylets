import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyTurn } from "./ai";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import type { Ctx } from "./engine";
import type { ZoneEvent } from "./types";

// An archer's Rain of Arrows: thrown at a hex, it comes down on it and the ring round it. It is aimed wherever catches
// the most, a hex nobody stands on as readily as a hero's.

const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function turn(seed: number) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
  state.aiOff = true;
  // Two apart: no hex of either one's ring has the other on it, but the hex between them has both beside it.
  for (const [id, pos] of [["ann", at(5, 6)], ["bob", at(7, 6)]] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const archer = enemy(state, "archer", at(6, 1), "g1", { abilities: ["rain_of_arrows"] }).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  ctx.state.aiOff = false;
  enemyTurn(ctx, unit(ctx.state, archer), { ap: 4, move: 0, stride: 0, disengaged: false, walk: 2 });
  return events;
}

describe("an archer's Rain of Arrows", () => {
  it("does 5 to a hex and the ring round it, for 4 AP, every 4th turn, and is the archer's favourite", () => {
    expect(ENEMY_ABILITIES.rain_of_arrows).toMatchObject({ damage: 5, area: 7, cost: 4, cooldown: 3, weight: 3 });
    expect(ENEMY_ABILITIES.volley.weight).toBe(1);
    expect(ENEMIES.archer.abilities).toEqual(["volley", "rain_of_arrows"]);
  });

  it("comes down between two heroes to catch both, though neither stands where it is aimed", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const events = turn(seed);
      expect(events, `seed ${seed}`).toContainEqual(expect.objectContaining({ t: "used", name: "Rain of Arrows", at: at(6, 6) }));
      for (const id of ["ann", "bob"]) expect(events.some((e) => e.t === "hit" && e.target === id), `seed ${seed}: ${id}`).toBe(true);
    }
  });
});
