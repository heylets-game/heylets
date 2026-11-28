// The straight edges of a floor laid on hexes: a room's walls, a ship's deck.
//
// A floor of hexes has a saw's edge: down its sides every other row stops
// half a hex short, and along its ends the hexes past the last row reach in
// between its own. The notches are found here (`sideNotches`, `endNotches`),
// for whoever draws the floor to fill (the client's ground layer gives the
// floor the near half of each notch hex), and for a room's rules to know
// which of its wall hexes are cut in half that way (`squaredWalls`), so that
// furniture may stand on the half the floor was given (hutroom.ts).

import type { Tile, WorldMap } from "./map";

/** A notch in a floor's side: the hex `q,r` beside floor tile `from` in its row (`side`: -1 to its west, 1 to its east), which the floor comes round above or below. */
export interface SideNotch {
  q: number;
  r: number;
  side: -1 | 1;
  from: Tile;
}

/**
 * The notches down the sides of a floor: for each tile of it, the hex beside it in its own row that is not floor
 * (and that `open` allows: by default nothing there, or water), where the floor's rows above or below reach half a
 * hex further. Filling the near half of each squares the floor's side off.
 */
export function sideNotches(tiles: readonly Tile[], floor: (t: Tile) => boolean, open: (there: Tile | undefined) => boolean = (there) => !there || there.biome === "water"): SideNotch[] {
  const at = (q: number, r: number) => `${q},${r}`;
  const all = new Map(tiles.map((t) => [at(t.q, t.r), t]));
  const laid = (q: number, r: number) => {
    const t = all.get(at(q, r));
    return !!t && floor(t);
  };
  const out: SideNotch[] = [];
  for (const t of tiles) {
    if (!floor(t)) continue;
    for (const side of [-1, 1] as const) {
      const [hq, hr] = [t.q + side, t.r];
      if (laid(hq, hr) || !open(all.get(at(hq, hr)))) continue;
      const comesRound = side < 0 ? laid(hq + 1, hr - 1) || laid(hq, hr + 1) : laid(hq, hr - 1) || laid(hq - 1, hr + 1);
      if (comesRound) out.push({ q: hq, r: hr, side, from: t });
    }
  }
  return out;
}

/** A notch in a floor's end: the hex `q,r` past its last row (`room`: 1 if the floor lies below it on the page, toward +z; -1 if above), both of whose sides that way are floor. `from` is one of those two tiles. */
export interface EndNotch {
  q: number;
  r: number;
  room: -1 | 1;
  from: Tile;
}

/**
 * The notches along the ends of a floor: each hex that is not floor (and that `open` allows) with floor on both
 * of its sides toward the room. Its point reaches in between those two; giving the floor that point squares the
 * floor's end off, as `sideNotches` does its sides.
 */
export function endNotches(tiles: readonly Tile[], floor: (t: Tile) => boolean, open: (there: Tile | undefined) => boolean = (there) => !there || there.biome === "water"): EndNotch[] {
  const at = (q: number, r: number) => `${q},${r}`;
  const all = new Map(tiles.map((t) => [at(t.q, t.r), t]));
  const laid = (q: number, r: number) => {
    const t = all.get(at(q, r));
    return t && floor(t) ? t : undefined;
  };
  // Every hex beside a floor tile, above or below it, is asked about once.
  const asked = new Set<string>();
  const out: EndNotch[] = [];
  for (const t of tiles) {
    if (!floor(t)) continue;
    for (const [dq, dr] of [[0, -1], [1, -1], [0, 1], [-1, 1]]) {
      const [q, r] = [t.q + dq, t.r + dr];
      if (asked.has(at(q, r))) continue;
      asked.add(at(q, r));
      if (laid(q, r) || !open(all.get(at(q, r)))) continue;
      const below = laid(q, r + 1) && laid(q - 1, r + 1);
      const above = laid(q, r - 1) && laid(q + 1, r - 1);
      // Floor both ways is a strip of something across a room: left alone.
      if (below && !above) out.push({ q, r, room: 1, from: below });
      else if (above && !below) out.push({ q, r, room: -1, from: above });
    }
  }
  return out;
}


/**
 * How a hex at a floor's edge is cut, and which way the floor lies from it:
 *
 *   side    down its middle: the floor has the half toward `room` (1: +x)
 *   end     across its middle: the floor has the half toward `room` (1: +z)
 *   corner  both ways: the floor has the quarter toward `rx` and `rz`, and the hex's middle is the corner itself
 */
export type EdgeCut = { cut: "side"; room: 1 | -1 } | { cut: "end"; room: 1 | -1 } | { cut: "corner"; rx: 1 | -1; rz: 1 | -1 };
/** A wall hex cut that way (a room's). */
export type WallCut = EdgeCut;

/** A hex at a floor's edge, the part of it the floor is given, and a floor tile beside it (for how high the floor lies). */
export type EdgeFill = EdgeCut & { q: number; r: number; from: Tile };

/**
 * Every hex round a floor that gives part of itself to square the floor off: the notches down its sides (half
 * each), the hexes along its ends (half each), and its corners (a quarter each).
 *
 * An end hex counts the floor half of a side's notch as floor: where the row beside it stops short, the hex
 * above the gap is wholly inside the floor's square, and is cut across like its neighbours. Where that row
 * runs its full width, the hex past its end has floor on one side only and its own middle on both edges at
 * once: that is a corner. A hex with floor both ways across it (a strip of wall through a room) is left whole.
 */
export function edgeFills(tiles: readonly Tile[], floor: (t: Tile) => boolean, open: (there: Tile | undefined) => boolean = (there) => !there || there.biome === "water"): EdgeFill[] {
  const at = (q: number, r: number) => `${q},${r}`;
  const all = new Map(tiles.map((t) => [at(t.q, t.r), t]));
  const laid = (q: number, r: number) => {
    const t = all.get(at(q, r));
    return t && floor(t) ? t : undefined;
  };
  const out = new Map<string, EdgeFill>();
  const twice = new Set<string>();
  for (const n of sideNotches(tiles, floor, open)) {
    const k = at(n.q, n.r);
    const was = out.get(k);
    if (was && was.cut === "side" && was.room !== -n.side) twice.add(k);
    out.set(k, { q: n.q, r: n.r, from: n.from, cut: "side", room: -n.side as 1 | -1 });
  }
  for (const k of twice) out.delete(k);
  const sideCut = (q: number, r: number) => out.get(at(q, r))?.cut === "side";
  // Every hex above or below a floor tile, once.
  const asked = new Set<string>();
  const ends: EdgeFill[] = [];
  for (const t of tiles) {
    if (!floor(t)) continue;
    for (const [dq, dr] of [[0, -1], [1, -1], [0, 1], [-1, 1]]) {
      const [q, r] = [t.q + dq, t.r + dr];
      const k = at(q, r);
      if (asked.has(k)) continue;
      asked.add(k);
      if (laid(q, r) || out.has(k) || twice.has(k) || !open(all.get(k))) continue;
      // The two hexes on its side toward the room, east then west: floor, the floor half of a side's notch, or neither.
      const toward = (room: 1 | -1): { east: Tile | undefined; west: Tile | undefined; eastHalf: boolean; westHalf: boolean } =>
        room > 0 ? { east: laid(q, r + 1), west: laid(q - 1, r + 1), eastHalf: sideCut(q, r + 1), westHalf: sideCut(q - 1, r + 1) } : { east: laid(q + 1, r - 1), west: laid(q, r - 1), eastHalf: sideCut(q + 1, r - 1), westHalf: sideCut(q, r - 1) };
      const [below, above] = [toward(1), toward(-1)];
      const any = (n: ReturnType<typeof toward>) => !!n.east || !!n.west;
      if (any(below) === any(above)) continue;
      const room: 1 | -1 = any(below) ? 1 : -1;
      const n = room > 0 ? below : above;
      const from = (n.east ?? n.west)!;
      if ((n.east || n.eastHalf) && (n.west || n.westHalf)) ends.push({ q, r, from, cut: "end", room });
      else ends.push({ q, r, from, cut: "corner", rx: n.east ? 1 : -1, rz: room });
    }
  }
  return [...out.values(), ...ends];
}

const cuts = new WeakMap<readonly Tile[], Map<string, WallCut>>();

/**
 * The wall hexes of a room that give part of themselves to its floor (`edgeFills`), by key ("q,r"), and how each
 * is cut. Kept with the room's tiles.
 */
export function squaredWalls(room: Pick<WorldMap, "tiles">): Map<string, WallCut> {
  let out = cuts.get(room.tiles);
  if (out) return out;
  out = new Map();
  const floor = (t: Tile) => (t.biome as string) === "floor";
  const wall = (there: Tile | undefined) => (there?.biome as string) === "wall";
  for (const { q, r, from: _from, ...cut } of edgeFills(room.tiles, floor, wall)) out.set(`${q},${r}`, cut as WallCut);
  cuts.set(room.tiles, out);
  return out;
}

/** Whether a point `dx, dz` from the middle of a cut hex lies on the part the floor was given, at least `clear` in from each straight edge. */
export function onFloorPart(cut: EdgeCut, dx: number, dz: number, clear = 0): boolean {
  if (cut.cut === "side") return dx * cut.room >= clear;
  if (cut.cut === "end") return dz * cut.room >= clear;
  return dx * cut.rx >= clear && dz * cut.rz >= clear;
}
