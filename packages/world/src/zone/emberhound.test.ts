import { describe, expect, it } from "vitest";
import { at, flatBoard, has, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import type { HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { enemyStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// An Ember Hound: a bite that sets you Burning, and a pulse of fire all round it that you either dodge or take whole.

const strike = (name: string) => enemyStrikes("ember_hound", 1).find((s) => s.name === name)!;
const searingBite = strike("Searing Bite");
const emberBurst = strike("Ember Burst");

/** An Ember Hound at `houndAt` and a hardy hero at each of `heroes` (ann, bo, cy), in a fight with the AI off. */
function setUp(houndAt: HexPos, heroes: HexPos[]) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: heroes.length }, flags: { shareTurns: true } });
  state.aiOff = true;
  const ids = ["ann", "bo", "cy"].slice(0, heroes.length);
  ids.forEach((id, i) => Object.assign(standHero(state, id, heroes[i], { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 }));
  const hound = enemy(state, "ember_hound", houndAt).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  for (const id of ids) if (!state.encounter!.order.includes(id)) state.encounter!.order.push(id);
  return { state, hound };
}

const ctxOf = (state: ZoneState, seed: number): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });
const hits = (ctx: Ctx, id: string) => ctx.events.filter((e) => e.t === "hit" && e.target === id);
const stacks = (state: ZoneState, id: string) => unit(state, id).conditions.find((c) => c.kind === "burning")?.stacks?.length ?? 0;

describe("an Ember Hound's kit", () => {
  it("is Searing Bite, then Ember Burst: a burst for 7, a stack of Burning on a failed save, every 3 turns", () => {
    expect(ENEMIES.ember_hound.abilities).toEqual(["searing_bite", "ember_burst"]);
    expect(searingBite).toMatchObject({ range: 1, saveOr: { effect: "burning" } });
    expect(emberBurst).toMatchObject({ burst: true, range: 2, cooldown: 3, saveOr: { effect: "burning" } });
    expect(emberBurst.kit.dodge).toBe(true);
    expect(ENEMY_ABILITIES.ember_burst.damage).toBe(7);
  });
});

describe("an Ember Hound's Ember Burst", () => {
  it("catches everyone within 2: all of it and a stack of Burning on a fail, none of it on a save, and nobody further off", () => {
    const { state, hound } = setUp(at(5, 6), [at(6, 6), at(7, 6), at(9, 6)]);
    let failed = 0;
    let dodged = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, hound), emberBurst, null);
      for (const id of ["ann", "bo"]) {
        const hit = hits(ctx, id);
        if (hit.length === 0) {
          expect(has(ctx.state, id, "burning"), `seed ${seed} ${id}`).toBe(false);
          dodged++;
        } else {
          expect(hit, `seed ${seed} ${id}`).toHaveLength(1);
          expect(hit[0].t === "hit" && hit[0].dice?.halved, `seed ${seed} ${id}`).toBeFalsy();
          expect(stacks(ctx.state, id), `seed ${seed} ${id}`).toBe(1);
          failed++;
        }
      }
      expect(hits(ctx, "cy")).toHaveLength(0);
      expect(has(ctx.state, "cy", "burning")).toBe(false);
    }
    expect(failed).toBeGreaterThan(0);
    expect(dodged).toBeGreaterThan(0);
  });
});
