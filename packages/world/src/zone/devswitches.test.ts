import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy, standHero, unit } from "../test/zoneBoard";
import { makeRng } from "../rng";
import { damage, type Ctx } from "./engine";
import type { ZoneEvent } from "./types";
import { zoneIdleTurn } from "./zone";

// The Maps tab's dev switches: heroes who cannot go down, and clearing every enemy off the map.

function board() {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 } });
  state.aiOff = true;
  standHero(state, "ann", at(5, 6), { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} });
  enemy(state, "wolf", at(6, 6));
  enemy(state, "bandit", at(12, 6));
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return state;
}

const hurt = (state: ReturnType<typeof board>, amount: number) => {
  const ctx: Ctx = { state: structuredClone(state), rng: makeRng(1), events: [], effects: [] };
  damage(ctx, unit(ctx.state, "ann"), amount, { actor: null, what: "test" });
  return ctx;
};

describe("dev switches", () => {
  it("clearing the ground takes the bodies and everything left to loot too", () => {
    let state = board();
    state = must(state, { type: "dev", by: "ann", dev: { op: "end_fight" } });
    expect(state.loot?.some((s) => s.kind === "body")).toBe(true);
    state.loot!.push({ id: "spoils", kind: "spoils", name: "The spoils", pos: at(3, 6), loot: {} });
    const after = must(state, { type: "dev", by: "ann", dev: { op: "clear_surfaces" } });
    expect(after.loot ?? []).toEqual([]);
  });

  it("a hero goes down at 0 HP as ever with the switch off", () => {
    const ctx = hurt(board(), 999);
    expect(unit(ctx.state, "ann").down).toBe(true);
  });

  it("keeps a hero on their feet at 0 HP while heroes cannot die", () => {
    const state = must(board(), { type: "dev", by: "ann", dev: { op: "undying", on: true } });
    expect(state.undying).toBe(true);
    const ctx = hurt(state, 999);
    expect(unit(ctx.state, "ann")).toMatchObject({ hp: 0, down: false });
    // The blow still counts in full, though there was less HP to take.
    expect(ctx.events.find((e) => e.t === "hit")).toMatchObject({ amount: 999 });
    // And again at 0: still hit for the whole of it, still standing.
    const again = hurt(ctx.state, 7);
    expect(again.events.find((e) => e.t === "hit")).toMatchObject({ amount: 7 });
    expect(unit(again.state, "ann")).toMatchObject({ hp: 0, down: false });
    expect(ctx.events.some((e) => e.t === "down")).toBe(false);
    expect(must(state, { type: "dev", by: "ann", dev: { op: "undying", on: false } }).undying).toBeUndefined();
  });

  it("sets and clears the turn timer switch", () => {
    const off = must(board(), { type: "dev", by: "ann", dev: { op: "timer", off: true } });
    expect(off.timerOff).toBe(true);
    expect(must(off, { type: "dev", by: "ann", dev: { op: "timer", off: false } }).timerOff).toBeUndefined();
  });

  it("passes the heroes' turns over while heroes take no turns, a round at a time", () => {
    let state = board();
    state.aiOff = false;
    state.undying = true;
    // Ann's turn, if it is hers now, ends with the switch.
    const events: ZoneEvent[] = [];
    const round = state.encounter!.round;
    state = must(state, { type: "dev", by: "ann", dev: { op: "heroes_idle", on: true } }, events);
    expect(state.heroesIdle).toBe(true);
    const enc = state.encounter!;
    // The wolf played: it bit her, and it is her turn again only in the next round, waiting for the server to end it.
    expect(events.some((e) => e.t === "hit")).toBe(true);
    expect(enc.round).toBe(round + 1);
    expect(enc.acting).toEqual(["ann"]);
    expect(enc.done).toEqual([]);
    expect(zoneIdleTurn(state)).toBe(true);
    // Ending it (the server's timeout) plays one round more.
    const again = must(state, { type: "timeout" });
    expect(again.encounter!.round).toBe(round + 2);
    expect(again.encounter!.acting).toEqual(["ann"]);
    expect(must(state, { type: "dev", by: "ann", dev: { op: "heroes_idle", on: false } }).heroesIdle).toBeUndefined();
  });

  it("leaves a hero's turn waiting with heroes taking no turns while the enemy takes none either", () => {
    let state = must(board(), { type: "dev", by: "ann", dev: { op: "heroes_idle", on: true } });
    const enc = state.encounter!;
    if (enc.acting[0] !== "ann") state = must(state, { type: "dev", by: "ann", dev: { op: "next_turn" } });
    expect(state.encounter!.acting).toEqual(["ann"]);
    expect(state.encounter!.done).toEqual([]);
    expect(zoneIdleTurn(state)).toBe(false);
  });

  it("takes every enemy off the map, ending the fight they were in, with no bodies", () => {
    const state = board();
    expect(state.encounter).not.toBeNull();
    const after = must(state, { type: "dev", by: "ann", dev: { op: "clear_enemies" } });
    expect(after.units.filter((u) => u.side === "enemy")).toEqual([]);
    expect(after.encounter).toBeNull();
    expect(Object.keys(after.groups)).toEqual([]);
    expect(after.loot ?? []).toEqual([]);
    expect(unit(after, "ann").down).toBe(false);
  });
});
