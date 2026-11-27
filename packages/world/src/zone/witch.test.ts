import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import type { HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { ENEMIES } from "../content";
import { enemyTurn } from "./ai";
import { HEAL_WORTH, behaviourOf } from "./behaviours";
import { enemyAct } from "./combat";
import { clusterHexes } from "./weather";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { saveBonus, saveRoll, type Ctx } from "./engine";
import { enemyStrikes, mindOf } from "./kit";
import { diceAverage } from "./rules";
import type { ZoneEvent, ZoneState } from "./types";

// A Hedge Witch: a hex from afar that leaves whoever it lands on the worse at saving, and a brew flung over its own to
// mend them.

const strike = (name: string) => enemyStrikes("witch", 1).find((s) => s.name === name)!;
const hex = strike("Weakening Hex");
const brew = strike("Witches' Brew");

const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

/** Ann far off, a Hedge Witch at `witchAt` and a Dire Wolf at each of `wolves`, in a fight with the AI off. */
function setUp(witchAt: HexPos, wolves: HexPos[] = [], annAt = at(5, 6)) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  Object.assign(standHero(state, "ann", annAt, hero), { hp: 900, maxHp: 900 });
  const witch = enemy(state, "witch", witchAt).id;
  const pack = wolves.map((p) => enemy(state, "wolf", p).id);
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, witch, pack };
}

function act(state: ZoneState, by: string, attack: typeof hex, target: string | null, aim?: HexPos, seed = 1) {
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, by), attack, target ? unit(ctx.state, target) : null, aim);
  return { after: ctx.state, events };
}

/** The witch's whole turn, by its own AI, standing still: what it was seen to use. */
function turn(state: ZoneState, witch: string, seed: number) {
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  ctx.state.aiOff = false;
  enemyTurn(ctx, unit(ctx.state, witch), { ap: 4, move: 0, stride: 0, disengaged: false, walk: 2 });
  return { after: ctx.state, used: events.flatMap((e) => (e.t === "used" ? [e.name] : [])), events };
}

const hurt = (state: ZoneState, id: string, by: number) => {
  const u = unit(state, id);
  u.hp = u.maxHp - by;
};

describe("a Hedge Witch", () => {
  it("has Weakening Hex and Witches' Brew", () => {
    expect(ENEMIES.witch.abilities).toEqual(["weakening_hex", "witches_brew"]);
    expect(ENEMY_ABILITIES.weakening_hex).toMatchObject({ damage: 6, potency: 4, range: 5, weight: 2, saveOr: { effect: "weakened", turns: 1, amount: 2 } });
    expect(ENEMY_ABILITIES.witches_brew).toMatchObject({ range: 5, area: 3, cooldown: 3, heal: 6, behaviour: "mend" });
  });
});

describe("Weakened", () => {
  it("takes its amount off every save, and nothing once it is gone", () => {
    const { state } = setUp(at(5, 1));
    const ann = unit(state, "ann");
    const before = saveBonus(ann, "agi");
    ann.conditions.push({ kind: "weakened", rounds: 1, amount: 2 });
    expect(saveBonus(ann, "agi")).toBe(before - 2);
    expect(saveBonus(ann, "vit")).toBe(saveBonus({ ...ann, conditions: [] }, "vit") - 2);
    ann.conditions[ann.conditions.length - 1].amount = 3;
    expect(saveBonus(ann, "str")).toBe(saveBonus({ ...ann, conditions: [] }, "str") - 3);
    // The roll told carries the lower bonus too.
    const ctx: Ctx = { state, rng: makeRng(1), events: [], effects: [] };
    const roll = saveRoll(ctx, ann, "agi", 12, "Test");
    expect(roll.bonus).toBe(before - 3);
  });

  it("is left by a Weakening Hex on a failed save, and lasts until the end of their next turn", () => {
    let weakened = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state, witch } = setUp(at(5, 1));
      const { after, events } = act(state, witch, hex, "ann", undefined, seed);
      const hit = events.some((e) => e.t === "hit" && e.target === "ann");
      const failed = events.some((e) => e.t === "roll" && e.roll.kind === "save" && !e.roll.ok);
      const c = unit(after, "ann").conditions.find((x) => x.kind === "weakened");
      expect(!!c, `seed ${seed}`).toBe(hit && failed);
      if (c) {
        weakened++;
        expect(c).toMatchObject({ rounds: 1, amount: 2 });
      }
    }
    expect(weakened).toBeGreaterThan(0);
  });
});

describe("Witches' Brew", () => {
  it("mends every one of its side on the clump of 3 hexes it lands on, itself too, and no hero", () => {
    const { state, witch, pack } = setUp(at(5, 1), [at(5, 4), at(6, 4), at(4, 4), at(5, 8)]);
    for (const id of [witch, ...pack]) hurt(state, id, 5);
    hurt(state, "ann", 50);
    // Thrown at a hex three off: the wolves on its 3 hexes are mended, and no other.
    const clump = clusterHexes(state, at(5, 1), at(5, 4), 3);
    expect(clump).toHaveLength(3);
    const { after, events } = act(state, witch, brew, null, at(5, 4));
    for (const wolf of pack) {
      const on = clump.some((p) => p.q === unit(state, wolf).pos.q && p.r === unit(state, wolf).pos.r);
      expect(unit(after, wolf).hp > unit(state, wolf).hp, wolf).toBe(on);
    }
    expect(pack.filter((w) => unit(after, w).hp > unit(state, w).hp).length).toBeGreaterThan(0);
    expect(unit(after, pack[3]).hp).toBe(unit(state, pack[3]).hp);
    expect(unit(after, witch).hp).toBe(unit(state, witch).hp);
    expect(unit(after, "ann").hp).toBe(unit(state, "ann").hp);
    expect(events).toContainEqual(expect.objectContaining({ t: "used", name: "Witches' Brew", at: at(5, 4) }));
    expect(events.some((e) => e.t === "roll" || e.t === "hit")).toBe(false);
    // Thrown at its own feet, it mends itself.
    const self = act(state, witch, brew, null, at(5, 1)).after;
    expect(unit(self, witch).hp).toBeGreaterThan(unit(state, witch).hp);
  });

  it("is worth HEAL_WORTH for each HP it would give back, and nothing with nobody hurt", () => {
    const { state, witch, pack } = setUp(at(5, 1), [at(5, 4)]);
    const look = { state, enemy: unit(state, witch), mind: mindOf("witch") };
    const worth = () => behaviourOf(brew).value(look, at(5, 1), brew, [unit(state, "ann")])?.worth ?? 0;
    expect(worth()).toBe(0);
    hurt(state, pack[0], 2);
    expect(worth()).toBe(2 * HEAL_WORTH);
    hurt(state, pack[0], 30);
    expect(worth()).toBe(diceAverage(brew.kit.heal!) * HEAL_WORTH);
  });

  it("is worth more than a hex at the same strength: a hurt ally is mended before a hero is struck", () => {
    const { state, witch, pack } = setUp(at(5, 1), [at(5, 4)]);
    hurt(state, pack[0], 30);
    const look = { state, enemy: unit(state, witch), mind: mindOf("witch") };
    const mend = behaviourOf(brew).value(look, at(5, 1), brew, [unit(state, "ann")])!.worth;
    const blow = behaviourOf(hex).value(look, at(5, 1), hex, [unit(state, "ann")])!.worth;
    expect(mend).toBeGreaterThan(blow * 1.5);
  });

  it("is thrown on its own turn when one of its side is hurt, then it hexes; with nobody hurt it only hexes", () => {
    let mended = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { state, witch, pack } = setUp(at(5, 1), [at(5, 5)]);
      expect(turn(state, witch, seed).used, `seed ${seed}`).not.toContain("Witches' Brew");
      hurt(state, pack[0], 30);
      const { used, after } = turn(state, witch, seed);
      if (used[0] === "Witches' Brew") mended++;
      expect(used.filter((n) => n === "Witches' Brew").length, `seed ${seed}`).toBeLessThanOrEqual(1);
      if (used.includes("Witches' Brew")) expect(unit(after, pack[0]).hp).toBeGreaterThan(unit(state, pack[0]).hp);
    }
    expect(mended).toBeGreaterThanOrEqual(9);
  });
});
