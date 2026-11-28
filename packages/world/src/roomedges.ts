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


/** How a wall hex in a notch of a room's floor is cut: down the middle for a side wall, across it for a back or front one; and which way the room lies from it (1: toward +x for a side, toward +z for an end). */
export interface WallCut {
  cut: "side" | "end";
  room: 1 | -1;
}

const cuts = new WeakMap<readonly Tile[], Map<string, WallCut>>();

/**
 * The wall hexes of a room that stand in the notches of its floor, by key ("q,r"): each is half wall and half
 * floor. A wall with floor on both sides of it is left whole, and a wall in a side's notch keeps that cut
 * though it is in an end's notch too. Kept with the room's tiles.
 */
export function squaredWalls(room: Pick<WorldMap, "tiles">): Map<string, WallCut> {
  let out = cuts.get(room.tiles);
  if (out) return out;
  out = new Map();
  const floor = (t: Tile) => (t.biome as string) === "floor";
  const wall = (there: Tile | undefined) => (there?.biome as string) === "wall";
  const twice = new Set<string>();
  for (const n of sideNotches(room.tiles, floor, wall)) {
    const k = `${n.q},${n.r}`;
    if (out.has(k) && out.get(k)!.room !== -n.side) twice.add(k);
    out.set(k, { cut: "side", room: -n.side as 1 | -1 });
  }
  for (const k of twice) out.delete(k);
  for (const n of endNotches(room.tiles, floor, wall)) {
    const k = `${n.q},${n.r}`;
    if (!out.has(k) && !twice.has(k)) out.set(k, { cut: "end", room: n.room });
  }
  cuts.set(room.tiles, out);
  return out;
}
