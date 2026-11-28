import { describe, expect, it } from "vitest";
import { makeRng } from "../rng";
import { DRIFT_AHEAD, DRIFT_ASTERN, DRIFT_FAR, LANE, LANE_MS, driftAt, driftField, harpoonHit, leeway, hullStrikes, type Sea, type Steer } from "./drift";
import { SEA_THINGS, SEA_THING_IDS, haulOf } from "./seathings";

const sea: Sea = { seed: "CREWAA|1,1|2,1|try1", ms: 180_000 };
const NONE: Steer[] = [];
/** Moments through the stretch, a second apart. */
const moments = Array.from({ length: 170 }, (_, i) => 3000 + i * 1000);

describe("the drift field", () => {
  it("is the same sea for the same seed at the same moment, and another for another", () => {
    for (const t of moments.slice(0, 20)) expect(driftField(sea, t, NONE)).toEqual(driftField(sea, t, NONE));
    const told = (s: Sea) => moments.slice(0, 40).map((t) => driftField(s, t, NONE).map((d) => `${d.n}${d.kind}`).join(",")).join("|");
    expect(told(sea)).not.toBe(told({ ...sea, seed: "CREWBB|1,1|2,1|try1" }));
  });

  it("brings things in ahead and carries them astern, down either side, never back", () => {
    const seen = new Map<number, number>();
    const sides = new Set<number>();
    for (const t of moments) {
      for (const d of driftField(sea, t, NONE)) {
        expect(d.y).toBeLessThanOrEqual(DRIFT_AHEAD);
        expect(d.y).toBeGreaterThanOrEqual(-DRIFT_ASTERN);
        expect(Math.abs(d.x)).toBeLessThanOrEqual(DRIFT_FAR);
        if (seen.has(d.n)) expect(d.y, `thing ${d.n}`).toBeLessThan(seen.get(d.n)!);
        seen.set(d.n, d.y);
        sides.add(Math.sign(d.x));
        expect(driftAt(sea, d.n, t, NONE)).toEqual(d);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(sides.has(-1) && sides.has(1)).toBe(true);
  });

  it("has every kind of thing in it somewhere, and leaves out what has been taken", () => {
    const kinds = new Set(moments.flatMap((t) => driftField(sea, t, NONE).map((d) => d.kind)));
    expect([...kinds].sort()).toEqual([...SEA_THING_IDS].sort());
    const field = driftField(sea, 30_000, NONE);
    expect(field.length).toBeGreaterThan(2);
    expect(driftField(sea, 30_000, NONE, new Set([field[0].n])).map((d) => d.n)).toEqual(field.slice(1).map((d) => d.n));
  });

  it("stops bringing things in once the stretch is run, and empties", () => {
    expect(driftField(sea, sea.ms + 60_000, NONE)).toEqual([]);
    expect(driftAt(sea, 100_000, sea.ms + 1, NONE)).toBeNull();
  });

  it("slides the whole field the other way when the helm is put over, eased in", () => {
    const steers: Steer[] = [{ at: 20_000, dir: 1 }];
    expect(leeway(steers, 20_000)).toBe(0);
    expect(leeway(steers, 20_000 + LANE_MS / 2)).toBeCloseTo(LANE / 2);
    expect(leeway(steers, 20_000 + LANE_MS)).toBe(LANE);
    expect(leeway([...steers, { at: 40_000, dir: -1 }], 60_000)).toBe(0);
    const [was, now] = [driftField(sea, 30_000, NONE), driftField(sea, 30_000, steers)];
    expect(now.map((d) => d.n)).toEqual(was.map((d) => d.n));
    now.forEach((d, i) => {
      expect(d.x).toBeCloseTo(was[i].x - LANE);
      expect(d.y).toBe(was[i].y);
    });
  });
});

describe("a harpoon", () => {
  const gun = { x: 1.5, y: 2 };
  /** A moment with salvage to starboard of the gun and within reach, and that thing. */
  const target = () => {
    for (const t of moments) {
      const thing = driftField(sea, t, NONE).find((d) => d.kind !== "rock" && d.x > gun.x + 1 && Math.hypot(d.x - gun.x, d.y - gun.y) < 7);
      if (thing) return { t, thing };
    }
    throw new Error("no target");
  };

  it("takes the thing it is aimed at, and nothing when it is aimed wide, short or at nothing", () => {
    const { t, thing } = target();
    const aim = { x: thing.x - gun.x, y: thing.y - gun.y };
    expect(harpoonHit(sea, t, NONE, new Set(), gun, aim, 8)?.n).toBe(thing.n);
    // Any length of aim: only the direction counts.
    expect(harpoonHit(sea, t, NONE, new Set(), gun, { x: aim.x * 40, y: aim.y * 40 }, 8)?.n).toBe(thing.n);
    // Too short a line, the other way, and no aim at all.
    expect(harpoonHit(sea, t, NONE, new Set(), gun, aim, Math.hypot(aim.x, aim.y) - 0.1)).toBeNull();
    expect(harpoonHit(sea, t, NONE, new Set(), gun, { x: -aim.x, y: -aim.y }, 8)?.n).not.toBe(thing.n);
    expect(harpoonHit(sea, t, NONE, new Set(), gun, { x: 0, y: 0 }, 8)).toBeNull();
    // Already aboard: it is not there to hit.
    expect(harpoonHit(sea, t, NONE, new Set([thing.n]), gun, aim, 8)?.n).not.toBe(thing.n);
  });

  it("misses by more than the thing's size, unless the slack allows for it", () => {
    const { t, thing } = target();
    const [dx, dy] = [thing.x - gun.x, thing.y - gun.y];
    const far = Math.hypot(dx, dy);
    const wide = SEA_THINGS[thing.kind].size + 0.3;
    // Aimed at a point `wide` to one side of it.
    const aim = { x: dx + (-dy / far) * wide, y: dy + (dx / far) * wide };
    expect(harpoonHit(sea, t, NONE, new Set(), gun, aim, 9)?.n).not.toBe(thing.n);
    expect(harpoonHit(sea, t, NONE, new Set(), gun, aim, 9, 0.5)?.n).toBe(thing.n);
  });
});

describe("the hull", () => {
  const hull = { half: 1.3, fore: 4, aft: 4 };

  it("is struck by what drifts into it, once each, and steering clear of a rock saves it", () => {
    const all = hullStrikes(sea, 0, sea.ms + 40_000, NONE, hull);
    const rocks = all.filter((d) => d.kind === "rock");
    expect(rocks.length).toBeGreaterThan(0);
    // Counted once however the stretch is cut up.
    const struck = new Set<number>();
    let count = 0;
    for (let t = 0; t < sea.ms + 40_000; t += 6000) {
      const hit = hullStrikes(sea, t, t + 6000, NONE, hull, struck);
      for (const d of hit) struck.add(d.n);
      count += hit.length;
    }
    expect(count).toBe(all.length);
    // Put the helm over, away from the first rock, before it arrives: it passes down the side.
    const rock = rocks[0];
    const when = moments.find((t) => driftAt(sea, rock.n, t, NONE))!;
    const away: Steer[] = [{ at: when, dir: rock.x >= 0 ? -1 : 1 }, { at: when + 100, dir: rock.x >= 0 ? -1 : 1 }];
    expect(hullStrikes(sea, 0, sea.ms + 40_000, away, hull).some((d) => d.n === rock.n)).toBe(false);
  });
});

describe("salvage", () => {
  it("is worth something for everything but a rock, more in gold further out, and never an empty find", () => {
    for (const id of SEA_THING_IDS) {
      const hauls = Array.from({ length: 40 }, (_, i) => haulOf(id, makeRng(i + 1), 1));
      if (id === "rock") {
        expect(hauls.every((h) => h.length === 0)).toBe(true);
        expect(SEA_THINGS[id].hull).toBeGreaterThan(0);
        continue;
      }
      for (const h of hauls) {
        expect(h.length, id).toBeGreaterThan(0);
        for (const s of h) expect(s.n, id).toBeGreaterThan(0);
      }
    }
    const goldOf = (level: number) => Array.from({ length: 60 }, (_, i) => haulOf("barrel", makeRng(i + 1), level)).flat().reduce((n, s) => n + (s.t === "gold" ? s.n : 0), 0);
    expect(goldOf(8)).toBeGreaterThan(goldOf(1) * 1.5);
  });
});
