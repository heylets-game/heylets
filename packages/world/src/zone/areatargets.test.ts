import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { unseen, type Ctx } from "./engine";
import { inFight } from "./geometry";
import { abilityStrikes } from "./kit";
import type { ZoneEvent, ZoneState } from "./types";

// An enemy's area attacks (a burst, a rain of arrows, a dash, a Club Smash's shock) hit whoever stands under them, a
// hidden hero or one outside the fight too. What an enemy weighs when it picks an attack does not count such heroes:
// to it they are not there.

const hero = { classId: "qa_paladin", level: 3, armor: 0, power: 1, abilities: ["bash"], items: {} };
const sturdy = <T extends { hp: number; maxHp: number }>(u: T): T => Object.assign(u, { hp: 900, maxHp: 900 });
const ctxOf = (state: ZoneState, seed = 1): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });
const hurt = (events: ZoneEvent[], id: string) => events.filter((e) => e.t === "hit" && e.target === id);

describe("who an enemy's area attack hits", () => {
  it("an Unseen hero inside a Rain of Arrows takes its damage, and stays Unseen", () => {
    let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
    state.aiOff = true;
    sturdy(standHero(state, "ann", at(5, 6), hero));
    sturdy(standHero(state, "bob", at(6, 6), hero)).conditions.push({ kind: "invisible", rounds: 3 });
    const archer = enemy(state, "archer", at(9, 6)).id;
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, archer), abilityStrikes(["rain_of_arrows"], 3)[0], unit(ctx.state, "ann"), at(5, 6));
    expect(hurt(ctx.events, "bob").length).toBe(1);
    expect(hurt(ctx.events, "ann").length).toBe(1);
    // Being hit does not give them away: only what they do themselves does (engine.ts giveAway).
    expect(unseen(unit(ctx.state, "bob"))).toBe(true);
  });

  it("a hero outside the fight standing under a Slam takes it, and is still outside the fight", () => {
    let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
    state.aiOff = true;
    sturdy(standHero(state, "ann", at(5, 6), hero));
    sturdy(standHero(state, "cal", at(6, 7), hero));
    const ogre = enemy(state, "ogre", at(6, 6)).id;
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    state.encounter!.order = state.encounter!.order.filter((id) => id !== "cal");
    expect(inFight(state, "cal")).toBe(false);
    const ctx = ctxOf(state);
    const slam = abilityStrikes(["slam"], 3)[0];
    enemyAct(ctx, unit(ctx.state, ogre), slam, null);
    expect(hurt(ctx.events, "cal").length).toBe(1);
    // The blow does not draw them in (damage engages nobody): that is for an enemy closing in, as before.
    expect(inFight(ctx.state, "cal")).toBe(false);
  });

  it("a hero outside the fight standing on the ground an Earthquake shakes takes it", () => {
    let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
    state.aiOff = true;
    sturdy(standHero(state, "ann", at(5, 6), hero));
    sturdy(standHero(state, "cal", at(7, 7), hero));
    const guardian = enemy(state, "guardian", at(6, 5), "g1", { hp: 900, maxHp: 900 }).id;
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    state.encounter!.order = state.encounter!.order.filter((id) => id !== "cal");
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, guardian), abilityStrikes(["earthquake"], 3)[0], null);
    expect(hurt(ctx.events, "cal").length).toBe(1);
  });

  it("asks no save of one outside the fight against what would not take hold on them", () => {
    let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
    state.aiOff = true;
    sturdy(standHero(state, "ann", at(4, 6), hero));
    sturdy(standHero(state, "cal", at(6, 6), hero));
    const skeleton = enemy(state, "skeleton", at(5, 6), "g1", { hp: 900, maxHp: 900 }).id;
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    state.encounter!.order = state.encounter!.order.filter((id) => id !== "cal");
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, skeleton), abilityStrikes(["memento_mori"], 3)[0], null);
    expect(ctx.events.some((e) => e.t === "roll" && e.roll.id === "ann")).toBe(true);
    expect(ctx.events.some((e) => e.t === "roll" && e.roll.id === "cal")).toBe(false);
  });

  it("a hero whose player is away is still spared", () => {
    let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
    state.aiOff = true;
    sturdy(standHero(state, "ann", at(5, 6), hero));
    sturdy(standHero(state, "bob", at(6, 7), hero)).away = true;
    const ogre = enemy(state, "ogre", at(6, 6)).id;
    state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    const ctx = ctxOf(state);
    enemyAct(ctx, unit(ctx.state, ogre), abilityStrikes(["slam"], 3)[0], null);
    expect(hurt(ctx.events, "bob")).toEqual([]);
  });
});

describe("what an enemy weighs when it picks an attack", () => {
  it("does not aim an area attack at a hex where only an Unseen hero stands", () => {
    for (let seed = 1; seed <= 6; seed++) {
      let state = flatBoard({ rng: seed, start: at(2, 6), options: { party: 2 }, flags: { shareTurns: true } });
      sturdy(standHero(state, "ann", at(3, 6), hero));
      sturdy(standHero(state, "bob", at(9, 6), hero)).conditions.push({ kind: "invisible", rounds: 9 });
      const archer = enemy(state, "archer", at(11, 6), "g1", { hp: 900, maxHp: 900 }).id;
      state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
      const events: ZoneEvent[] = [];
      for (let i = 0; i < 12 && state.encounter && state.encounter.round <= 2; i++) {
        const enc = state.encounter;
        const mine = enc.acting.find((id) => unit(state, id).side === "hero" && !enc.done.includes(id));
        state = mine ? must(state, { type: "end_turn", by: mine, unit: mine }, events) : must(state, { type: "timeout" }, events);
      }
      const bob = at(9, 6);
      for (const e of events) {
        if (e.t === "used" && e.id === archer && e.at) expect(hexDistance(e.at, bob), `seed ${seed}`).toBeGreaterThan(1);
        if (e.t === "used" && e.id === archer) expect(e.target, `seed ${seed}`).not.toBe("bob");
      }
    }
  });
});
