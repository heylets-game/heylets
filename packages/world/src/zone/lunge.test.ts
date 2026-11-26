import { describe, expect, it } from "vitest";
import { GRID, at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { hexDistance, hexNeighbors, posKey, type HexPos } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { enemyAct } from "./combat";
import { leapRisk, strikeReaches } from "./behaviours";
import { enemyStrikes } from "./kit";
import type { Ctx } from "./engine";
import type { ZoneEvent, ZoneState } from "./types";

// A Dire Wolf's Lunge: it springs at a hero up to 3 hexes off, lands beside them, and bites.

const board = (): ZoneState => flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { shareTurns: true } });
const lunge = enemyStrikes("wolf", 1).find((s) => s.name === "Lunge")!;

/** Ann, hardy, and a wolf at `wolfAt`, in a fight with the AI off. */
function setUp(wolfAt: HexPos, annAt = at(5, 6)) {
  let state = board();
  state.aiOff = true;
  Object.assign(
    standHero(state, "ann", annAt, { classId: "qa_paladin", level: 1, armor: 2, power: 1, abilities: ["bash", "block"], items: {} }),
    { hp: 900, maxHp: 900 },
  );
  const wolf = enemy(state, "wolf", wolfAt);
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return { state, wolf: wolf.id };
}

function act(state: ZoneState, wolf: string, seed = 1) {
  const events: ZoneEvent[] = [];
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(seed), events, effects: [] };
  enemyAct(ctx, unit(ctx.state, wolf), lunge, unit(ctx.state, "ann"));
  return { after: ctx.state, events };
}

describe("a Dire Wolf's Lunge", () => {
  it("reaches a hero up to 3 hexes off, and no further", () => {
    for (const [col, reaches] of [[6, true], [7, true], [8, true], [9, false]] as const) {
      const { state, wolf } = setUp(at(col, 6));
      expect(strikeReaches(state, unit(state, wolf), unit(state, wolf).pos, lunge, unit(state, "ann"))).toBe(reaches);
    }
  });

  it("leaps from 3 hexes off to the open hex beside its target nearest where it was, then strikes", () => {
    const { state, wolf } = setUp(at(8, 6));
    const { after, events } = act(state, wolf);
    const leap = events.find((e): e is Extract<ZoneEvent, { t: "jumped" }> => e.t === "jumped");
    expect(leap).toEqual({ t: "jumped", id: wolf, from: at(8, 6), to: at(6, 6), lunge: "ann" });
    expect(unit(after, wolf).pos).toEqual(at(6, 6));
    expect(hexDistance(unit(after, wolf).pos, unit(after, "ann").pos)).toBe(1);
    // The leap, then the blow.
    const blow = events.findIndex((e) => (e.t === "hit" || e.t === "miss") && e.target === "ann");
    expect(blow).toBeGreaterThan(events.indexOf(leap!));
  });

  it("does not move a wolf already beside its target", () => {
    const { state, wolf } = setUp(at(6, 6));
    const { after, events } = act(state, wolf);
    expect(events.some((e) => e.t === "jumped")).toBe(false);
    expect(unit(after, wolf).pos).toEqual(at(6, 6));
    expect(events.some((e) => (e.t === "hit" || e.t === "miss") && e.target === "ann")).toBe(true);
  });

  it("lands out of fire where there is somewhere else as near", () => {
    const { state, wolf } = setUp(at(5, 3));
    // The wolf is straight above her: the two hexes beside her nearest it are as near as each other.
    const near = hexNeighbors(at(5, 6), GRID).filter((p) => hexDistance(p, at(5, 3)) === 2);
    expect(near.length).toBe(2);
    const [burning, clear] = near;
    state.surfaces[posKey(burning)] = { kind: "fire", rounds: 3 } as ZoneState["surfaces"][string];
    const { after } = act(state, wolf);
    expect(unit(after, wolf).pos).toEqual(clear);
  });

  it("is worth less to the wolf for every hero it leaps out of reach of, and for landing in fire", () => {
    const { state, wolf } = setUp(at(8, 6));
    const w = unit(state, wolf);
    expect(leapRisk(state, w, at(8, 6), at(6, 6))).toBe(1);
    // Bo beside it, who would strike as it leaps away.
    const bo = { ...unit(state, "ann"), id: "bo", pos: at(9, 6) };
    state.units.push(bo);
    state.encounter!.order.push("bo");
    expect(leapRisk(state, w, at(8, 6), at(6, 6))).toBe(0.5);
    // With no blow left to strike with, Bo is no risk.
    state.encounter!.reacted.push("bo");
    expect(leapRisk(state, w, at(8, 6), at(6, 6))).toBe(1);
    state.surfaces[posKey(at(6, 6))] = { kind: "fire", rounds: 3 } as ZoneState["surfaces"][string];
    expect(leapRisk(state, w, at(8, 6), at(6, 6))).toBe(0.5);
    // No leap, no risk.
    expect(leapRisk(state, w, at(6, 6), at(6, 6))).toBe(1);
  });

  it("is used by the wolf on its own turn to spring at a hero 3 hexes off", () => {
    let leapt = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { state, wolf } = setUp(at(8, 6));
      state.aiOff = false;
      state.rng = seed;
      const events: ZoneEvent[] = [];
      let s = must(state, { type: "end_turn", by: "ann", unit: "ann" }, events);
      for (let i = 0; i < 4 && !events.some((e) => e.t === "used" && e.id === wolf); i++) s = must(s, { type: "timeout" }, events);
      if (events.some((e) => e.t === "jumped" && e.id === wolf && e.lunge === "ann")) leapt++;
      expect(hexDistance(unit(s, wolf).pos, unit(s, "ann").pos)).toBe(1);
    }
    expect(leapt).toBeGreaterThan(0);
  });
});
