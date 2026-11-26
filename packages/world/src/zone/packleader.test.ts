import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { hexDistance, type HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { attackContext, has } from "./engine";
import { RALLY_WORTH, behaviourOf } from "./behaviours";
import { mindOf } from "./kit";
import { enemyStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Pack Leader: it howls its pack into a frenzy, tears deep with its bite, and leaps on whoever stands apart.

const strike = (kind: string, name: string) => enemyStrikes(kind, 1).find((s) => s.name === name)!;
const howl = strike("alpha", "Howl");
const savageBite = strike("alpha", "Savage Bite");
const greatLunge = strike("alpha", "Great Lunge");
const wolfBite = strike("wolf", "Bite");

/** Ann, hardy, a Pack Leader at `leaderAt` and a Dire Wolf at each of `wolves`, in a fight with the AI off. */
function setUp(leaderAt: HexPos, wolves: HexPos[] = [], annAt = at(5, 6)) {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
  state.aiOff = true;
  Object.assign(
    standHero(state, "ann", annAt, { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash", "block"], items: {} }),
    { hp: 900, maxHp: 900 },
  );
  const leader = enemy(state, "alpha", leaderAt).id;
  const pack = wolves.map((p) => enemy(state, "wolf", p).id);
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, leader, pack };
}

function act(state: ZoneState, by: string, attack: typeof howl, target: string | null, seed = 1) {
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, by), attack, target ? unit(ctx.state, target) : null);
  return { after: ctx.state, events };
}

const frenzy = (state: ZoneState, id: string) => unit(state, id).conditions.find((c) => c.kind === "frenzied");
const bleeding = (state: ZoneState, id: string) => unit(state, id).conditions.find((c) => c.kind === "bleeding")?.amount ?? 0;

describe("a Pack Leader's Howl", () => {
  it("costs 1 AP, needs 3 turns to come back, and is its favourite", () => {
    expect(howl).toMatchObject({ cost: 1, cooldown: 3, harmless: true });
    expect(howl.weight).toBeGreaterThan(Math.max(savageBite.weight, greatLunge.weight));
  });

  it("Frenzies every ally within 3 hexes for 2 attacks, and not itself nor the heroes, with no roll and no harm", () => {
    const { state, leader, pack } = setUp(at(9, 6), [at(6, 6), at(9, 3), at(9, 2), at(2, 6)]);
    const { after, events } = act(state, leader, howl, null);
    for (const wolf of pack) {
      const far = hexDistance(unit(state, wolf).pos, at(9, 6));
      expect(frenzy(after, wolf)?.rounds, `${far} hexes off`).toBe(far <= 3 ? 2 : undefined);
    }
    // Some in reach and some not, or the test says nothing.
    expect(pack.filter((w) => frenzy(after, w)).length).toBeGreaterThan(0);
    expect(pack.filter((w) => !frenzy(after, w)).length).toBeGreaterThan(0);
    expect(frenzy(after, leader)).toBeUndefined();
    expect(frenzy(after, "ann")).toBeUndefined();
    expect(events.some((e) => e.t === "roll" || e.t === "hit")).toBe(false);
    expect(unit(after, "ann").hp).toBe(900);
  });

  it("is worth more to it the more allies it would stir from where it stands, and nothing with none in reach", () => {
    const { state, leader, pack } = setUp(at(9, 6), [at(9, 4), at(9, 8), at(2, 6)]);
    const look = { state, enemy: unit(state, leader), mind: mindOf("alpha") };
    const worth = (from: HexPos) => behaviourOf(howl).value(look, from, howl, [unit(state, "ann")])?.worth ?? 0;
    const reached = (from: HexPos) => pack.filter((w) => hexDistance(unit(state, w).pos, from) <= 3).length;
    expect(reached(at(9, 6))).toBe(2);
    expect(worth(at(9, 6))).toBe(2 * RALLY_WORTH);
    expect(worth(at(15, 6))).toBe(RALLY_WORTH * reached(at(15, 6)));
    expect(worth(at(15, 1))).toBe(RALLY_WORTH * reached(at(15, 1)));
    // One already Frenzied is not counted.
    unit(state, pack[0]).conditions.push({ kind: "frenzied", rounds: 2 });
    expect(worth(at(9, 6))).toBe(RALLY_WORTH);
  });

  it("does not wear off with the turns", () => {
    const { state, leader, pack } = setUp(at(9, 6), [at(6, 6)]);
    let s = act(state, leader, howl, null).after;
    s.aiOff = true;
    for (let i = 0; i < 4; i++) s = must(s, { type: "timeout" });
    expect(frenzy(s, pack[0])?.rounds).toBe(2);
  });
});

describe("a Frenzied ally", () => {
  it("attacks with advantage", () => {
    const { state, leader, pack } = setUp(at(9, 6), [at(6, 6)]);
    const { after } = act(state, leader, howl, null);
    expect(attackContext(after, unit(after, pack[0]), unit(after, "ann"), { melee: true }).notes).toContain("Advantage: you are Frenzied");
  });

  it("leaves a stack of Bleeding with every blow that draws blood, and is spent after 2 attacks, hit or miss", () => {
    let drew = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { state, leader, pack } = setUp(at(9, 6), [at(6, 6)]);
      let s = act(state, leader, howl, null).after;
      for (const n of [1, 2]) {
        const { after, events } = act(s, pack[0], wolfBite, "ann", seed * 7 + n);
        const hit = events.some((e) => e.t === "hit" && e.target === "ann" && e.amount > 0);
        expect(bleeding(after, "ann"), `seed ${seed}, attack ${n}`).toBe(bleeding(s, "ann") + (hit ? 1 : 0));
        if (hit) drew++;
        expect(frenzy(after, pack[0])?.rounds, `seed ${seed}, attack ${n}`).toBe(n === 1 ? 1 : undefined);
        s = after;
      }
      // Spent: the next blow is its own again.
      const { after, events } = act(s, pack[0], wolfBite, "ann", seed);
      if (events.some((e) => e.t === "hit" && e.target === "ann")) expect(bleeding(after, "ann")).toBe(bleeding(s, "ann"));
    }
    expect(drew).toBeGreaterThan(0);
  });
});

describe("a Pack Leader's Savage Bite", () => {
  it("leaves 2 stacks of Bleeding on a failed save, and 1 on a save", () => {
    const seen = { failed: 0, saved: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const { state, leader } = setUp(at(6, 6));
      const { after, events } = act(state, leader, savageBite, "ann", seed);
      const save = events.find((e): e is Extract<ZoneEvent, { t: "roll" }> => e.t === "roll" && e.roll.label === "Resist Savage Bite");
      if (!save) continue;
      if (save.roll.ok) seen.saved++;
      else seen.failed++;
      expect(bleeding(after, "ann"), `seed ${seed}`).toBe(save.roll.ok ? 1 : 2);
    }
    expect(seen.failed).toBeGreaterThan(0);
    expect(seen.saved).toBeGreaterThan(0);
  });
});

describe("a Pack Leader's Great Lunge", () => {
  it("leaps from 3 hexes off to beside its target, and Stuns on a failed save", () => {
    let stunned = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { state, leader } = setUp(at(8, 6));
      const { after, events } = act(state, leader, greatLunge, "ann", seed);
      expect(events.some((e) => e.t === "jumped" && e.id === leader && e.lunge === "ann")).toBe(true);
      expect(hexDistance(unit(after, leader).pos, unit(after, "ann").pos)).toBe(1);
      const save = events.find((e): e is Extract<ZoneEvent, { t: "roll" }> => e.t === "roll" && e.roll.label === "Resist Great Lunge");
      expect(has(unit(after, "ann"), "stunned"), `seed ${seed}`).toBe(!!save && !save.roll.ok);
      if (has(unit(after, "ann"), "stunned")) stunned++;
    }
    expect(stunned).toBeGreaterThan(0);
  });
});

describe("a Pack Leader's turn", () => {
  /** Its first turn, from Ann's end of turn: what it used, by name. */
  function firstTurn(wolves: HexPos[], seed: number) {
    const { state, leader } = setUp(at(9, 6), wolves);
    state.aiOff = false;
    state.rng = seed;
    const events: ZoneEvent[] = [];
    let s = must(state, { type: "end_turn", by: "ann", unit: "ann" }, events);
    for (let i = 0; i < 6 && !events.some((e) => e.t === "used" && e.id === leader); i++) s = must(s, { type: "timeout" }, events);
    return events.filter((e): e is Extract<ZoneEvent, { t: "used" }> => e.t === "used" && e.id === leader).map((e) => e.name);
  }

  it("howls first when it has its pack in the fight", () => {
    for (let seed = 1; seed <= 6; seed++) expect(firstTurn([at(9, 4), at(9, 8)], seed)[0], `seed ${seed}`).toBe("Howl");
  });

  it("never howls with no pack to stir", () => {
    for (let seed = 1; seed <= 6; seed++) expect(firstTurn([], seed), `seed ${seed}`).not.toContain("Howl");
  });
});
