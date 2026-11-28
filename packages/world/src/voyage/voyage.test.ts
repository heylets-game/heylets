import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { createZone, standInHero, stepZone, zoneCleared, zoneOptions } from "../zone";
import { nextTick } from "../zone/clock";
import type { ZoneAction, ZoneEffect, ZoneEvent, ZoneState } from "../zone/types";
import { must, fails, unit } from "../test/zoneBoard";
import { driftField } from "./drift";
import { BOARDINGS, DECK_MARGIN, STATIONS, VOYAGE_TAIL_MS, deckGrid, holdShare, lanesOver, onDeck, seaOf, shipFrame, stationsOn, type VoyageOptions } from "./voyage";

const SLOOP: VoyageOptions = { deck: { cols: 3, rows: 8 }, hull: 60, hold: 8, ms: 60_000 };
const T0 = 1_000_000;

/** A sloop at sea with Ann aboard, the clock started. */
function atSea(v: VoyageOptions = SLOOP, seed = "voyage-seed"): ZoneState {
  let state = createZone("SEA1", seed, zoneOptions({ party: 1, level: 2, voyage: v }));
  state = must(state, { type: "join", hero: standInHero("refactor_rogue", "ann", 3)! });
  return must(state, { type: "time", now: T0 });
}
/** Sail on to so long after the start, a few seconds at a time as the room would tell it. */
function sailTo(state: ZoneState, ms: number, sink: ZoneEvent[] = [], paid: ZoneEffect[] = []): ZoneState {
  while (state.voyage!.now! < T0 + ms && !state.encounter && !state.voyage!.outcome) state = must(state, { type: "time", now: Math.min(T0 + ms, state.voyage!.now! + 3000) }, sink, paid);
  return state;
}
const walkTo = (state: ZoneState, to: { q: number; r: number }) => (hexDistance(unit(state, "ann").pos, to) === 0 ? state : must(state, { type: "move", by: "ann", unit: "ann", to }));

describe("a ship's deck", () => {
  it("is planks with the sea all round, the hero aboard at the stern, and nothing to fight", () => {
    const state = atSea();
    const grid = deckGrid(SLOOP);
    expect(state.map.grid).toEqual(grid);
    const deck = state.map.tiles.filter((t) => t.biome === "dock");
    expect(deck).toHaveLength(SLOOP.deck.cols * SLOOP.deck.rows);
    expect(state.map.tiles.every((t) => t.biome === "dock" || t.biome === "water")).toBe(true);
    for (const t of deck) expect(onDeck(SLOOP, t)).toBe(true);
    expect(onDeck(SLOOP, unit(state, "ann").pos)).toBe(true);
    expect(unit(state, "ann").pos.r).toBeGreaterThan(DECK_MARGIN + SLOOP.deck.rows / 2);
    expect(state.units.filter((u) => u.side === "enemy")).toEqual([]);
    // A quiet deck is not a cleared map: the stretch has to be sailed.
    expect(zoneCleared(state)).toBe(false);
    expect(state.voyage).toMatchObject({ t: 0, hull: 60, hullMax: 60, holdMax: 8, hold: [] });
  });

  it("has a harpoon gun each side by the bow and the helm at the stern, all on the deck, and frames them by the ship", () => {
    const stations = stationsOn(SLOOP);
    expect(stations.map((s) => s.kind).sort()).toEqual(["harpoon", "harpoon", "helm"]);
    for (const s of stations) expect(onDeck(SLOOP, s.pos), s.id).toBe(true);
    const [port, star, helm] = ["harpoon-port", "harpoon-starboard", "helm"].map((id) => shipFrame(SLOOP, stations.find((s) => s.id === id)!.pos));
    expect(port.x).toBeLessThan(0);
    expect(star.x).toBeGreaterThan(0);
    expect(port.y).toBeGreaterThan(1);
    expect(helm.y).toBeLessThan(-1);
    expect(Math.abs(helm.x)).toBeLessThan(0.6);
  });

  it("keeps the clock running while she sails, and time at sea with it", () => {
    let state = atSea();
    expect(nextTick(state)).toBe(T0 + 3000);
    state = must(state, { type: "time", now: T0 + 3000 });
    expect(state.voyage!.t).toBe(3000);
    // A map left alone has not sailed on without its crew.
    state = must(state, { type: "time", now: T0 + 3000 + 600_000 });
    expect(state.voyage!.t).toBeLessThan(20_000);
  });
});

describe("the helm", () => {
  it("is worked from beside it, a lane at a time, no further than she will go, and not again until she has come round", () => {
    let state = atSea();
    const helm = stationsOn(SLOOP).find((s) => s.kind === "helm")!;
    const bow = stationsOn(SLOOP).find((s) => s.id === "harpoon-port")!;
    state = walkTo(state, bow.pos);
    expect(fails(state, { type: "steer", by: "ann", unit: "ann", dir: 1 })).toMatch(/Stand at the helm/);
    state = walkTo(state, helm.pos);
    const events: ZoneEvent[] = [];
    state = must(state, { type: "steer", by: "ann", unit: "ann", dir: 1 }, events);
    expect(events).toContainEqual({ t: "steered", id: "ann", dir: 1 });
    expect(lanesOver(state.voyage!)).toBe(1);
    expect(fails(state, { type: "steer", by: "ann", unit: "ann", dir: 1 })).toMatch(/coming round/);
    state = sailTo(state, 6000);
    state = must(state, { type: "steer", by: "ann", unit: "ann", dir: 1 });
    state = sailTo(state, 12_000);
    expect(fails(state, { type: "steer", by: "ann", unit: "ann", dir: 1 })).toMatch(/as far to starboard/);
    state = must(state, { type: "steer", by: "ann", unit: "ann", dir: -1 });
    expect(lanesOver(state.voyage!)).toBe(1);
  });
});

describe("a harpoon gun", () => {
  /** Sail until salvage one line will bring in lies within the starboard gun's reach, with Ann at the gun; and that thing, in the ship's frame. */
  function inReach(): { state: ZoneState; gun: { x: number; y: number }; thing: { n: number; x: number; y: number; kind: string } } {
    const station = stationsOn(SLOOP).find((s) => s.id === "harpoon-starboard")!;
    const gun = shipFrame(SLOOP, station.pos);
    let state = walkTo(atSea({ ...SLOOP, ms: 120_000 }), station.pos);
    for (let ms = 3000; ms < 110_000; ms += 1000) {
      state = sailTo(state, ms);
      if (state.encounter) break;
      const v = state.voyage!;
      const thing = driftField(seaOf(state.seed, v), v.t, v.steers, new Set(v.taken)).find((d) => (d.kind === "driftwood" || d.kind === "crate" || d.kind === "barrel") && d.x > gun.x + 0.5 && Math.hypot(d.x - gun.x, d.y - gun.y) < STATIONS.harpoon.reach! - 0.5);
      if (thing) return { state, gun, thing };
    }
    throw new Error("nothing came within reach before the boarders did");
  }

  it("hauls aboard what it is aimed at, into the hold, and is a while being hauled in", () => {
    const { state: before, gun, thing } = inReach();
    const events: ZoneEvent[] = [];
    const aim = { x: thing.x - gun.x, y: thing.y - gun.y };
    const state = must(before, { type: "harpoon", by: "ann", unit: "ann", station: "harpoon-starboard", aim }, events);
    const shot = events.find((e) => e.t === "harpooned")!;
    expect(shot).toMatchObject({ id: "ann", station: "harpoon-starboard", n: thing.n, kind: thing.kind });
    expect(shot.t === "harpooned" && shot.haul!.length).toBeGreaterThan(0);
    expect(state.voyage!.hold).toHaveLength(1);
    expect(state.voyage!.taken).toEqual([thing.n]);
    // It is gone from the sea, and the gun is not ready again at once.
    const v = state.voyage!;
    expect(driftField(seaOf(state.seed, v), v.t, v.steers, new Set(v.taken)).some((d) => d.n === thing.n)).toBe(false);
    expect(fails(state, { type: "harpoon", by: "ann", unit: "ann", station: "harpoon-starboard", aim })).toMatch(/hauled in/);
  });

  it("misses when aimed at open water, will not fire across the deck, and wants its gunner beside it", () => {
    const { state: before, gun, thing } = inReach();
    const events: ZoneEvent[] = [];
    // Straight up into the sky of the frame: nothing lies dead abeam at that range by chance here.
    const wide = { x: thing.x - gun.x, y: thing.y - gun.y + 6 };
    const state = must(before, { type: "harpoon", by: "ann", unit: "ann", station: "harpoon-starboard", aim: wide }, events);
    const shot = events.find((e) => e.t === "harpooned")!;
    expect(shot.t === "harpooned" && shot.n === thing.n).toBe(false);
    expect(state.voyage!.taken).not.toContain(thing.n);
    expect(fails(before, { type: "harpoon", by: "ann", unit: "ann", station: "harpoon-starboard", aim: { x: -3, y: 1 } })).toMatch(/does not bear/);
    expect(fails(before, { type: "harpoon", by: "ann", unit: "ann", station: "harpoon-port", aim: { x: -3, y: 1 } })).toMatch(/Stand at the harpoon gun/);
    expect(fails(before, { type: "harpoon", by: "ann", unit: "ann", station: "helm", aim: { x: 3, y: 1 } })).toMatch(/no such station/);
  });
});

describe("the stretch", () => {
  it("brings boarders over the rail at its set moments, and holds the ship fast while they are fought", () => {
    const events: ZoneEvent[] = [];
    const state = sailTo(atSea(), 60_000, events);
    expect(state.encounter).not.toBeNull();
    const came = events.find((e) => e.t === "boarded")!;
    expect(came.t === "boarded" && came.units.length).toBeGreaterThan(0);
    const boarders = state.units.filter((u) => u.side === "enemy");
    for (const b of boarders) expect(onDeck(SLOOP, b.pos), b.id).toBe(true);
    expect(state.voyage!.t).toBeGreaterThanOrEqual(BOARDINGS[0] * SLOOP.ms!);
    expect(state.voyage!.t).toBeLessThan(BOARDINGS[0] * SLOOP.ms! + 3001);
    // Time at sea stands still while the fight is on, and nothing can be worked.
    const held = must(state, { type: "time", now: state.voyage!.now! + 30_000 });
    expect(held.voyage!.t).toBe(state.voyage!.t);
    expect(fails(state, { type: "steer", by: "ann", unit: "ann", dir: 1 })).toMatch(/boarders/);
  });

  /** The same voyage, with every boarder struck from the deck as soon as they come: sailed to its end. */
  function sailedThrough(v: VoyageOptions, sink: ZoneEvent[], paid: ZoneEffect[]): ZoneState {
    let state = atSea(v);
    for (let guard = 0; guard < 400 && !state.voyage!.outcome; guard++) {
      if (state.encounter) {
        const step = stepZone(state, { type: "dev", by: "ann", dev: { op: "clear_enemies" } } as ZoneAction);
        if (!step.ok) throw new Error(step.error);
        state = step.state;
        continue;
      }
      state = must(state, { type: "time", now: state.voyage!.now! + 3000 }, sink, paid);
    }
    return state;
  }

  it("is sailed through once the sea has no more to bring and the deck is clear: the map is cleared and the hold shared out", () => {
    const events: ZoneEvent[] = [];
    const paid: ZoneEffect[] = [];
    // A hull that will take whatever this sea throws at it.
    const state = sailedThrough({ ...SLOOP, hull: 1000 }, events, paid);
    expect(state.voyage!.outcome).toBe("through");
    expect(state.voyage!.t).toBeGreaterThanOrEqual(SLOOP.ms! + VOYAGE_TAIL_MS);
    expect(zoneCleared(state)).toBe(true);
    expect(events).toContainEqual({ t: "voyage_over", outcome: "through" });
    const grant = paid.find((e) => e.type === "grant" && e.heroId === "ann")!;
    expect(grant.xp).toBeGreaterThan(0);
    // The clock has nothing more to run for.
    expect(nextTick(state)).toBeNull();
  });

  it("shares a hold out so that nobody is handed nothing of something", () => {
    const hold = [[{ t: "res" as const, kind: "wood" as const, n: 5 }, { t: "gold" as const, n: 9 }], [{ t: "res" as const, kind: "wood" as const, n: 2 }, { t: "res" as const, kind: "gem" as const, n: 1 }]];
    expect(holdShare({ hold }, 1)).toEqual({ gold: 9, resources: { wood: 7, gem: 1 } });
    expect(holdShare({ hold }, 3)).toEqual({ gold: 3, resources: { wood: 3, gem: 1 } });
    expect(holdShare({ hold: [] }, 2)).toEqual({ gold: 0, resources: {} });
  });

  it("sinks her when the hull gives: the hold is lost, the map is not cleared, and nothing more can be worked", () => {
    const events: ZoneEvent[] = [];
    const paid: ZoneEffect[] = [];
    // A hull one rock will hole, on a long sea.
    const state = sailedThrough({ ...SLOOP, hull: 10, sound: 5, ms: 400_000 }, events, paid);
    expect(state.voyage).toMatchObject({ outcome: "sunk", hull: 0, hold: [] });
    expect(events.some((e) => e.t === "hull_struck")).toBe(true);
    expect(events).toContainEqual({ t: "voyage_over", outcome: "sunk" });
    expect(zoneCleared(state)).toBe(false);
    expect(paid).toEqual([]);
    expect(fails(state, { type: "steer", by: "ann", unit: "ann", dir: 1 })).toMatch(/over|helm/);
  });
});
