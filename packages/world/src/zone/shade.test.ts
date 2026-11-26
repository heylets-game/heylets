import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { enemyStrikes } from "./kit";
import { ENEMIES } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import type { Ctx } from "./engine";
import type { ZoneEvent } from "./types";

// A Shade: a Chill Touch that slows, and a Wail at everyone within two hexes that leaves those who fail to save
// fumbling their next attack.

const strike = (name: string) => enemyStrikes("shade", 1).find((s) => s.name === name)!;
const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

function wail(seed: number) {
  let state = flatBoard({ rng: 12345, start: at(1, 6), options: { party: 3 }, flags: { shareTurns: true } });
  state.aiOff = true;
  // Ann beside it, Bob two off, Cal three off: out of its reach.
  for (const [id, pos] of [["ann", at(5, 6)], ["bob", at(4, 6)], ["cal", at(3, 6)]] as const) Object.assign(standHero(state, id, pos, hero), { hp: 900, maxHp: 900 });
  const shade = enemy(state, "shade", at(6, 6)).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, shade), strike("Wail"), unit(ctx.state, "ann"));
  return { events, state: ctx.state };
}

describe("a Shade", () => {
  it("chills and wails", () => {
    expect(ENEMIES.shade.abilities).toEqual(["chill_touch", "wail"]);
    expect(ENEMY_ABILITIES.wail).toMatchObject({ shape: "burst", cooldown: 3, weight: 3, saveOr: { effect: "glitched", turns: 1 } });
    expect(strike("Wail")).toMatchObject({ burst: true, range: 2, cooldown: 3 });
  });

  it("wails at everyone within two hexes: full and Fumbling on a failed save, half and steady on a good one", () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 12; seed++) {
      const { events, state } = wail(seed);
      const hits = events.filter((e): e is Extract<ZoneEvent, { t: "hit" }> => e.t === "hit");
      expect(hits.map((h) => h.target).sort(), `seed ${seed}`).toEqual(["ann", "bob"]);
      for (const hit of hits) {
        const save = events.find((e): e is Extract<ZoneEvent, { t: "roll" }> => e.t === "roll" && e.roll.id === hit.target && e.roll.kind === "save")!;
        seen.add(save.roll.ok);
        expect(hit.amount).toBe(Math.max(1, save.roll.ok ? Math.floor(hit.dice!.total / 2) : hit.dice!.total));
        expect(unit(state, hit.target).conditions.some((c) => c.kind === "glitched"), `seed ${seed}: ${hit.target}`).toBe(!save.roll.ok);
      }
      expect(unit(state, "cal").conditions.some((c) => c.kind === "glitched")).toBe(false);
    }
    expect(seen.size).toBe(2);
  });
});
