import { describe, expect, it } from "vitest";
import {
  BONEMEAL_CUT,
  CAN_CAPACITY,
  CROP_GROW_MS,
  cropOf,
  gardenHarvest,
  harvestText,
  CAN_PRICE,
  canBuyProblem,
  fillProblem,
  GARDEN_SPOTS,
  GARDEN_YIELD,
  GROW_MS,
  bedProgress,
  bedStage,
  bedYield,
  feedProblem,
  gardenCorner,
  gardenSpotAt,
  fedReadyAt,
  gardenBeds,
  gardenLooks,
  grindProblem,
  growText,
  nextReady,
  plantProblem,
  readyCount,
  seedBuyProblem,
  waterProblem,
  type GardenBed,
} from "./garden";
import { HUT_TIERS } from "./hut";
import { HARBOR_BUILDINGS, HARBOR_FIXTURES, HARBOR_PLOTS, HARBOR_SIDES, footing, generateHarbor } from "./harbor";
import { tileAt } from "./map";

const T0 = 1_700_000_000_000;
const bed = (over: Partial<GardenBed> = {}): GardenBed => ({ bed: 0, crop: "herbs", plantedAt: T0, readyAt: T0 + GROW_MS, ...over });

describe("garden beds", () => {
  it("has more beds as the hut grows", () => {
    expect(HUT_TIERS.map((t) => gardenBeds(t.tier))).toEqual([2, 3, 4]);
    expect(gardenBeds(0)).toBe(2);
    expect(gardenBeds(9)).toBe(4);
  });

  it("grows through its stages to ready, and stays ready", () => {
    const b = bed();
    expect(bedStage(null, T0)).toBe("empty");
    expect(bedStage(b, T0)).toBe("sown");
    expect(bedStage(b, T0 + GROW_MS * 0.2)).toBe("sprout");
    expect(bedStage(b, T0 + GROW_MS * 0.5)).toBe("young");
    expect(bedStage(b, T0 + GROW_MS * 0.9)).toBe("leafy");
    expect(bedStage(b, T0 + GROW_MS)).toBe("ready");
    expect(bedStage(b, T0 + GROW_MS * 50)).toBe("ready");
    expect(bedProgress(b, T0 + GROW_MS / 2)).toBeCloseTo(0.5);
  });

  it("looks for every bed, empty ones too", () => {
    const looks = gardenLooks([bed({ bed: 1, wateredBy: "Ana" }), bed({ bed: 2, crop: "mushrooms" })], 3, T0 + GROW_MS);
    expect(looks).toEqual([
      { stage: "empty", crop: "herbs", watered: false, fed: false },
      { stage: "ready", crop: "herbs", watered: true, fed: false },
      { stage: "ready", crop: "mushrooms", watered: false, fed: false },
    ]);
  });

  it("knows what is ready and what is next", () => {
    const beds = [bed(), bed({ bed: 1, readyAt: T0 + 1000 })];
    expect(readyCount(beds, T0 + 1000)).toBe(1);
    expect(nextReady(beds, T0 + 1000)).toBe(T0 + GROW_MS);
    expect(nextReady([], T0)).toBeNull();
  });

  it("says how long is left", () => {
    expect(growText(T0 + 30_000, T0)).toBe("under a minute");
    expect(growText(T0 + 40 * 60_000, T0)).toBe("40m");
    expect(growText(T0 + 135 * 60_000, T0)).toBe("2h 15m");
    expect(growText(T0 + 120 * 60_000, T0)).toBe("2h");
  });
});

describe("planting", () => {
  const ctx = { tier: 1, beds: [] as GardenBed[], resources: { seeds: 1, herbs: 0 } };
  it("takes a free bed and something to plant", () => {
    expect(plantProblem(ctx, 0, "seeds")).toBeNull();
    expect(plantProblem(ctx, 2, "seeds")).toMatch(/no such bed/);
    expect(plantProblem(ctx, 1.5, "seeds")).toMatch(/no such bed/);
    expect(plantProblem(ctx, 0, "herbs")).toMatch(/no herbs/);
    expect(plantProblem(ctx, 0, "wood")).toMatch(/seeds, a herb or a mushroom/);
    expect(plantProblem(ctx, 0, "mushrooms")).toMatch(/caverns/);
    expect(plantProblem({ ...ctx, resources: { mushrooms: 1 } }, 0, "mushrooms")).toBeNull();
    expect(plantProblem({ ...ctx, resources: {} }, 0, "seeds")).toMatch(/market stall/);
    expect(plantProblem({ ...ctx, beds: [bed()] }, 0, "seeds")).toMatch(/already growing/);
    expect(plantProblem({ ...ctx, tier: 3 }, 3, "seeds")).toBeNull();
  });

  it("grows herbs from seeds and herbs, and mushrooms from a mushroom, more slowly", () => {
    expect(cropOf("seeds")).toBe("herbs");
    expect(cropOf("herbs")).toBe("herbs");
    expect(cropOf("mushrooms")).toBe("mushrooms");
    expect(CROP_GROW_MS.herbs).toBe(GROW_MS);
    expect(CROP_GROW_MS.mushrooms).toBeGreaterThan(GROW_MS);
  });
});

describe("tending", () => {
  it("waters a growing bed once, from a can with water in it", () => {
    expect(waterProblem(undefined, T0, 1)).toMatch(/Nothing/);
    expect(waterProblem(bed(), T0, 1)).toBeNull();
    expect(waterProblem(bed({ wateredBy: "Ana" }), T0, 1)).toMatch(/Ana/);
    expect(waterProblem(bed(), T0 + GROW_MS, 1)).toMatch(/ready/);
    expect(waterProblem(bed(), T0, null)).toMatch(/market stall/);
    expect(waterProblem(bed(), T0, 0)).toMatch(/well/);
  });

  it("fills a can at the well, and sells one to whoever has none", () => {
    expect(fillProblem(null)).toMatch(/no watering can/);
    expect(fillProblem(0)).toBeNull();
    expect(fillProblem(CAN_CAPACITY)).toMatch(/full/);
    expect(canBuyProblem(null, CAN_PRICE)).toBeNull();
    expect(canBuyProblem(null, CAN_PRICE - 1)).toMatch(/gold/);
    expect(canBuyProblem(0, 999)).toMatch(/already/);
  });

  it("feeds bonemeal once, and it halves the growing left", () => {
    expect(feedProblem(bed(), { bonemeal: 1 }, T0)).toBeNull();
    expect(feedProblem(bed(), {}, T0)).toMatch(/Grind/);
    expect(feedProblem(bed({ fedBy: "Bo" }), { bonemeal: 1 }, T0)).toMatch(/Bo/);
    expect(feedProblem(bed(), { bonemeal: 1 }, T0 + GROW_MS)).toMatch(/ready/);
    expect(fedReadyAt(bed(), T0)).toBe(T0 + GROW_MS * (1 - BONEMEAL_CUT));
    const half = T0 + GROW_MS / 2;
    expect(fedReadyAt(bed(), half)).toBe(half + (GROW_MS / 2) * (1 - BONEMEAL_CUT));
    expect(fedReadyAt(bed(), T0 + GROW_MS * 2)).toBe(T0 + GROW_MS * 2);
  });

  it("grinds only bones you have", () => {
    expect(grindProblem(1, { bone: 1 })).toBeNull();
    expect(grindProblem(2, { bone: 1 })).toMatch(/only 1/);
    expect(grindProblem(1, {})).toMatch(/no bones/);
    expect(grindProblem(0, { bone: 3 })).toMatch(/one bone/);
  });

  it("sells seeds for gold", () => {
    expect(seedBuyProblem(5, 50)).toBeNull();
    expect(seedBuyProblem(5, 49)).toMatch(/gold/);
    expect(seedBuyProblem(0, 100)).toMatch(/between/);
    expect(seedBuyProblem(99, 1000)).toMatch(/between/);
  });
});

describe("picking", () => {
  it("gives the same herbs for the same planting, within the range, one more if watered", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const b = bed({ plantedAt: T0 + i });
      const n = bedYield("p1", b);
      expect(n).toBe(bedYield("p1", b));
      expect(n).toBeGreaterThanOrEqual(GARDEN_YIELD[0]);
      expect(n).toBeLessThanOrEqual(GARDEN_YIELD[1]);
      expect(bedYield("p1", { ...b, wateredBy: "Ana" })).toBe(n + 1);
      seen.add(n);
    }
    expect(seen.size).toBe(GARDEN_YIELD[1] - GARDEN_YIELD[0] + 1);
  });

  it("adds up a pick crop by crop", () => {
    const beds = [bed(), bed({ bed: 1, crop: "mushrooms" }), bed({ bed: 2, crop: "mushrooms", wateredBy: "Ana" })];
    const h = gardenHarvest("p1", beds);
    expect(h.herbs).toBe(bedYield("p1", beds[0]));
    expect(h.mushrooms).toBe(bedYield("p1", beds[1]) + bedYield("p1", beds[2]));
    expect(gardenHarvest("p1", [bed()])).not.toHaveProperty("mushrooms");
    expect(harvestText({ herbs: 3, mushrooms: 1 })).toBe("3 herbs and 1 mushroom");
    expect(harvestText({ herbs: 1 })).toBe("1 herb");
    expect(harvestText({ mushrooms: 4 })).toBe("4 mushrooms");
  });
});

describe("where a garden is tended from", () => {
  const map = generateHarbor();
  const key = (p: { q: number; r: number }) => `${p.q},${p.r}`;
  const taken = new Set([...HARBOR_BUILDINGS.flatMap((b) => [b.door, ...footing(b.door, b.shape, b.facing)]), ...HARBOR_FIXTURES].map(key));
  it("is a hex of its own beside each plot's garden, on open ground", () => {
    expect(GARDEN_SPOTS).toHaveLength(HARBOR_PLOTS.length);
    expect(new Set(GARDEN_SPOTS.map(key)).size).toBe(GARDEN_SPOTS.length);
    GARDEN_SPOTS.forEach((spot, i) => {
      // One of the two hexes that share the garden's corner of the doorstep.
      const c = gardenCorner(i);
      const beside = [(c + 5) % 6, c].map((s) => key({ q: HARBOR_PLOTS[i].q + HARBOR_SIDES[s].q, r: HARBOR_PLOTS[i].r + HARBOR_SIDES[s].r }));
      expect(beside, `plot ${i}`).toContain(key(spot));
      expect(taken.has(key(spot)), `plot ${i}`).toBe(false);
      const tile = tileAt(map, spot);
      expect(tile?.biome, `plot ${i}`).toBe("plains");
      expect(tile?.built || tile?.blocker, `plot ${i}`).toBeFalsy();
      expect(gardenSpotAt(spot)).toBe(i);
    });
  });
});
