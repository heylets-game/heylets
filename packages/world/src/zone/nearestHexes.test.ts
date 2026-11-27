import { describe, expect, it } from "vitest";
import { hexDistance, posKey, type HexPos } from "@gantt-quest/core";
import { at, flatBoard } from "../test/zoneBoard";
import { leanWithin, nearestHexes } from "./geometry";
import { clusterHexes } from "./weather";

const board = flatBoard({ rng: 1, start: at(1, 1) });
const aimed = at(6, 6);
/** Spots all over the hex aimed at: rings out from its middle, round and round. */
const spots = Array.from({ length: 9 }, (_, i) => (i + 1) * 0.06).flatMap((d) => Array.from({ length: 48 }, (_, k) => ({ q: d * Math.cos((k * Math.PI) / 24), r: d * Math.sin((k * Math.PI) / 24) })));
const touching = (hexes: HexPos[]) => hexes.flatMap((a, i) => hexes.slice(i + 1).map((b) => hexDistance(a, b) === 1)).filter(Boolean).length;

describe("nearestHexes: a clump laid where the pointer is", () => {
  it("is always a triangle for three, always the hex aimed at among them", () => {
    for (const lean of spots) {
      const hexes = nearestHexes(board.map, aimed, lean, 3);
      expect(hexes.some((p) => hexDistance(p, aimed) === 0)).toBe(true);
      expect(touching(hexes)).toBe(3);
    }
  });

  it("is always a diamond for four: two touching all three others, two touching two", () => {
    for (const lean of spots) {
      const hexes = nearestHexes(board.map, aimed, lean, 4);
      expect(hexes.some((p) => hexDistance(p, aimed) === 0)).toBe(true);
      expect(touching(hexes)).toBe(5);
    }
  });

  it("turns with the pointer: all six triangles round the hex can be had", () => {
    const shapes = new Set(spots.map((lean) => nearestHexes(board.map, aimed, lean, 3).map(posKey).sort().join(" ")));
    expect(shapes.size).toBe(6);
  });

  it("keeps a spot off in another hex inside the one aimed at", () => {
    const l = leanWithin(aimed, { q: 3, r: -1 });
    expect(Math.hypot(l.q, l.r)).toBeLessThan(1);
    expect(nearestHexes(board.map, aimed, { q: 3, r: -1 }, 3).some((p) => hexDistance(p, aimed) === 0)).toBe(true);
    expect(leanWithin(aimed, { q: NaN, r: 0 })).toEqual({ q: 0, r: 0 });
  });

  it("clusterHexes follows the lean when there is one, and turns toward the user without", () => {
    const from = at(6, 1);
    expect(clusterHexes(board, from, aimed, 3)).toHaveLength(3);
    const toward = clusterHexes(board, from, aimed, 3);
    const leaned = clusterHexes(board, from, aimed, 3, { q: 0, r: 0.3 });
    expect(leaned).toEqual(nearestHexes(board.map, aimed, { q: 0, r: 0.3 }, 3));
    expect(leaned.map(posKey).sort()).not.toEqual(toward.map(posKey).sort());
  });
});
