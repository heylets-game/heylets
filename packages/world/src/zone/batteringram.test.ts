import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMIES } from "../content";
import type { Ctx } from "./engine";
import type { ZoneEvent } from "./types";

// A brute's Battering Ram: a charge that drives its target three hexes back.

const ram = enemyStrikes("brute", 1).find((s) => s.name === "Battering Ram")!;

function charge(seed: number) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  Object.assign(standHero(state, "ann", at(5, 6), { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 });
  const brute = enemy(state, "brute", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  const was = { ...unit(ctx.state, "ann").pos };
  enemyAct(ctx, unit(ctx.state, brute), ram, unit(ctx.state, "ann"));
  return { events, was, now: unit(ctx.state, "ann").pos };
}

describe("a brute's Battering Ram", () => {
  it("costs 2 AP, waits 2 turns, and is the brute.s only push", () => {
    expect(ram).toMatchObject({ cost: 2, cooldown: 2 });
    expect(ENEMIES.brute.abilities).toEqual(["beatdown", "battering_ram", "great_cleave"]);
  });

  it("drives the target three hexes back on a hit", () => {
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { events, was, now } = charge(seed);
      const hit = events.some((e) => e.t === "hit" && e.target === "ann");
      const shoves = events.filter((e) => e.t === "shoved" && e.target === "ann").length;
      if (!hit) {
        expect(now, `seed ${seed}`).toEqual(was);
        continue;
      }
      landed++;
      expect(shoves, `seed ${seed}`).toBe(3);
      expect(now, `seed ${seed}`).not.toEqual(was);
    }
    expect(landed).toBeGreaterThan(0);
  });
});
