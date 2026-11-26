import { describe, expect, it } from "vitest";
import { GRID, at, fails, flatBoard, has, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { hexDistance, posKey, type HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { checkAbility, enemyAct, push, shift } from "./combat";
import { covers, gapTo, roomFor, span, unitAt, zoneReach } from "./geometry";
import { loadZone } from "./zone";
import { BEHAVIOURS } from "./behaviours";
import { ENEMIES } from "../content";
import { enemyStrikes } from "./kit";
import { quakeAtTurn, tickWeather } from "./weather";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Guardian: a fist of stone that knocks its target back and down, and an Earthquake that shakes the ground round it
// now and heaves it on its next turn.

const strike = (name: string) => enemyStrikes("guardian", 1).find((s) => s.name === name)!;
const stoneFist = strike("Stone Fist");
const earthquake = strike("Earthquake");

/** A Guardian at `guardAt` and a hardy hero at each of `heroes` (ann, bo, ...), in a fight with the AI off. */
function setUp(guardAt: HexPos, heroes: HexPos[]) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: heroes.length }, flags: { shareTurns: true } });
  state.aiOff = true;
  const ids = ["ann", "bo", "cy"].slice(0, heroes.length);
  ids.forEach((id, i) => Object.assign(standHero(state, id, heroes[i], { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 }));
  const guardian = enemy(state, "guardian", guardAt).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, guardian, ids };
}

const ctxOf = (state: ZoneState, seed: number): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });

describe("a Guardian's kit", () => {
  it("is Stone Fist, Earthquake and Slowing Field, and no Shove: it pushes nobody about but by its fist", () => {
    expect(ENEMIES.guardian.abilities).toEqual(["stone_fist", "earthquake", "slowing_field"]);
  });
});

describe("a Guardian's Stone Fist", () => {
  it("knocks its target a hex back on a hit, and Prone unless they save", () => {
    expect(stoneFist.saveOr).toEqual({ effect: "prone", turns: 1 });
    let hits = 0;
    let downed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state, guardian } = setUp(at(6, 6), [at(5, 6)]);
      const ctx = ctxOf(state, seed);
      const was = { ...unit(ctx.state, "ann").pos };
      enemyAct(ctx, unit(ctx.state, guardian), stoneFist, unit(ctx.state, "ann"));
      const hit = ctx.events.some((e) => e.t === "hit" && e.target === "ann");
      const now = unit(ctx.state, "ann").pos;
      if (!hit) {
        expect(now, `seed ${seed}`).toEqual(was);
        continue;
      }
      hits++;
      expect(hexDistance(now, unit(ctx.state, guardian).pos), `seed ${seed}`).toBe(2);
      if (has(ctx.state, "ann", "prone")) downed++;
    }
    expect(hits).toBeGreaterThan(0);
    expect(downed).toBeGreaterThan(0);
  });
});

describe("a Guardian's Earthquake", () => {
  it("costs 4 AP and waits 4 turns", () => {
    expect(earthquake).toMatchObject({ cost: 4, cooldown: 4, burst: true });
    expect(earthquake.kit.aftershock?.saveOr).toEqual({ effect: "prone", turns: 1 });
  });

  it("shakes everyone within 2 hexes of any of its hexes now, for half on a save, and leaves the ground there cracked", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6), at(11, 6), at(12, 6)]);
    const g = unit(state, guardian);
    expect([gapTo(g, at(7, 6)), gapTo(g, at(11, 6)), gapTo(g, at(12, 6))]).toEqual([1, 2, 3]);
    const ctx = ctxOf(state, 3);
    enemyAct(ctx, unit(ctx.state, guardian), earthquake, null);
    const hurt = (id: string) => ctx.events.filter((e) => e.t === "hit" && e.target === id);
    expect(hurt("ann")).toHaveLength(1);
    expect(hurt("bo")).toHaveLength(1);
    expect(hurt("cy")).toHaveLength(0);
    // The first shaking leaves nobody Prone.
    expect(has(ctx.state, "ann", "prone") || has(ctx.state, "bo", "prone")).toBe(false);
    const quake = ctx.state.weather?.find((w) => w.kind === "quake");
    // Every hex within 2 of any of its three, each once.
    const within: string[] = [];
    for (let row = 0; row < GRID.rows; row++) for (let col = 0; col < GRID.cols; col++) if (gapTo(g, at(col, row)) <= 2) within.push(posKey(at(col, row)));
    expect(quake?.hexes.map(posKey).sort()).toEqual(within.sort());
  });

  it("heaves as the Guardian's next turn begins, harder, on whoever is still on it, and then is gone", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6), at(10, 6)]);
    const ctx = ctxOf(state, 3);
    enemyAct(ctx, unit(ctx.state, guardian), earthquake, null);
    // Bo gets off it before then.
    unit(ctx.state, "bo").pos = at(12, 6);
    const before = { ann: unit(ctx.state, "ann").hp, bo: unit(ctx.state, "bo").hp };
    ctx.events.length = 0;
    quakeAtTurn(ctx, unit(ctx.state, guardian));
    // Told as going off from where it stood when it cracked the ground.
    expect(ctx.events.find((e) => e.t === "used" && e.again && e.name === "Earthquake")).toMatchObject({ at: at(8, 6) });
    expect(unit(ctx.state, "ann").hp).toBeLessThan(before.ann);
    expect(unit(ctx.state, "bo").hp).toBe(before.bo);
    expect(ctx.state.weather?.some((w) => w.kind === "quake")).toBe(false);
  });

  it("throws whoever fails the save off their feet as it heaves, and not whoever makes it", () => {
    let prone = 0;
    let kept = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state, guardian } = setUp(at(8, 6), [at(7, 6)]);
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, guardian), earthquake, null);
      ctx.events.length = 0;
      quakeAtTurn(ctx, unit(ctx.state, guardian));
      const save = ctx.events.find((e) => e.t === "roll" && e.roll.kind === "save");
      expect(save, `seed ${seed}`).toBeDefined();
      const ok = save!.t === "roll" && save!.roll.ok;
      expect(has(ctx.state, "ann", "prone"), `seed ${seed}`).toBe(!ok);
      if (ok) kept++;
      else prone++;
    }
    expect(prone).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  it("deals more on the heave than on the first shaking", () => {
    expect(earthquake.kit.aftershock!.dice.n * (earthquake.kit.aftershock!.dice.d + 1) / 2 + earthquake.kit.aftershock!.dice.plus).toBeGreaterThan(
      earthquake.dice.n * (earthquake.dice.d + 1) / 2 + earthquake.dice.plus,
    );
  });

  it("heaves when the Guardian's turn comes round in the fight, not before", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6)]);
    const ctx = ctxOf(state, 3);
    enemyAct(ctx, unit(ctx.state, guardian), earthquake, null);
    let now = ctx.state;
    const sink: ZoneEvent[] = [];
    const heaved = () => sink.some((e) => e.t === "used" && e.again);
    for (let n = 0; n < 6 && !heaved(); n++) {
      const enc = now.encounter!;
      // Not yet: it waits for the Guardian's own turn.
      if (!enc.acting.includes(guardian)) expect(heaved()).toBe(false);
      now = enc.acting.includes("ann") && !enc.done.includes("ann") ? must(now, { type: "end_turn", by: "ann", unit: "ann" }, sink) : must(now, { type: "timeout" }, sink);
    }
    expect(heaved()).toBe(true);
    expect(unit(now, "ann").hp).toBeLessThan(unit(ctx.state, "ann").hp);
    expect(now.weather?.some((w) => w.kind === "quake")).toBe(false);
  });

  it("settles without heaving if the Guardian falls first", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6)]);
    const ctx = ctxOf(state, 3);
    enemyAct(ctx, unit(ctx.state, guardian), earthquake, null);
    unit(ctx.state, guardian).down = true;
    tickWeather(ctx);
    expect(ctx.state.weather?.some((w) => w.kind === "quake")).toBe(false);
  });
});

/** On to ann's turn, the Guardian's passing with the AI off. */
function annsTurn(state: ZoneState): ZoneState {
  for (let n = 0; n < 6 && !(state.encounter!.acting.includes("ann") && !state.encounter!.done.includes("ann")); n++) state = must(state, { type: "timeout" });
  return state;
}

describe("a Guardian is three hexes big", () => {
  it("stands on its hex, the one east of it and the one south-east, and nobody else can stand on any of them", () => {
    const { state, guardian } = setUp(at(8, 6), [at(5, 6)]);
    const g = unit(state, guardian);
    expect(span(g).map(posKey)).toEqual([at(8, 6), at(9, 6), at(8, 7)].map(posKey));
    for (const p of span(g)) expect(unitAt(state, p)?.id).toBe(guardian);
    // Ann can walk round it, not onto it.
    const reach = zoneReach(state, unit(state, "ann"), 20);
    for (const p of span(g)) expect(reach.has(posKey(p))).toBe(false);
    expect(reach.has(posKey(at(10, 6)))).toBe(true);
  });

  it("is in reach of a blow from beside any of its hexes", () => {
    // Beside the south-east hex only (at(8, 7)), two hexes from its anchor.
    const { state, guardian } = setUp(at(8, 6), [at(8, 8)]);
    expect(hexDistance(unit(state, "ann").pos, unit(state, guardian).pos)).toBe(2);
    expect(checkAbility(state, unit(state, "ann"), "bash", { target: guardian })).toBeNull();
  });

  it("strikes at anyone beside any of its hexes", () => {
    const { state, guardian } = setUp(at(8, 6), [at(10, 6)]);
    let landed = false;
    for (let seed = 1; seed <= 10 && !landed; seed++) {
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, guardian), stoneFist, unit(ctx.state, "ann"));
      landed = ctx.events.some((e) => e.t === "hit" && e.target === "ann");
      // Knocked straight away from the hex of it beside her: east, not off at a slant from its anchor.
      if (landed) expect(unit(ctx.state, "ann").pos).toEqual(at(11, 6));
    }
    expect(landed).toBe(true);
  });

  it("walks only where all of it has room", () => {
    const { state, guardian } = setUp(at(8, 6), [at(2, 2)]);
    const g = unit(state, guardian);
    const reach = zoneReach(state, g, 6);
    expect(reach.size).toBeGreaterThan(1);
    for (const r of reach.values()) if (r.stop) expect(roomFor(state, g, r.pos), posKey(r.pos)).toBe(true);
    // Nor next to the edge of the map, where one of its hexes would be off it.
    expect([...reach.values()].some((r) => !roomFor(state, g, r.pos))).toBe(false);
  });

  it("is too heavy to push, pull or sweep: it does not budge, and says so", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6)]);
    const ctx = ctxOf(state, 1);
    expect(push(ctx, at(7, 6), unit(ctx.state, guardian), "ann")).toBe("heavy");
    expect(shift(ctx, unit(ctx.state, guardian), at(10, 6), "ann")).toBe("heavy");
    expect(unit(ctx.state, guardian).pos).toEqual(at(8, 6));
    // No knock against what it was not pushed into, either.
    expect(has(ctx.state, guardian, "prone")).toBe(false);
    expect(ctx.events.filter((e) => e.t === "heavy" && e.id === guardian)).toHaveLength(2);
    expect(ctx.events.some((e) => e.t === "shoved" || e.t === "hit")).toBe(false);
  });

  it("stays put when a hero shoves it", () => {
    let { state, guardian } = setUp(at(8, 6), [at(7, 6)]);
    state = annsTurn(state);
    state = must(state, { type: "common", by: "ann", unit: "ann", what: "shove", target: guardian });
    expect(unit(state, guardian).pos).toEqual(at(8, 6));
    expect(has(state, guardian, "prone")).toBe(false);
  });

  it("is moved, as it loads, to where all of it has room, and keeps that as its post", () => {
    const { state, guardian } = setUp(at(8, 6), [at(2, 2)]);
    const g = unit(state, guardian);
    // Someone stands where its east hex would be.
    Object.assign(standHero(state, "bo", at(9, 6), { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: [], items: {} }), {});
    state.encounter = null;
    loadZone(state);
    expect(roomFor(state, g, g.pos)).toBe(true);
    expect(g.home).toEqual(g.pos);
    expect(covers(g, at(9, 6))).toBe(false);
  });

  it("cannot jump", () => {
    let { state, guardian } = setUp(at(8, 6), [at(2, 2)]);
    expect(fails(state, { type: "common", by: "ann", unit: guardian, what: "jump", at: at(8, 4) })).toBeTruthy();
  });
});

describe("a Guardian's Slowing Field", () => {
  const slowingField = strike("Slowing Field");

  it("costs 2 AP, waits 4 turns, does no harm, and is weighed as a field", () => {
    expect(slowingField).toMatchObject({ cost: 2, cooldown: 4, harmless: true, behaviour: "field" });
    expect(slowingField.kit.field).toEqual({ rounds: 3, radius: 2 });
    expect(slowingField.weight).toBeGreaterThanOrEqual(2);
  });

  it("goes up round it for 3 of its turns, with no roll and no harm", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6)]);
    const ctx = ctxOf(state, 1);
    enemyAct(ctx, unit(ctx.state, guardian), slowingField, null);
    expect(unit(ctx.state, guardian).conditions.find((c) => c.kind === "slowing_field")).toMatchObject({ rounds: 3, amount: 2 });
    expect(ctx.events.some((e) => e.t === "roll" || e.t === "hit")).toBe(false);
  });

  it("Slows a hero whose turn starts within 2 hexes of any of its hexes, and not one further off", () => {
    let { state, guardian } = setUp(at(8, 6), [at(11, 6), at(12, 6)]);
    expect([gapTo(unit(state, guardian), at(11, 6)), gapTo(unit(state, guardian), at(12, 6))]).toEqual([2, 3]);
    unit(state, guardian).conditions.push({ kind: "slowing_field", rounds: 3, amount: 2 });
    // Round to each of their turns.
    const slowedAtTurn = new Map<string, boolean>();
    // Only turns begun since it went up count.
    const began = state.encounter!.turnNo;
    for (let n = 0; n < 8 && slowedAtTurn.size < 2; n++) {
      state = must(state, { type: "timeout" });
      const enc = state.encounter!;
      if (enc.turnNo === began) continue;
      for (const id of ["ann", "bo"]) if (enc.acting.includes(id) && !enc.done.includes(id) && !slowedAtTurn.has(id)) slowedAtTurn.set(id, has(state, id, "slowed"));
    }
    expect(slowedAtTurn.get("ann")).toBe(true);
    expect(slowedAtTurn.get("bo")).toBe(false);
  });

  it("Slows a hero who walks into it, for the rest of the walk", () => {
    let { state, guardian } = setUp(at(8, 6), [at(13, 6)]);
    unit(state, guardian).conditions.push({ kind: "slowing_field", rounds: 3, amount: 2 });
    state = annsTurn(state);
    expect(has(state, "ann", "slowed")).toBe(false);
    state = must(state, { type: "move", by: "ann", unit: "ann", to: at(11, 6) });
    expect(has(state, "ann", "slowed")).toBe(true);
  });

  it("is worth raising with heroes near, and nothing with none", () => {
    const near = setUp(at(8, 6), [at(10, 6)]);
    const far = setUp(at(8, 6), [at(14, 6)]);
    const look = (s: ZoneState, g: string) => ({ state: s, enemy: unit(s, g) });
    const heroes = (s: ZoneState) => s.units.filter((u) => u.side === "hero");
    expect(BEHAVIOURS.field.value(look(near.state, near.guardian) as never, at(8, 6), slowingField, heroes(near.state))?.worth).toBeGreaterThan(0);
    expect(BEHAVIOURS.field.value(look(far.state, far.guardian) as never, at(8, 6), slowingField, heroes(far.state))).toBeNull();
  });
});
