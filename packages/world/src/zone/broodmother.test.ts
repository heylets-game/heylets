import { describe, expect, it } from "vitest";
import { hexDistance, posKey, type HexPos } from "@gantt-quest/core";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { enterSurface, placeSurface, standInSurface } from "./surfaces";
import { blast, sameHex } from "./geometry";
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
    expect(strike("Spin Web")).toMatchObject({ range: 3, cooldown: 4, harmless: true, kit: { spread: { shape: "blast", radius: 2 }, surface: { kind: "web" } } });
    expect(strike("Brood Swarm")).toMatchObject({ cost: 1, cooldown: 2, behaviour: "summon", kit: { summon: { kind: "spiderling", count: 2, most: 14, share: 1 } } });
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

  it("never has more than 14 Spiderlings of its own out at once", () => {
    const { state, mother } = board();
    // Open ground all round it, so only the cap stops it.
    const ctx = ctxOf(state);
    const call = () => {
      const before = ctx.state.units.filter((u) => u.kind === "spiderling").length;
      // Those already called stand off out of the way, leaving room beside it.
      for (const u of ctx.state.units) if (u.kind === "spiderling") u.pos = { q: 40 + before, r: 40 };
      enemyAct(ctx, unit(ctx.state, mother), strike("Brood Swarm"), null);
      return ctx.state.units.filter((u) => u.kind === "spiderling").length;
    };
    const counts = Array.from({ length: 8 }, call);
    expect(counts).toEqual([2, 4, 6, 8, 10, 12, 14, 14]);
    // One falls: there is room for one more.
    const fallen = ctx.state.units.find((u) => u.kind === "spiderling")!;
    fallen.down = true;
    expect(call()).toBe(15);
    expect(ctx.state.units.filter((u) => u.kind === "spiderling" && !u.down)).toHaveLength(14);
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

describe("a Broodmother with no room to call its brood", () => {
  /**
   * Walled in by hexes with no ground on every side but two: the hex west of it (its way out) and the one east of it,
   * where Ann stands if `beside`, or more bare ground if not (Ann then far off). Its first turn, from Ann's end of turn.
   */
  function walled(beside: boolean, seed: number) {
    const c = at(6, 6);
    const near = (dq: number, dr: number) => ({ q: c.q + dq, r: c.r + dr });
    const gone = [[0, 1], [0, -1], [1, -1], [-1, 1], ...(beside ? [] : [[1, 0]])].map(([dq, dr]) => near(dq, dr));
    let state = flatBoard({ rng: 12345, start: at(1, 1), options: { party: 1 }, flags: { shareTurns: true }, gone });
    state.aiOff = true;
    Object.assign(standHero(state, "ann", beside ? near(1, 0) : at(1, 1), hero), { hp: 900, maxHp: 900 });
    const mother = enemy(state, "broodmother", c).id;
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    state.aiOff = false;
    state.rng = seed;
    const events: ZoneEvent[] = [];
    state = must(state, { type: "end_turn", by: "ann", unit: "ann" }, events);
    for (let i = 0; i < 3 && !events.some((e) => e.t === "turn" && e.ids.includes("ann")); i++) state = must(state, { type: "timeout" }, events);
    const used = events.filter((e): e is Extract<ZoneEvent, { t: "used" }> => e.t === "used" && e.id === mother).map((e) => e.name);
    return { state, mother, used, drawn: events.filter((e) => e.t === "reaction").length, brood: state.units.filter((u) => u.kind === "spiderling").length };
  }

  it("steps out to where there is room for its whole brood, when nobody would strike at it on the way", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { state, mother, used, brood } = walled(false, seed);
      expect(used[0], `seed ${seed}`).toBe("Brood Swarm");
      // Where it stood there was room for one: two came, so it called them from somewhere else.
      expect(brood, `seed ${seed}`).toBe(2);
      expect(sameHex(unit(state, mother).pos, at(6, 6)), `seed ${seed}`).toBe(false);
    }
  });

  it("does not leave a hero's reach for more room: it stays, and draws no blow", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { state, mother, drawn, brood } = walled(true, seed);
      expect(drawn, `seed ${seed}`).toBe(0);
      expect(sameHex(unit(state, mother).pos, at(6, 6)), `seed ${seed}`).toBe(true);
      expect(brood, `seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("walking through web", () => {
  it("is told once: Slowed (or Hasted, for a spider) as the first hex of it is entered, and not again on the next", () => {
    const { state, spider } = board();
    const ctx = ctxOf(state);
    placeSurface(ctx, [at(2, 2), at(3, 2), at(7, 7)], "web", 4, null);
    const told = (id: string) => ctx.events.filter((e) => e.t === "condition" && e.target === id).length;
    const ann = unit(ctx.state, "ann");
    for (const p of [at(2, 2), at(3, 2)]) {
      ann.pos = p;
      enterSurface(ctx, ann);
    }
    expect(told("ann")).toBe(1);
    const s = unit(ctx.state, spider);
    standInSurface(ctx, s);
    standInSurface(ctx, s);
    expect(told(spider)).toBe(1);
  });
});

describe("a Broodmother's brood and the room round her", () => {
  const c = at(6, 6);
  const near = (dq: number, dr: number) => ({ q: c.q + dq, r: c.r + dr });
  const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]].map(([dq, dr]) => near(dq, dr));

  it("calls one onto a hex where one of its brood stands alone, never onto two, nor onto anyone else", () => {
    let state = flatBoard({ rng: 12345, start: at(1, 1), options: { party: 1 }, flags: { shareTurns: true } });
    state.aiOff = true;
    Object.assign(standHero(state, "ann", at(1, 1), hero), { hp: 900, maxHp: 900 });
    const mother = enemy(state, "broodmother", c).id;
    // Two of its brood on the first hex, one on each of the next three, a dummy on the fifth: only the three have room.
    const brood = (p: HexPos) => enemy(state, "spiderling", p, "g1", { summon: { by: mother } });
    brood(ring[0]);
    brood(ring[0]);
    for (const p of ring.slice(1, 4)) brood(p);
    enemy(state, "dummy", ring[4]);
    // The sixth is empty: it is used first.
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, mother), strike("Brood Swarm"), null);
    const fresh = ctx.state.units.filter((u) => u.kind === "spiderling").slice(5);
    expect(fresh).toHaveLength(2);
    expect(fresh.some((u) => sameHex(u.pos, ring[5]))).toBe(true);
    const other = fresh.find((u) => !sameHex(u.pos, ring[5]))!;
    expect(ring.slice(1, 4).some((p) => sameHex(p, other.pos))).toBe(true);
    for (const p of ring) expect(ctx.state.units.filter((u) => !u.down && sameHex(u.pos, p)).length).toBeLessThanOrEqual(2);
  });

  it("keeps its Spiderlings off the hexes beside her, where they can still bite from somewhere else", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let state = flatBoard({ rng: 12345, start: at(1, 1), options: { party: 1 }, flags: { shareTurns: true } });
      state.aiOff = true;
      // Ann two hexes off: the Spiderling beside the Broodmother is beside Ann too, and could bite her from where it is.
      Object.assign(standHero(state, "ann", near(2, 0), hero), { hp: 900, maxHp: 900 });
      const m = enemy(state, "broodmother", c);
      m.conditions.push({ kind: "stunned", rounds: 1 });
      const s = enemy(state, "spiderling", near(1, 0), "g1", { summon: { by: m.id } }).id;
      state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
      state.aiOff = false;
      state.rng = seed;
      const events: ZoneEvent[] = [];
      state = must(state, { type: "end_turn", by: "ann", unit: "ann" }, events);
      for (let i = 0; i < 3 && !events.some((e) => e.t === "turn" && e.ids.includes("ann")); i++) state = must(state, { type: "timeout" }, events);
      expect(events.some((e) => e.t === "used" && e.id === s), `seed ${seed}`).toBe(true);
      expect(hexDistance(unit(state, s).pos, c), `seed ${seed}`).toBeGreaterThan(1);
      expect(events.filter((e) => e.t === "reaction").length, `seed ${seed}`).toBe(0);
    }
  });
});
