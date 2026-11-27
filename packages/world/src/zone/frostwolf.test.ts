import { describe, expect, it } from "vitest";
import { at, flatBoard, has, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { posKey, type HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { coneHexes, enemyAct } from "./combat";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { enemyStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Frost Wolf: a bite that slows, and a breath of cold over a cone in front of it.

const strike = (name: string) => enemyStrikes("frost_wolf", 1).find((s) => s.name === name)!;
const rimeBite = strike("Rime Bite");
const frostBreath = strike("Frost Breath");

/** A Frost Wolf at `wolfAt` and a hardy hero at each of `heroes` (ann, bo, cy), in a fight with the AI off. */
function setUp(wolfAt: HexPos, heroes: HexPos[]) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: heroes.length }, flags: { shareTurns: true } });
  state.aiOff = true;
  const ids = ["ann", "bo", "cy"].slice(0, heroes.length);
  ids.forEach((id, i) => Object.assign(standHero(state, id, heroes[i], { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 }));
  const wolf = enemy(state, "frost_wolf", wolfAt).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  for (const id of ids) if (!state.encounter!.order.includes(id)) state.encounter!.order.push(id);
  return { state, wolf };
}

const ctxOf = (state: ZoneState, seed: number): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });
const hits = (ctx: Ctx, id: string) => ctx.events.filter((e) => e.t === "hit" && e.target === id);

describe("a Frost Wolf's kit", () => {
  it("is Rime Bite, then Frost Breath: a 3-row cone for 7, Slowed on a failed save, every 3 turns", () => {
    expect(ENEMIES.frost_wolf.abilities).toEqual(["rime_bite", "frost_breath"]);
    expect(rimeBite).toMatchObject({ range: 1 });
    expect(frostBreath).toMatchObject({ cooldown: 3, saveOr: { effect: "slowed", turns: 2 } });
    expect(frostBreath.kit.cone).toBe(3);
    expect(ENEMY_ABILITIES.frost_breath.damage).toBe(7);
  });
});

describe("a Frost Wolf's Frost Breath", () => {
  it("catches everyone in its cone, for half and no Slowing on a save, and nobody outside it", () => {
    const wolfAt = at(5, 6);
    const aim = at(8, 6);
    const { state, wolf } = setUp(wolfAt, [at(6, 6), at(8, 6), at(5, 9)]);
    const cone = coneHexes(state, wolfAt, aim, 3).map(posKey);
    expect(cone).toContain(posKey(at(6, 6)));
    expect(cone).toContain(posKey(at(8, 6)));
    expect(cone).not.toContain(posKey(at(5, 9)));
    let slowed = 0;
    let halved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, wolf), frostBreath, null, aim);
      for (const id of ["ann", "bo"]) {
        const hit = hits(ctx, id);
        expect(hit, `seed ${seed} ${id}`).toHaveLength(1);
        const saved = hit[0].t === "hit" && !!hit[0].dice?.halved;
        expect(has(ctx.state, id, "slowed"), `seed ${seed} ${id}`).toBe(!saved);
        if (saved) halved++;
        else slowed++;
      }
      expect(hits(ctx, "cy")).toHaveLength(0);
    }
    expect(slowed).toBeGreaterThan(0);
    expect(halved).toBeGreaterThan(0);
  });
});
