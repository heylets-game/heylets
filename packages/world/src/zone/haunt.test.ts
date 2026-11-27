import { describe, expect, it } from "vitest";
import { at, flatBoard, has, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { hexDistance, posKey, type HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { checkCommon, coneHexes, enemyAct } from "./combat";
import { lineFrom, zoneReach } from "./geometry";
import { BEHAVIOURS } from "./behaviours";
import { ENEMIES } from "../content";
import { DEFAULT_MIND, enemyStrikes } from "./kit";
import { dreadOver, saveRoll, type Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Haunt: an icy hand reaching out over a cone, a spear of ice down a line, a chain that holds a hero to a spot, and
// a Terror Aura that makes every save near it worse.

const strike = (name: string) => enemyStrikes("haunt", 1).find((s) => s.name === name)!;
const graveGrasp = strike("Grave Grasp");
const iceSpear = strike("Ice Spear");
const fetter = strike("Ghastly Fetter");

/** A Haunt at `hauntAt` and a hardy hero at each of `heroes` (ann, bo, cy), in a fight with the AI off. */
function setUp(hauntAt: HexPos, heroes: HexPos[]) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: heroes.length }, flags: { shareTurns: true } });
  state.aiOff = true;
  const ids = ["ann", "bo", "cy"].slice(0, heroes.length);
  ids.forEach((id, i) => Object.assign(standHero(state, id, heroes[i], { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} }), { hp: 900, maxHp: 900 }));
  const haunt = enemy(state, "haunt", hauntAt).id;
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  // Everyone in it, however far off they stand (a fight starts with only those near).
  for (const id of ids) if (!state.encounter!.order.includes(id)) state.encounter!.order.push(id);
  return { state, haunt, ids };
}

const ctxOf = (state: ZoneState, seed: number): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });
const hits = (ctx: Ctx, id: string) => ctx.events.filter((e) => e.t === "hit" && e.target === id);

describe("a Haunt's kit", () => {
  it("is Grave Grasp, Ice Spear, Ghastly Fetter and Terror Aura, and only the first three are ever used", () => {
    expect(ENEMIES.haunt.abilities).toEqual(["grave_grasp", "ice_spear", "ghastly_fetter", "terror_aura"]);
    expect(enemyStrikes("haunt", 1).map((s) => s.name)).toEqual(["Grave Grasp", "Ice Spear", "Ghastly Fetter"]);
    expect(graveGrasp.kit.cone).toBe(3);
    expect(iceSpear).toMatchObject({ cooldown: 2 });
    expect(iceSpear.kit.line).toBe(5);
    expect(fetter).toMatchObject({ range: 5, cost: 1, cooldown: 3, saveOr: { effect: "reeling", turns: 3, amount: 1 } });
  });
});

describe("a Haunt's Grave Grasp", () => {
  it("catches everyone in the three rows of its cone, for half and no Slowing on a save, and nobody outside it", () => {
    const hauntAt = at(5, 6);
    const aim = at(8, 6);
    const { state, haunt } = setUp(hauntAt, [at(6, 6), at(8, 6), at(5, 9)]);
    const cone = coneHexes(state, hauntAt, aim, 3).map(posKey);
    expect(cone).toContain(posKey(at(6, 6)));
    expect(cone).toContain(posKey(at(8, 6)));
    expect(cone).not.toContain(posKey(at(5, 9)));
    let slowed = 0;
    let halved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, haunt), graveGrasp, null, aim);
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

  it("is aimed by the enemy to catch as many as it can", () => {
    const { state, haunt } = setUp(at(5, 6), [at(6, 6), at(7, 6), at(5, 9)]);
    const look = { state, enemy: unit(state, haunt), mind: DEFAULT_MIND };
    const heroes = ["ann", "bo", "cy"].map((id) => unit(state, id));
    const use = BEHAVIOURS[graveGrasp.behaviour].value(look, unit(state, haunt).pos, graveGrasp, heroes);
    expect(use?.at).toBeDefined();
    const caught = coneHexes(state, unit(state, haunt).pos, use!.at!, 3).map(posKey);
    expect(caught).toContain(posKey(at(6, 6)));
    expect(caught).toContain(posKey(at(7, 6)));
  });
});

describe("a Haunt's Ice Spear", () => {
  it("goes five hexes straight through everyone on them, each saving for half, and no further", () => {
    const hauntAt = at(3, 6);
    const aim = at(4, 6);
    const line = lineFrom(flatBoard({ rng: 1, start: at(2, 6) }).map, hauntAt, aim, 6);
    const { state, haunt } = setUp(hauntAt, [line[0], line[4], line[5]]);
    const ctx = ctxOf(state, 7);
    enemyAct(ctx, unit(ctx.state, haunt), iceSpear, null, aim);
    expect(hits(ctx, "ann")).toHaveLength(1);
    expect(hits(ctx, "bo")).toHaveLength(1);
    expect(hits(ctx, "cy")).toHaveLength(0);
    // Nobody is singled out: no roll to hit, only saves.
    expect(ctx.events.some((e) => e.t === "roll" && e.roll.kind === "attack")).toBe(false);
  });
});

describe("a Haunt's Terror Aura", () => {
  it("makes every save of the other side within 2 hexes of it one with disadvantage, and none further off", () => {
    const { state } = setUp(at(5, 6), [at(7, 6), at(8, 6)]);
    expect(hexDistance(at(5, 6), at(7, 6))).toBe(2);
    expect(dreadOver(state, unit(state, "ann"))).toBe("Terror Aura");
    expect(dreadOver(state, unit(state, "bo"))).toBeNull();
    const ctx = ctxOf(state, 3);
    expect(saveRoll(ctx, unit(ctx.state, "ann"), "agi", 10, "test").adv).toBe(-1);
    expect(saveRoll(ctx, unit(ctx.state, "bo"), "agi", 10, "test").adv).toBe(0);
  });

  it("is gone with the Haunt", () => {
    const { state, haunt } = setUp(at(5, 6), [at(6, 6)]);
    unit(state, haunt).down = true;
    expect(dreadOver(state, unit(state, "ann"))).toBeNull();
  });
});

describe("a Haunt's Ghastly Fetter", () => {
  /** Ann fettered by the Haunt (the first seed she fails to save on), in a ctx to go on with. */
  function fettered() {
    const { state, haunt } = setUp(at(5, 6), [at(9, 6)]);
    for (let seed = 1; seed <= 40; seed++) {
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, haunt), fetter, unit(ctx.state, "ann"));
      if (has(ctx.state, "ann", "fettered")) return { ctx, haunt };
    }
    throw new Error("never fettered");
  }

  it("is never rolled to hit: a save for half and nothing else, or all of it, Reeling and the chain", () => {
    expect(fetter.kit.saves).toBe(true);
    let saved = 0;
    let failed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state, haunt } = setUp(at(5, 6), [at(9, 6)]);
      const ctx = ctxOf(state, seed);
      enemyAct(ctx, unit(ctx.state, haunt), fetter, unit(ctx.state, "ann"));
      expect(ctx.events.some((e) => e.t === "roll" && e.roll.kind === "attack"), `seed ${seed}`).toBe(false);
      expect(ctx.events.some((e) => e.t === "miss"), `seed ${seed}`).toBe(false);
      const hit = hits(ctx, "ann");
      expect(hit, `seed ${seed}`).toHaveLength(1);
      const halved = hit[0].t === "hit" && !!hit[0].dice?.halved;
      expect(has(ctx.state, "ann", "fettered"), `seed ${seed}`).toBe(!halved);
      expect(has(ctx.state, "ann", "reeling"), `seed ${seed}`).toBe(!halved);
      if (halved) saved++;
      else failed++;
    }
    expect(saved).toBeGreaterThan(0);
    expect(failed).toBeGreaterThan(0);
  });

  it("leaves whoever fails to save Reeling by 1 for 3 turns, and chained to where they stood", () => {
    const { ctx } = fettered();
    const ann = unit(ctx.state, "ann");
    expect(ann.conditions.find((c) => c.kind === "reeling")).toMatchObject({ rounds: 3, amount: 1 });
    expect(ann.conditions.find((c) => c.kind === "fettered")).toMatchObject({ rounds: 3, amount: 1, at: at(9, 6) });
  });

  it("lets them go no further than a hex from their spot", () => {
    const { ctx } = fettered();
    const ann = unit(ctx.state, "ann");
    const reach = zoneReach(ctx.state, ann, 20);
    expect(reach.size).toBeGreaterThan(1);
    for (const r of reach.values()) expect(hexDistance(r.pos, at(9, 6)), posKey(r.pos)).toBeLessThanOrEqual(1);
    expect(checkCommon(ctx.state, ann, "jump", { at: at(11, 6) }, ctx.state.encounter!.budgets.ann ?? null)).toBe("The chain will not reach.");
  });

  it("keeps them chained to the first spot when fettered again, and lets one put further off come back toward it", () => {
    const { ctx, haunt } = fettered();
    const ann = unit(ctx.state, "ann");
    // Moved off (as a shove would), two hexes from the spot: they may only come nearer it.
    ann.pos = at(11, 6);
    for (let seed = 1; seed <= 10; seed++) {
      ctx.rng = makeRng(seed);
      enemyAct(ctx, unit(ctx.state, haunt), fetter, ann);
    }
    expect(ann.conditions.find((c) => c.kind === "fettered")?.at).toEqual(at(9, 6));
    for (const r of zoneReach(ctx.state, ann, 20).values()) {
      const far = hexDistance(r.pos, at(9, 6));
      expect(far <= 1 || (r.pos.q === ann.pos.q && r.pos.r === ann.pos.r), posKey(r.pos)).toBe(true);
    }
  });
});
