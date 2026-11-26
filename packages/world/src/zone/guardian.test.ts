import { describe, expect, it } from "vitest";
import { at, flatBoard, has, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { hexDistance, type HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
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
  it("is Stone Fist, Earthquake and Shove", () => {
    expect(ENEMIES.guardian.abilities).toEqual(["stone_fist", "earthquake", "shove"]);
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

  it("shakes everyone within 2 hexes now, for half on a save, and leaves the ground there cracked", () => {
    const { state, guardian } = setUp(at(8, 6), [at(7, 6), at(10, 6), at(11, 6)]);
    const ctx = ctxOf(state, 3);
    enemyAct(ctx, unit(ctx.state, guardian), earthquake, null);
    const hurt = (id: string) => ctx.events.filter((e) => e.t === "hit" && e.target === id);
    expect(hurt("ann")).toHaveLength(1);
    expect(hurt("bo")).toHaveLength(1);
    expect(hurt("cy")).toHaveLength(0);
    // The first shaking leaves nobody Prone.
    expect(has(ctx.state, "ann", "prone") || has(ctx.state, "bo", "prone")).toBe(false);
    const quake = ctx.state.weather?.find((w) => w.kind === "quake");
    expect(quake?.hexes).toHaveLength(19);
    expect(quake?.hexes.every((p) => hexDistance(p, unit(ctx.state, guardian).pos) <= 2)).toBe(true);
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
    expect(ctx.events.some((e) => e.t === "used" && e.again && e.name === "Earthquake")).toBe(true);
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
