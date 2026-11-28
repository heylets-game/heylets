import { describe, expect, it } from "vitest";
import { FURNISHINGS } from "./hut";
import { hexCentre, hutRoom, onCutFloor, placeProblem, hutFloor } from "./hutroom";
import { endNotches, sideNotches, squaredWalls } from "./roomedges";
import type { Tile } from "./map";

const key = (p: { q: number; r: number }) => `${p.q},${p.r}`;

describe("a floor's notches", () => {
  /** A deck: `cols` across and `rows` long in a brick layout, water round it. */
  const deck = (cols: number, rows: number): Tile[] => {
    const tiles: Tile[] = [];
    for (let r = -2; r < rows + 2; r++) {
      for (let c = -2; c < cols + 2; c++) tiles.push({ q: c - Math.floor(r / 2), r, biome: r >= 0 && r < rows && c >= 0 && c < cols ? "dock" : "water", h: 0 });
    }
    return tiles;
  };
  const planks = (t: Tile) => t.biome === "dock";

  it("are found down both sides of a deck, one for every row that stops short, and along both its ends", () => {
    const tiles = deck(3, 8);
    const sides = sideNotches(tiles, planks);
    // Each row is short on one side or the other: eight rows, eight notches, four a side.
    expect(sides).toHaveLength(8);
    expect(sides.filter((n) => n.side === -1)).toHaveLength(4);
    expect(sides.filter((n) => n.side === 1)).toHaveLength(4);
    for (const n of sides) expect(planks(n.from)).toBe(true);
    const ends = endNotches(tiles, planks);
    // Past each end, the hexes that reach in between two of the deck's: two at the bow, two at the stern.
    expect(ends.filter((n) => n.room === 1)).toHaveLength(2);
    expect(ends.filter((n) => n.room === -1)).toHaveLength(2);
    // Nothing is a notch twice.
    expect(new Set([...sides, ...ends].map(key)).size).toBe(sides.length + ends.length);
  });

  it("are not found where something else stands, unless it is allowed", () => {
    const tiles = deck(3, 4).map((t) => (t.biome === "water" ? { ...t, biome: "rock" as const } : t));
    expect(sideNotches(tiles, planks)).toEqual([]);
    expect(endNotches(tiles, planks)).toEqual([]);
    expect(sideNotches(tiles, planks, (there) => there?.biome === "rock").length).toBeGreaterThan(0);
  });
});

describe("a room's cut walls", () => {
  it("are walls, down the sides and along the back, each with the room on one side of it", () => {
    for (const tier of [0, 1, 2]) {
      const room = hutRoom(tier);
      const cuts = squaredWalls(room);
      expect(cuts.size, `tier ${tier}`).toBeGreaterThan(3);
      expect([...cuts.values()].some((c) => c.cut === "side")).toBe(true);
      expect([...cuts.values()].some((c) => c.cut === "end")).toBe(true);
      for (const [k, cut] of cuts) {
        const [q, r] = k.split(",").map(Number);
        expect(room.tiles.find((t) => t.q === q && t.r === r)!.biome, k).toBe("wall");
        // The room's side of it is floor it gave up; the far side is still wall.
        const mid = hexCentre({ q, r });
        const off = (d: number) => (cut.cut === "side" ? { x: mid.x + cut.room * d, z: mid.z } : { x: mid.x, z: mid.z + cut.room * d });
        expect(onCutFloor(room, off(0.3)), k).toBe(true);
        expect(onCutFloor(room, off(-0.3)), k).toBe(false);
      }
      // The same every time it is asked.
      expect(squaredWalls(room)).toBe(cuts);
    }
  });

  it("let a piece of furniture stand against the straight wall, on the half the wall gave up, and no further", () => {
    const room = hutRoom(1);
    const cuts = squaredWalls(room);
    const floor = hutFloor(room);
    const piece = "chest";
    expect(FURNISHINGS[piece]).toBeDefined();
    // A floor hex beside a wall cut down its side: pushed toward that wall as far as a piece may go in its hex.
    let tried = 0;
    for (const [k, cut] of cuts) {
      if (cut.cut !== "side") continue;
      const [q, r] = k.split(",").map(Number);
      const beside = floor.find((f) => f.q === q + cut.room && f.r === r);
      if (!beside) continue;
      tried++;
      // Toward the wall by most of a hex: its footprint reaches over the old edge of the floor, onto the half.
      const spot = { x: -cut.room * 0.78, z: 0, angle: 0 };
      expect(placeProblem(room, [], piece, beside, spot), k).toBeNull();
      // And it still may not stand on the wall hex itself.
      expect(placeProblem(room, [], piece, { q, r }), k).toBe("That is a wall.");
    }
    expect(tried).toBeGreaterThan(0);
  });
});
