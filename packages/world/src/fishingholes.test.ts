import { describe, expect, it } from "vitest";
import { hexDistance, type HexPos } from "@gantt-quest/core";
import { FISH } from "./fishcatalog";
import { BAITS, BAIT_IDS, baitWeight, rollCatch, type BaitId } from "./fishing";
import { FAR_HOLES, HOLE_SLOT_MS, NEAR_HOLES, bestHole, fishFrom, fishingHoles, holeAt, shoreAt, type FishingHole } from "./fishingholes";
import { GAME_DAY_MS, WEATHER_SPELL_MS, harborSky, stormAt, weatherAt } from "./gameclock";
import { stepGather, type GatherState } from "./gather";
import { HARBOR_GATHER, HARBOR_PIERS, HARBOR_ROCKS, HARBOR_SIDES, HARBOR_SPAWN, HARBOR_WRECK, generateHarbor } from "./harbor";
import { tileAt } from "./map";
import { makeRng } from "./rng";
import { startSitting, type CaughtFish } from "./sitting";

const CREW = "CREWAA";
const harbor = generateHarbor();
/** A game day starting at a whole number of days on the clock: its midnight. */
const DAY0 = 2_900_000 * GAME_DAY_MS;
const around = (p: HexPos) => HARBOR_SIDES.map((d) => ({ q: p.q + d.q, r: p.r + d.r }));
const water = (p: HexPos) => tileAt(harbor, p)?.biome === "water";

/** The first moment from `from`, stepping by `step`, where `ok` holds. */
function find(ok: (now: number) => boolean, from = DAY0, step = HOLE_SLOT_MS / 3, tries = 20_000): number {
  for (let i = 0; i < tries; i++) if (ok(from + i * step)) return from + i * step;
  throw new Error("Never found.");
}

describe("the weather", () => {
  it("is what the sky always drew: the same spells, the same blend, wetter in a port", () => {
    // The formula the sky used before it moved into the rules, for a port with streets.
    const hash = (a: number, b: number, salt: number) => {
      const n = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
      return n - Math.floor(n);
    };
    for (const now of [DAY0, DAY0 + 123_456, DAY0 + 3 * WEATHER_SPELL_MS + 1000]) {
      const spell = Math.floor(now / WEATHER_SPELL_MS);
      const held = (now / WEATHER_SPELL_MS - spell) < 0.7;
      if (held) expect(weatherAt(now)).toBeCloseTo(Math.max(0, Math.min(1, hash(spell, 7, 700) + 0.12)), 10);
      expect(weatherAt(now, false)).toBeLessThanOrEqual(weatherAt(now, true));
      expect([0, 1]).toContain(held ? stormAt(now) : 0);
    }
  });

  it("brings a storm now and then, and not most of the time", () => {
    let storms = 0;
    for (let i = 0; i < 400; i++) if (harborSky(DAY0 + i * WEATHER_SPELL_MS).storm) storms++;
    expect(storms).toBeGreaterThan(5);
    expect(storms).toBeLessThan(200);
  });
});

describe("fishing from the shore", () => {
  it("can be done from any hex of land a hero can walk to with water beside it", () => {
    const shore = harbor.tiles.filter((t) => shoreAt(harbor, t));
    expect(shore.length).toBeGreaterThan(60);
    for (const t of shore) expect(around(t).some(water)).toBe(true);
    // Most of them are not one of the old fixed spots, and every one fishes from somewhere.
    expect(shore.filter((t) => fishFrom(harbor, t, null) === "shore").length).toBeGreaterThan(shore.length - 5);
  });

  it("keeps the pier heads as they were, and nowhere inland", () => {
    expect(fishFrom(harbor, HARBOR_PIERS[0], null)).toBe("west");
    expect(fishFrom(harbor, HARBOR_PIERS[2], null)).toBe("east");
    expect(fishFrom(harbor, HARBOR_GATHER.fishing, null)).toBe("shore");
    expect(fishFrom(harbor, HARBOR_SPAWN, null)).toBeNull();
  });

  it("needs a boat on the water", () => {
    const sea = harbor.tiles.find((t) => t.biome === "water" && around(t).some((n) => tileAt(harbor, n) && !water(n)))!;
    expect(fishFrom(harbor, sea, null)).toBeNull();
    expect(fishFrom(harbor, sea, "barrel")).not.toBeNull();
  });
});

describe("fishing holes", () => {
  const now = DAY0 + 0.4 * GAME_DAY_MS;

  it("are the same for everyone in a crew, and different for another crew", () => {
    expect(fishingHoles(CREW, now)).toEqual(fishingHoles(CREW, now));
    expect(fishingHoles(CREW, now).map((h) => h.pos)).not.toEqual(fishingHoles("CREWBB", now).map((h) => h.pos));
  });

  it("stay put through half the day, then move", () => {
    const slot = Math.floor(now / HOLE_SLOT_MS) * HOLE_SLOT_MS;
    const here = fishingHoles(CREW, slot).map((h) => h.pos);
    expect(fishingHoles(CREW, slot + HOLE_SLOT_MS - 1).map((h) => h.pos)).toEqual(here);
    expect(fishingHoles(CREW, slot + HOLE_SLOT_MS).map((h) => h.pos)).not.toEqual(here);
    expect(fishingHoles(CREW, slot)[0].until).toBe(slot + HOLE_SLOT_MS);
  });

  it("lie only on open water, apart, some by the shore and some out of reach of it", () => {
    const hazards = [...HARBOR_ROCKS, HARBOR_WRECK];
    for (let i = 0; i < 40; i++) {
      const holes = fishingHoles(CREW, DAY0 + i * HOLE_SLOT_MS);
      expect(holes).toHaveLength(NEAR_HOLES + FAR_HOLES);
      for (const h of holes) {
        expect(water(h.pos)).toBe(true);
        expect(hazards.some((p) => p.q === h.pos.q && p.r === h.pos.r)).toBe(false);
        // Close in, there is somewhere to stand and cast at it; further out, only a boat gets there.
        expect(around(h.pos).some((p) => shoreAt(harbor, p))).toBe(h.near);
        for (const o of holes) if (o !== h) expect(hexDistance(o.pos, h.pos)).toBeGreaterThanOrEqual(4);
      }
      expect(holes.filter((h) => h.near)).toHaveLength(NEAR_HOLES);
    }
  });

  it("are each known for fish of their own water that bite under this sky, and bite more often there", () => {
    for (let i = 0; i < 40; i++) {
      const t = DAY0 + i * HOLE_SLOT_MS * 0.7;
      const sky = harborSky(t);
      for (const h of fishingHoles(CREW, t)) {
        expect(h.featured.length).toBeGreaterThan(0);
        expect(h.where).toMatch(/^(off|out past) the /);
        for (const id of h.featured) {
          const f = FISH[id];
          expect(f.water).toContain(h.water);
          expect(h.bonus[id]).toBeGreaterThan(1);
          if (f.night) expect(sky.night).toBe(true);
          if (f.storm) expect(sky.storm).toBe(true);
        }
      }
    }
  });

  it("turn one close in to night feeders after dark, and none by day", () => {
    const night = find((t) => harborSky(t).night);
    const day = find((t) => !harborSky(t).night);
    const dark = fishingHoles(CREW, night).filter((h) => h.kind === "night");
    expect(dark).toHaveLength(1);
    expect(dark[0].near).toBe(true);
    expect(dark[0].featured.some((id) => FISH[id].night)).toBe(true);
    expect(fishingHoles(CREW, day).some((h) => h.kind === "night")).toBe(false);
  });

  it("churn one far out in a storm, where storm fish bite", () => {
    const storm = find((t) => harborSky(t).storm, DAY0, WEATHER_SPELL_MS / 2);
    const churned = fishingHoles(CREW, storm).filter((h) => h.kind === "storm");
    expect(churned).toHaveLength(1);
    expect(churned[0].near).toBe(false);
    expect(churned[0].featured.some((id) => FISH[id].storm)).toBe(true);
  });

  it("name the best one, close in or anywhere", () => {
    const holes = fishingHoles(CREW, now);
    const best = bestHole(CREW, now);
    expect(best.worth).toBe(Math.max(...holes.map((h) => h.worth)));
    expect(bestHole(CREW, now, true).near).toBe(true);
  });

  it("are fished from beside them or on top of them", () => {
    const h = fishingHoles(CREW, now).find((x) => x.near)!;
    const stand = around(h.pos).find((p) => shoreAt(harbor, p))!;
    expect(holeAt(CREW, now, stand)?.id).toBe(h.id);
    expect(holeAt(CREW, now, h.pos)?.id).toBe(h.id);
    expect(holeAt(CREW, now, HARBOR_SPAWN)).toBeNull();
  });
});

describe("night and storm fish", () => {
  const roll = (n: number, sky: { night: boolean; storm: boolean }, water: "deep" | "sea", bonus: Record<string, number>) => {
    const rng = makeRng(42);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) seen.add(rollCatch(rng, water, 1, bonus, sky).id);
    return seen;
  };

  it("bite only under their own sky", () => {
    expect(roll(4000, { night: false, storm: false }, "deep", { lampjaw: 50 }).has("lampjaw")).toBe(false);
    expect(roll(4000, { night: true, storm: false }, "deep", { lampjaw: 50 }).has("lampjaw")).toBe(true);
    expect(roll(4000, { night: false, storm: false }, "sea", { oarfish: 50 }).has("oarfish")).toBe(false);
    expect(roll(4000, { night: false, storm: true }, "sea", { oarfish: 50 }).has("oarfish")).toBe(true);
  });

  it("stay away by default", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 3000; i++) expect(FISH[rollCatch(rng, "deep", 1).id].night).toBeFalsy();
  });
});

describe("a cast at a hole", () => {
  it("fishes the hole's water from the shore beside it", () => {
    // A hole close in whose water is not the shore's own shallows, and somewhere to stand beside it.
    const t = find((x) => fishingHoles(CREW, x).some((h) => h.near && h.water !== "shallows"));
    const hole = fishingHoles(CREW, t).find((h) => h.near && h.water !== "shallows") as FishingHole;
    const stand = around(hole.pos).find((p) => shoreAt(harbor, p))!;
    let state: GatherState = startSitting("shore", 9, { str: 9, dex: 9 }, t);
    for (let i = 0; i < 40; i++) {
      const r = stepGather(state, { t: "cast", power: 0.8, spot: "shore", now: t + i, at: stand, crew: CREW });
      if (r.error) throw new Error(r.error);
      state = r.state;
      const species = FISH[state.sitting!.cast!.fish.species];
      expect(species.water).toContain(hole.water);
      // A full cast reaches the hole, though the shore's own casts are short.
      expect(state.sitting!.cast!.metres).toBeGreaterThan(20);
    }
  });
});

describe("bait", () => {
  it("changes only which fish bite, never the hauls, and the glow lure only after dark", () => {
    expect(baitWeight(FISH.boot, "shrimp", false)).toBe(1);
    expect(baitWeight(FISH.sea_bass, "worms", false)).toBeGreaterThan(1);
    expect(baitWeight(FISH.mackerel, "worms", false)).toBeLessThan(1);
    expect(baitWeight(FISH.halibut, "shrimp", false)).toBeGreaterThan(1);
    expect(baitWeight(FISH.lampjaw, "glow_lure", false)).toBe(1);
    expect(baitWeight(FISH.lampjaw, "glow_lure", true)).toBeGreaterThan(baitWeight(FISH.halibut, "glow_lure", true));
    expect(baitWeight(FISH.halibut, null, true)).toBe(1);
  });

  it("works best at the kind of hole it suits", () => {
    // Over many short spells at real holes, the bait that suits a kind of hole brings up the most of what the hole
    // is known for there (and, at night feeders, the most of the big night fish).
    const holes = Array.from({ length: 600 }, (_, i) => fishingHoles(`CREW${i % 40}`, DAY0 + i * HOLE_SLOT_MS * 0.37)).flat();
    const featured = (kind: string, bait: BaitId) => {
      const rng = makeRng(11);
      let n = 0;
      for (const h of holes.filter((x) => x.kind === kind).slice(0, 200)) {
        const sky = { night: h.kind === "night", storm: h.kind === "storm" };
        for (let i = 0; i < 40; i++) {
          const f = rollCatch(rng, h.water, 1, h.bonus, sky, bait);
          if (kind === "night" ? f.night || f.rarity === "legendary" : h.featured.includes(f.id)) n++;
        }
      }
      return n;
    };
    for (const kind of ["shoal", "deep", "night"] as const) {
      const suited = BAIT_IDS.find((b) => BAITS[b].suits === kind)!;
      for (const other of BAIT_IDS.filter((b) => b !== suited)) expect(featured(kind, suited)).toBeGreaterThan(featured(kind, other));
    }
  });
});

describe("a full basket", () => {
  it("keeps the sitting going: what more is kept goes to the quay, and the basket weighs no more", () => {
    let state: GatherState = startSitting("east", 5, { str: 0, dex: 9 }, DAY0);
    // A basket filled to the brim, and a fish landed and waiting.
    const fish: CaughtFish = { species: "halibut", grams: 9000, mm: 900, specimen: false, spot: "east", at: DAY0 };
    state = { ...state, sitting: { ...state.sitting!, creelGrams: state.sitting!.creelLimitG, pending: fish } };
    const r = stepGather(state, { t: "keep", now: DAY0 + 1000 });
    expect(r.error).toBeUndefined();
    expect(r.state.status).toBe("active");
    expect(r.state.sitting!.creelGrams).toBe(state.sitting!.creelLimitG);
    expect(r.state.sitting!.landed.at(-1)).toMatchObject({ species: "halibut", kept: true, overflow: true });
  });

  it("still takes the one that fills it, however big", () => {
    let state: GatherState = startSitting("east", 5, { str: 0, dex: 9 }, DAY0);
    const fish: CaughtFish = { species: "halibut", grams: 90_000, mm: 2000, specimen: true, spot: "east", at: DAY0 };
    state = { ...state, sitting: { ...state.sitting!, pending: fish } };
    const r = stepGather(state, { t: "keep", now: DAY0 + 1000 });
    expect(r.state.status).toBe("active");
    expect(r.state.sitting!.creelGrams).toBe(90_000);
    expect(r.state.sitting!.landed.at(-1)!.overflow).toBeUndefined();
  });
});
