import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { BOTTLE_NOTES, COASTAL_PIECES, FLOTSAM_TIDE_MS, JUNK, OPEN_PIECES, SHALLOWS_PIECES, flotsamAt, flotsamFind, flotsamReachProblem, flotsamWithin } from "./flotsam";
import { shoreAt } from "./fishingholes";
import { HARBOR_GATHER, HARBOR_SPAWN, coastal, generateHarbor, harborPath } from "./harbor";
import { FURNISHINGS } from "./hut";
import { tileAt } from "./map";

const MAP = generateHarbor();
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
const tides = (n: number, crew = "CREWAA") => Array.from({ length: n }, (_, i) => flotsamAt(crew, T0 + i * FLOTSAM_TIDE_MS)).flat();

describe("what the tide brings in", () => {
  it("is the same for everyone in a crew all tide, and something else next tide and for another crew", () => {
    const a = flotsamAt("CREWAA", T0);
    expect(flotsamAt("CREWAA", T0 + FLOTSAM_TIDE_MS - 1 - (T0 % FLOTSAM_TIDE_MS))).toEqual(a);
    expect(flotsamAt("CREWAA", T0 + FLOTSAM_TIDE_MS).map((f) => f.id)).not.toEqual(a.map((f) => f.id));
    expect(flotsamAt("CREWBB", T0)).not.toEqual(a);
    for (const f of a) expect(f.until).toBe((Math.floor(T0 / FLOTSAM_TIDE_MS) + 1) * FLOTSAM_TIDE_MS);
  });

  it("floats every piece on the water, apart: some just off the beach, some along the coast for a barrel, one further out for a rowboat", () => {
    for (let i = 0; i < 60; i++) {
      const lot = flotsamAt(`CREW${i}`, T0 + i * FLOTSAM_TIDE_MS);
      expect(lot).toHaveLength(SHALLOWS_PIECES + COASTAL_PIECES + OPEN_PIECES);
      for (const f of lot) expect(tileAt(MAP, f.pos)?.biome).toBe("water");
      const shallows = lot.filter((f) => f.shallows);
      expect(shallows).toHaveLength(SHALLOWS_PIECES);
      // In the shallows: beside open beach that heroes walk to from where they arrive.
      for (const f of shallows) {
        const beach = MAP.tiles.filter((t) => hexDistance(t, f.pos) === 1 && t.biome !== "water" && !t.path && shoreAt(MAP, t));
        expect(beach.some((t) => harborPath(MAP, HARBOR_SPAWN, t) !== null), `${f.id}`).toBe(true);
      }
      // A barrel gets beside all but the one furthest out; a rowboat to every one.
      const out = lot.filter((f) => !coastal(MAP, f.pos));
      expect(out.length).toBeLessThanOrEqual(OPEN_PIECES);
      for (const f of lot.filter((f) => coastal(MAP, f.pos))) expect(harborPath(MAP, HARBOR_GATHER.fishing, f.pos, "barrel"), f.id).not.toBeNull();
      for (const f of lot) expect(harborPath(MAP, HARBOR_GATHER.fishing, f.pos, "rowboat"), f.id).not.toBeNull();
      for (const a of lot) for (const b of lot) if (a !== b) expect(hexDistance(a.pos, b.pos)).toBeGreaterThanOrEqual(3);
    }
  });

  it("brings every kind in time, and every odd and end", () => {
    const all = tides(200);
    for (const kind of ["driftwood", "crate", "bottle", "junk"]) expect(all.some((f) => f.kind === kind), kind).toBe(true);
    const junk = new Set(all.filter((f) => f.kind === "junk").map((f) => f.junk));
    expect(junk.size).toBe(JUNK.length);
  });
});

describe("fishing it out", () => {
  const near = tides(20).find((f) => f.shallows)!;
  const beach = MAP.tiles.find((t) => hexDistance(t, near.pos) === 1 && t.biome !== "water")!;

  it("is from on it or beside it, from the beach or a boat", () => {
    expect(flotsamReachProblem(near, near.pos)).toBeNull();
    expect(flotsamReachProblem(near, beach)).toBeNull();
    expect(flotsamReachProblem(near, { q: near.pos.q + 3, r: near.pos.r })).toMatch(/too far/);
    const other = tides(20).find((f) => hexDistance(f.pos, beach) > 1)!;
    expect(flotsamWithin([other, near], beach)).toBe(near);
    expect(flotsamWithin([other], beach)).toBeNull();
  });
});

describe("what is in it", () => {
  const all = tides(300);

  it("is the same whoever opens it", () => {
    for (const f of all.slice(0, 40)) expect(flotsamFind("CREWAA", f)).toEqual(flotsamFind("CREWAA", f));
  });

  it("gives wood for driftwood, ship's stores for a crate (decor now and then), and a note for a bottle (coins now and then)", () => {
    const finds = all.map((f) => ({ f, find: flotsamFind("CREWAA", f) }));
    for (const { f, find } of finds) {
      const units = Object.values(find.resources).reduce((a, n) => a + (n ?? 0), 0);
      if (f.kind === "driftwood") (expect(find.resources.wood).toBeGreaterThanOrEqual(2), expect(find.resources.wood).toBeLessThanOrEqual(4));
      if (f.kind === "crate") (expect(units).toBeGreaterThanOrEqual(3), expect(units).toBeLessThanOrEqual(5));
      if (f.kind === "bottle") (expect(BOTTLE_NOTES).toContain(find.note), expect(units).toBe(0));
      if (f.kind === "junk") expect(units + find.gold).toBeGreaterThan(0);
      if (find.furnishing) expect(FURNISHINGS[find.furnishing]).toBeTruthy();
      expect(find.line.length).toBeGreaterThan(0);
    }
    expect(finds.some(({ f, find }) => f.kind === "crate" && find.furnishing)).toBe(true);
    expect(finds.some(({ f, find }) => f.kind === "bottle" && find.gold > 0)).toBe(true);
  });

  it("has notes worth reading: all different, none empty or long-winded", () => {
    expect(new Set(BOTTLE_NOTES).size).toBe(BOTTLE_NOTES.length);
    for (const n of BOTTLE_NOTES) (expect(n.trim().length).toBeGreaterThan(10), expect(n.length).toBeLessThan(160));
  });
});
