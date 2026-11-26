import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { dashWay, enemyAct } from "./combat";
import { enemyStrikes, mindOf } from "./kit";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { behaviourOf } from "./behaviours";
import { checkStrike, strikeAim, strikeHexes } from "./strikes";
import { diceAverage } from "./rules";
import type { Ctx } from "./engine";
import type { HexPos } from "@gantt-quest/core";
import type { ZoneEvent } from "./types";

// A Cave Bat: a plain Bite, and a Fell Swoop that dashes it straight through a line of heroes, each saving for half
// and Bleeding on a fail, to come to rest beyond them.

const swoop = () => enemyStrikes("bat", 1).find((s) => s.id === "fell_swoop")!;
const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

/** A bat at (1,6), Ann and Bob in a row east of it (two and three hexes off), Cal off the line; `more` stood too. */
function board(more: [string, HexPos][] = []) {
  let state = flatBoard({ rng: 12345, start: at(3, 6), options: { party: 3 }, flags: { shareTurns: true } });
  state.aiOff = true;
  for (const [id, pos] of [["ann", at(3, 6)], ["bob", at(4, 6)], ["cal", at(3, 7)], ...more] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const bat = enemy(state, "bat", at(1, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, bat };
}

function swoopAt(aim: HexPos, seed: number, more: [string, HexPos][] = []) {
  const { state, bat } = board(more);
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, bat), swoop(), null, aim);
  return { events, state: ctx.state, bat };
}

describe("a Cave Bat", () => {
  it("bites, and swoops", () => {
    expect(ENEMIES.bat.abilities).toEqual(["bat_bite", "fell_swoop"]);
    expect(ENEMY_ABILITIES.bat_bite.saveOr).toBeUndefined();
    expect(ENEMY_ABILITIES.fell_swoop).toMatchObject({ name: "Fell Swoop", dash: true, range: 4, cooldown: 2, saveOr: { effect: "bleeding" } });
    expect(strikeAim(swoop())).toBe("hex");
  });

  it("dashes through everyone on the line and comes to rest beyond: half and no Bleeding on a save, full and Bleeding on a fail", () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 12; seed++) {
      const { events, state, bat } = swoopAt(at(5, 6), seed);
      expect(unit(state, bat).pos).toEqual(at(5, 6));
      const jump = events.find((e): e is Extract<ZoneEvent, { t: "jumped" }> => e.t === "jumped")!;
      expect(jump.dash?.name).toBe("Fell Swoop");
      expect(jump.dash?.through).toEqual([at(2, 6), at(3, 6), at(4, 6)]);
      expect(events.some((e) => e.t === "roll" && e.roll.kind === "attack")).toBe(false);
      const hits = events.filter((e): e is Extract<ZoneEvent, { t: "hit" }> => e.t === "hit");
      expect(hits.map((h) => h.target).sort(), `seed ${seed}`).toEqual(["ann", "bob"]);
      for (const hit of hits) {
        const save = events.find((e): e is Extract<ZoneEvent, { t: "roll" }> => e.t === "roll" && e.roll.id === hit.target && e.roll.kind === "save")!;
        seen.add(save.roll.ok);
        expect(hit.amount).toBe(Math.max(1, save.roll.ok ? Math.floor(hit.dice!.total / 2) : hit.dice!.total));
        expect(unit(state, hit.target).conditions.some((c) => c.kind === "bleeding")).toBe(!save.roll.ok);
      }
    }
    expect(seen.size).toBe(2);
  });

  it("comes to rest on the furthest hex of its line it can stand on, so a line ending in heroes stops short of them", () => {
    const { state, bat } = board([["dan", at(5, 6)]]);
    // Ann, Bob and Dan fill the far end: the only hex left to come down on is the first.
    expect(dashWay(state, unit(state, bat), unit(state, bat).pos, at(5, 6), 4)).toEqual({ through: [], land: at(2, 6) });
    expect(dashWay(state, unit(state, bat), unit(state, bat).pos, at(5, 6), 3)).toEqual({ through: [], land: at(2, 6) });
    const { events, state: after } = swoopAt(at(5, 6), 3, [["dan", at(5, 6)]]);
    expect(unit(after, bat).pos).toEqual(at(2, 6));
    expect(events.some((e) => e.t === "hit")).toBe(false);
  });

  it("draws no blows as it dashes away from a hero beside it", () => {
    const { state, bat } = board([["eve", at(0, 6)]]);
    const events: ZoneEvent[] = [];
    const ctx: Ctx = { state: structuredClone(state), rng: makeRng(5), events, effects: [] };
    enemyAct(ctx, unit(ctx.state, bat), swoop(), null, at(5, 6));
    expect(events.some((e) => e.t === "reaction")).toBe(false);
    expect(unit(ctx.state, bat).pos).toEqual(at(5, 6));
  });

  it("is aimed by hand at a hex, and shows the line it would take", () => {
    const { state, bat } = board();
    const b = unit(state, bat);
    expect(checkStrike(state, b, swoop(), { at: b.pos })).toMatch(/dash toward/);
    expect(checkStrike(state, b, swoop(), { at: at(5, 6) })).toBeNull();
    expect(strikeHexes(state, b, swoop(), at(5, 6))).toEqual([at(2, 6), at(3, 6), at(4, 6), at(5, 6)]);
  });

  it("aims its swoop to catch as many as it can", () => {
    const { state, bat } = board();
    const b = unit(state, bat);
    const heroes = state.units.filter((u) => u.side !== b.side);
    const use = behaviourOf(swoop()).value({ state, enemy: b, mind: mindOf("bat") }, b.pos, swoop(), heroes)!;
    expect(use.worth).toBeCloseTo(diceAverage(swoop().dice) * 0.75 * 2);
    const way = dashWay(state, b, b.pos, use.at!, 4)!;
    expect(["ann", "bob"].every((id) => way.through.some((p) => p.q === unit(state, id).pos.q && p.r === unit(state, id).pos.r))).toBe(true);
  });
});
