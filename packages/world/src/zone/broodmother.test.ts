import { describe, expect, it } from "vitest";
import { hexDistance, posKey } from "@gantt-quest/core";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { placeSurface, standInSurface } from "./surfaces";
import { blast } from "./geometry";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Broodmother: an Impaling Fang that dents armour, Spin Web thrown over a wide patch of ground (web slows anyone but
// a spider, and quickens a spider), and Brood Swarm, calling two Spiderlings to its side.

const strike = (name: string) => enemyStrikes("broodmother", 1).find((s) => s.name === name)!;
const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function board(spider = true) {
  let state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 2 }, flags: { shareTurns: true } });
  state.aiOff = true;
  for (const [id, pos] of [["ann", at(3, 6)], ["bob", at(9, 9)]] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const mother = enemy(state, "broodmother", at(6, 6)).id;
  const spiderId = spider ? enemy(state, "spider", at(7, 7)).id : "";
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, mother, spider: spiderId };
}

const ctxOf = (state: ZoneState, seed = 1): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });
const has = (state: ZoneState, id: string, kind: string) => unit(state, id).conditions.some((c) => c.kind === kind);

describe("a Broodmother", () => {
  it("carries Impaling Fang, Spin Web and Brood Swarm", () => {
    expect(ENEMIES.broodmother.abilities).toEqual(["impaling_fang", "spin_web", "brood_swarm"]);
    expect(ENEMY_ABILITIES.impaling_fang.saveOr).toEqual({ effect: "sundered", turns: 2 });
    expect(strike("Spin Web")).toMatchObject({ range: 3, cooldown: 4, harmless: true, kit: { blast: 2, surface: { kind: "web" } } });
    expect(strike("Brood Swarm")).toMatchObject({ cost: 1, cooldown: 2, behaviour: "summon", kit: { summon: { kind: "spiderling", count: 2 } } });
  });

  it("spins web over every hex within two of where it aims, hurting nobody, and slowing whoever is caught", () => {
    const { state, mother } = board();
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, mother), strike("Spin Web"), unit(ctx.state, "ann"), at(3, 6));
    for (const p of blast(ctx.state.map, at(3, 6), 2)) expect(ctx.state.surfaces[posKey(p)]?.kind, posKey(p)).toBe("web");
    expect(ctx.events.some((e) => e.t === "hit")).toBe(false);
    expect(has(ctx.state, "ann", "slowed")).toBe(true);
  });

  it("web slows a hero starting a turn in it, and hastes a spider", () => {
    const { state, spider } = board();
    const ctx = ctxOf(state);
    placeSurface(ctx, [at(3, 6), at(7, 7)], "web", 4, null);
    standInSurface(ctx, unit(ctx.state, "ann"));
    standInSurface(ctx, unit(ctx.state, spider));
    expect(has(ctx.state, "ann", "slowed")).toBe(true);
    expect(has(ctx.state, spider, "hasted")).toBe(true);
    expect(has(ctx.state, spider, "slowed")).toBe(false);
  });

  it("web gives way to fire and water, but not to slime", () => {
    const { state } = board();
    const ctx = ctxOf(state);
    const [a, b, c] = [at(2, 2), at(3, 2), at(4, 2)];
    placeSurface(ctx, [a, b, c], "web", 4, null);
    placeSurface(ctx, [a], "fire", 2, null);
    placeSurface(ctx, [b], "water", 2, null);
    placeSurface(ctx, [c], "slime", 2, null);
    expect([a, b, c].map((p) => ctx.state.surfaces[posKey(p)]?.kind)).toEqual(["fire", "water", "web"]);
  });

  it("calls two Spiderlings to stand beside it, in the fight just behind it, worth no XP", () => {
    const { state, mother } = board();
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, mother), strike("Brood Swarm"), null);
    const brood = ctx.state.units.filter((u) => u.kind === "spiderling");
    expect(brood).toHaveLength(2);
    for (const s of brood) {
      expect(s.side).toBe("enemy");
      expect(s.summon).toEqual({ by: mother });
      expect(hexDistance(s.pos, unit(ctx.state, mother).pos)).toBe(1);
    }
    const order = ctx.state.encounter!.order;
    expect(order.slice(order.indexOf(mother) + 1, order.indexOf(mother) + 3).sort()).toEqual(brood.map((s) => s.id).sort());
    expect(enemyStrikes("spiderling", 1)[0]).toMatchObject({ name: "Bite", range: 1 });
  });
});

describe("a Broodmother's turn", () => {
  /** Its first turns, from Ann's end of turn: what it used, by name, and the Spiderlings about after. */
  function turns(seed: number) {
    let { state, mother } = board(false);
    state.aiOff = false;
    state.rng = seed;
    const events: ZoneEvent[] = [];
    state = must(state, { type: "end_turn", by: "ann", unit: "ann" }, events);
    for (let i = 0; i < 3; i++) state = must(state, { type: "timeout" }, events);
    const used = events.filter((e): e is Extract<ZoneEvent, { t: "used" }> => e.t === "used" && e.id === mother).map((e) => e.name);
    return { used, brood: state.units.filter((u) => u.kind === "spiderling").length };
  }

  it("calls its brood and spins web when it can", () => {
    const all = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const { used, brood } = turns(seed);
      used.forEach((n) => all.add(n));
      if (used.includes("Brood Swarm")) expect(brood, `seed ${seed}`).toBeGreaterThan(0);
    }
    expect(all.has("Brood Swarm")).toBe(true);
    expect(all.has("Spin Web")).toBe(true);
  });
});
