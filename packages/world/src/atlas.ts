// The atlas: a sea chart of landfalls that spreads out from the Harbor, one
// to a world (a crew). Each node is a map to sail to and fight on (a zone:
// see ./zone), and clearing one opens the ones its routes lead to.
//
// The chart has no edge. It is an endless lattice of hex cells with one node
// to a cell, and everything about a node (where it lies, what it is called,
// its ground, how dangerous it is, what modifiers it carries, which
// neighbours its routes run to) is worked out from the chart's seed and the
// cell alone. So nothing is stored until a crew opens a node, and the same
// seed always charts the same sea.
//
//   ring       how many cells out from the Harbor a node lies. It sets the
//              enemy's level, and how many modifiers a node may carry.
//   routes     every node has one route to a neighbour a ring nearer the
//              Harbor, so any node can be reached; and a share of the other
//              pairs of neighbours are joined too, for ways round.
//   regions    ground comes from slow noise over the chart, so there are
//              stretches of woods and runs of shore, not a scatter.
//   climates   and over those, far slower, lie the climates: the greenwood
//              round the Harbor, and beyond it great tracts of frost, dunes,
//              mire and ashlands, each many places across. The same kinds
//              of ground are in each, and look nothing alike.
//   the land   what a hex of the world is comes of those (`atlasLie`): sea,
//              strand, open sand, open ground, forest or hills, in a
//              climate. It is what the atlas draws there (atlasMap.ts), and
//              a node is what it stands on: the land and climate under it
//              are its own, and its map's ground, its kind of place and who
//              lives there all follow from them. Nothing about a node's
//              environment is decided anywhere else. Open sand is a desert
//              wherever it lies: its climate is the dunes, even in a small
//              stretch of it in the middle of the greenwood.
//   islands    the world is an ocean, and every place is an island in it
//              (`isleOf`): land reaches only so far from a place, by what
//              the place is, with a strand round its edge and open sea
//              beyond. What the land of an island is, hex by hex, is still
//              the slow noise's to say (`groundLie`); the island only says
//              where it stops. A crew sails from one to the next.
//   sea caves  now and then a node is a cave: a delve (zone/delve.ts), with
//              chests and a hoard, cleared when the last chest is open.
//   lookouts   high ground, craggy to fight on. From one the crew has
//              cleared they see a long way: the cloud lifts far round it.
//   lairs      something big has made its den there, and its own kind keep
//              it company. A level above its ring, and its bounty is that
//              of a place three rings further out.
//   lodestones a crew may set a stone into a place before setting out for
//              it (lodestone.ts): what the stone carries is added to what
//              the place has.
//
// What a crew sees of it (`atlasView`) is the nodes it has cleared, the ones
// open to it (a route from the Harbor or from a cleared node), and a ring of
// fog beyond those: where there is something, and nothing more.

import type { HexPos } from "@gantt-quest/core";
import type { Clime } from "./map";
import { makeRng, seedFromString, type Rng } from "./rng";
import { zoneOptions } from "./zone/gen";
import { placeName, siteFor, type SiteGround, type SiteId } from "./zone/sites";
import { PERIL_IDS, ZONE_MODS, cleanMods, modOf, modsOf, rollMod, type ZoneMod, type ZoneModId } from "./zone/mods";
import type { ZoneBiome, ZoneOptions } from "./zone/types";

/** A cell of the chart, in axial hex coordinates. The Harbor is at 0,0. */
export interface AtlasCell {
  q: number;
  r: number;
}

export type AtlasNodeKind = "harbor" | "landfall" | "seacave" | "lookout" | "lair";

export interface AtlasNode {
  /** "q,r": the node's cell, and its name in the database. */
  id: string;
  cell: AtlasCell;
  /** The hex of the world it stands on (atlasMap.ts): near its cell's middle, but never in a ruled row (atlasHex). */
  hex: HexPos;
  name: string;
  kind: AtlasNodeKind;
  /**
   * The land it stands on, and the climate of it: the hex of the world under it, as the atlas draws it
   * (`atlasLie`). Its map's whole environment follows from these two and nothing else.
   */
  land: AtlasLand;
  clime: Clime;
  /** The ground its map is made of, which follows from its land (a sea cave's is the caves'). */
  biome: ZoneBiome;
  /** Cells out from the Harbor: 0 for the Harbor itself. */
  ring: number;
  /** The level of what stands on it. */
  level: number;
  /** The perils it carries of its own (zone/mods.ts). A place has no boons of its own: those come on a lodestone. */
  mods: ZoneMod[];
  /** The nodes its routes run to. */
  links: string[];
}

/**
 * A node as a crew is shown it. One `beyond` is known, and lies past a sea passage they have not beaten: they
 * may not set out for it until they have, save with a pilot's soundings on their charter. A fogged one is only
 * somewhere a route leads: no name, no ground, nothing about what is there.
 */
export type AtlasNodeView =
  | (AtlasNode & { state: "harbor" | "cleared" | "open" | "beyond" })
  | { id: string; hex: HexPos; ring: number; links: string[]; state: "fogged" };

export const ATLAS_HOME = "0,0";
/** How far out a node may be named at all: a guard on what comes off the wire, far beyond anywhere a crew will sail. */
export const ATLAS_REACH = 500;
/** The share of pairs of neighbours joined by a route, besides the one route every node has toward the Harbor. */
const EXTRA_ROUTES = 0.42;
/**
 * The lattice the places were first laid on, five hexes to a cell, and how far the world has since been spread
 * out to put open sea between them. A place stands on the hex it always did, times `SPREAD`: so the noise under
 * it (which is reckoned in cells, not hexes) is the very same, and with it the place's land, climate, name and
 * routes. Spread by a whole number or not at all: anything else moves a place off the hex its lie was read from.
 */
const GRAIN = 5;
const SPREAD = 2;
/** How many hexes of the world lie between one cell's middle and the next: about how far apart two places are. */
export const ATLAS_SPACING = GRAIN * SPREAD;
/**
 * How far the lattice of cells is bent out of true, in hexes of the first lattice, so the places do not lie in rows. The bend is
 * slow (neighbours are carried the same way, and stay apart), and each place is nudged a little on its own besides.
 */
const WARP = 1.7;
const WARP_SCALE = 2.2;
const NUDGE = 0.7;
/** Two places are joined by a route of the second kind (not the one each has toward the Harbor) only if they lie this near. */
const ROUTE_REACH = (GRAIN + 1) * SPREAD;
/** One node in so many, from the second ring out, is a sea cave; one in so many more a lookout; and from the third ring, a lair. */
const SEACAVE_CHANCE = 0.16;
const LOOKOUT_CHANCE = 0.07;
const LAIR_CHANCE = 0.15;
/** A lair's bounty is that of a place this many rings further out. */
export const LAIR_RINGS = 3;
/** What has made its den in a lair, by the ground it is on; and, in some climates, whatever the ground. */
const LAIR_BEAST: Record<ZoneBiome, string> = { meadow: "alpha", woods: "great_bear", shore: "guardian", caves: "haunt" };
const CLIME_BEAST: Partial<Record<Clime, string>> = { mire: "broodmother" };

const DIRS: AtlasCell[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
const idOf = (c: AtlasCell) => `${c.q},${c.r}`;
const ringOf = (c: AtlasCell) => (Math.abs(c.q) + Math.abs(c.r) + Math.abs(c.q + c.r)) / 2;
const around = (c: AtlasCell): AtlasCell[] => DIRS.map((d) => ({ q: c.q + d.q, r: c.r + d.r }));
/** Where a hex of the world lies on the page, in cells: pointy hexes, `ATLAS_SPACING` of them to a cell. */
const page = (hex: HexPos) => ({ x: (hex.q + hex.r / 2) / ATLAS_SPACING, y: (hex.r * Math.sqrt(3)) / 2 / ATLAS_SPACING });
const rngFor = (seed: string, tag: string, key: string): Rng => makeRng(seedFromString(`atlas|${seed}|${tag}|${key}`));
const roll = (seed: string, tag: string, key: string) => rngFor(seed, tag, key).next();

/** The cell an id names, or null if it is not one (or lies out past anywhere the chart is asked about). */
export function atlasCell(id: unknown): AtlasCell | null {
  if (typeof id !== "string") return null;
  const m = /^(-?\d{1,4}),(-?\d{1,4})$/.exec(id);
  if (!m) return null;
  const cell = { q: Number(m[1]), r: Number(m[2]) };
  return ringOf(cell) <= ATLAS_REACH && idOf(cell) === id ? cell : null;
}

/** The hex nearest a point given in fractions of a hex (cube rounding). */
function hexRound(fq: number, fr: number): HexPos {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const [dq, dr, ds] = [Math.abs(q - fq), Math.abs(r - fr), Math.abs(s - fs)];
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}
const hexGap = (a: HexPos, b: HexPos) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/**
 * The hex of the world a cell's node stands on: the cell's middle, carried off by the slow bend of the
 * lattice and nudged a little on its own. The Harbor stands dead on its middle, at 0,0.
 */
export function atlasHex(seed: string, cell: AtlasCell): HexPos {
  const mid: HexPos = { q: cell.q * ATLAS_SPACING, r: cell.r * ATLAS_SPACING };
  if (ringOf(cell) === 0) return mid;
  const id = idOf(cell);
  // Across the page and down it, in hexes of the first lattice; then back into the hexes' own two directions.
  const dx = (atlasNoise(seed, "bend-x", mid, WARP_SCALE) - 0.5) * 2 * WARP + (roll(seed, "nudge-x", id) - 0.5) * 2 * NUDGE;
  const dy = (atlasNoise(seed, "bend-y", mid, WARP_SCALE) - 0.5) * 2 * WARP + (roll(seed, "nudge-y", id) - 0.5) * 2 * NUDGE;
  const dr = dy / (Math.sqrt(3) / 2);
  const first = hexRound(cell.q * GRAIN + dx - dr / 2, cell.r * GRAIN + dr);
  return { q: first.q * SPREAD, r: first.r * SPREAD };
}

/** The neighbour a ring nearer the Harbor that a node's own route runs to. Every node but the Harbor has one. */
function inward(seed: string, cell: AtlasCell): AtlasCell {
  const ring = ringOf(cell);
  const nearer = around(cell).filter((n) => ringOf(n) === ring - 1);
  return nearer[Math.floor(roll(seed, "in", idOf(cell)) * nearer.length)];
}

/** Whether a route runs between two cells that lie side by side. */
function joined(seed: string, a: AtlasCell, b: AtlasCell): boolean {
  if (ringOf(a) === 0 || ringOf(b) === 0) return true;
  if (idOf(inward(seed, a)) === idOf(b) || idOf(inward(seed, b)) === idOf(a)) return true;
  // A way round, for some of the pairs that lie near each other: never a long straight haul.
  if (hexGap(atlasHex(seed, a), atlasHex(seed, b)) > ROUTE_REACH) return false;
  const [lo, hi] = [idOf(a), idOf(b)].sort();
  return roll(seed, "route", `${lo}|${hi}`) < EXTRA_ROUTES;
}

/**
 * Slow noise over the world, 0 to 1, at a hex: a hashed value at each corner of a coarse grid `scale` cells
 * across, blended between them. `memo` keeps the corners already worked out (a whole map asks for the same ones).
 */
export function atlasNoise(seed: string, tag: string, hex: HexPos, scale: number, memo?: Map<string, number>): number {
  const { x, y } = page(hex);
  const fx = x / scale;
  const fy = y / scale;
  const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
  const ease = (t: number) => t * t * (3 - 2 * t);
  const [tx, ty] = [ease(fx - x0), ease(fy - y0)];
  const at = (ix: number, iy: number) => {
    const key = `${tag}|${ix},${iy}`;
    let v = memo?.get(key);
    if (v === undefined) {
      v = roll(seed, tag, `${ix},${iy}`);
      memo?.set(key, v);
    }
    return v;
  };
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** The ground of the region a hex of the world lies in. */
export function atlasRegion(seed: string, hex: HexPos, memo?: Map<string, number>): "shore" | "meadow" | "woods" {
  const v = atlasNoise(seed, "ground", hex, 2.4, memo);
  return v < 0.4 ? "shore" : v < 0.6 ? "meadow" : "woods";
}

/** How many cells across a climate's slow noise is: a tract of one climate is a few of these wide. */
const CLIME_SCALE = 10;
/** The Harbor's own country is greenwood this many cells out, and the climates come into their own over this many more. */
const HOME_GREEN = 3;
const CLIME_RISE = 5;

/**
 * The climate a hex of the world lies in. Two slow noises, how warm it is and how wet, give great tracts of
 * each; a little fine noise at their borders lets one run raggedly into the next. Near the Harbor both are
 * drawn in toward the middle, so home is always greenwood and the wilder climates lie further out.
 */
export function atlasClime(seed: string, hex: HexPos, memo?: Map<string, number>): Clime {
  const { x, y } = page(hex);
  const out = Math.min(1, Math.max(0, (Math.hypot(x, y) - HOME_GREEN) / CLIME_RISE));
  if (out === 0) return "greenwood";
  const ragged = (atlasNoise(seed, "clime-edge", hex, 0.45, memo) - 0.5) * 0.07;
  // Stretched away from the middle (blended noise keeps to it), then drawn back in near home.
  const far = (tag: string) => 0.5 + (atlasNoise(seed, tag, hex, CLIME_SCALE, memo) - 0.5) * 1.7 * out + ragged;
  const warm = far("warm");
  const wet = far("wet");
  if (warm < 0.34) return "frost";
  if (warm > 0.66) return wet > 0.5 ? "ash" : "dunes";
  return wet > 0.7 ? "mire" : "greenwood";
}

/**
 * What kind of ground a hex of the world is, whatever its climate: open water (in the ashlands, molten rock);
 * the strand at the water's edge (a beach; a shelf of ice, in the frost; a crust of cooled rock, in the
 * ashlands); a stretch of open sand; open ground (grass, snow, moss, cinders); forest; or hills.
 */
export type AtlasLand = "sea" | "strand" | "sand" | "grass" | "forest" | "hills";
export const ATLAS_LANDS: AtlasLand[] = ["sea", "strand", "sand", "grass", "forest", "hills"];

/**
 * How each climate bends the lie of the land. `sea` is how much of it is under water (the greenwood's share
 * is 0.34: the dunes are dry and the mire half drowned); `strand` how wide the shore beyond the water is;
 * `ridge` how readily hills rise; `woods` how much of what would be forest is (the dunes have a tree here and there).
 */
const LIE: Record<Clime, { sea: number; strand: number; ridge: number; woods: number }> = {
  greenwood: { sea: 0.34, strand: 0.05, ridge: 0.68, woods: 1 },
  // Its shallows are frozen over: a wide shelf of ice where a strand would be.
  frost: { sea: 0.3, strand: 0.09, ridge: 0.64, woods: 0.8 },
  dunes: { sea: 0.22, strand: 0.03, ridge: 0.66, woods: 0.12 },
  mire: { sea: 0.4, strand: 0.03, ridge: 0.78, woods: 0.9 },
  // No sea: the low ground is molten, with a crust at its edge.
  ash: { sea: 0.21, strand: 0.05, ridge: 0.6, woods: 0.45 },
};

/** The lie of the land at a hex of the world: what the atlas draws there (atlasMap.ts), and so what a place standing on it is. */
export interface AtlasLie {
  land: AtlasLand;
  /**
   * The climate its ground is: that of the tract it lies in (`atlasClime`), save that a stretch of open sand is
   * the dunes' own wherever it lies. Sand is a desert, even a small one in the middle of the greenwood.
   */
  clime: Clime;
  /** The climate of the tract round it. */
  tract: Clime;
  /** Fine noise, 0 to 1: what the map draws its small differences from. */
  fine: number;
  /** For hills: how far up the ridge they stand, from 0. */
  up: number;
  /** Open grass in the middle of a meadow: where the tall grass grows. */
  lea: boolean;
  /**
   * For the sea: this is the open ocean between the islands, which is water whatever climate it lies in. (Sea
   * without it is low ground on an island: a pool in the mire, molten rock in the ashlands; or the rock a
   * place out in the sea stands on.)
   */
  open?: true;
}

/**
 * What the ground at a hex of the world would be were it all one country, with seas only where it lies low:
 * the slow noise's own reckoning, before the ocean is let in round the islands (`atlasLie`). A place is the
 * land this says is under it. `memo` saves working the same noise out twice.
 */
function groundLie(seed: string, hex: HexPos, memo?: Map<string, number>): AtlasLie & { pool?: true } {
  const at = (tag: string, scale: number) => atlasNoise(seed, tag, hex, scale, memo);
  const tract = atlasClime(seed, hex, memo);
  const lie = LIE[tract];
  const sea = at("sea", 3.1);
  const fine = at("fine", 0.34);
  const is = (land: AtlasLand, more: Partial<AtlasLie> & { pool?: true } = {}): AtlasLie & { pool?: true } => ({ land, clime: land === "sand" ? "dunes" : tract, tract, fine, up: 0, lea: false, ...more });
  if (sea < lie.sea) return is("sea");
  // Ridges: hills that climb into mountains along their spine.
  const ridge = at("ridge", 1.25);
  if (ridge > lie.ridge && sea > lie.sea + 0.08) return is("hills", { up: ridge - lie.ridge });
  // The strand: wherever the sea is near.
  if (sea < lie.sea + lie.strand) return is("strand");
  // The mire is pocked with pools.
  if (tract === "mire" && fine < 0.2) return is("sea", { pool: true });
  const region = atlasRegion(seed, hex, memo);
  const wooded = (share: number) => fine < share * lie.woods;
  // A run of shore country is open sand in the greenwood and the dunes, with a green patch here and there.
  if (region === "shore") return tract === "greenwood" || tract === "dunes" ? is(fine > 0.8 ? "grass" : "sand") : is(wooded(0.25) ? "forest" : "grass");
  if (region === "woods") return is(wooded(0.7) ? "forest" : "grass");
  return fine > 1 - 0.26 * lie.woods ? is("forest") : is("grass", { lea: true });
}

/**
 * How far an island's land reaches from the place on it, in hexes, by what the place is: `base`, and up to
 * `more` besides (each island its own). The Harbor's is the broadest; a place that stands in the sea itself
 * (`sea`, whatever kind of place it is) is a skerry, hardly more than the rock it is on.
 */
const ISLE_REACH: Record<AtlasNodeKind | "sea", { base: number; more: number }> = {
  harbor: { base: 2.8, more: 0 },
  landfall: { base: 1.8, more: 0.9 },
  seacave: { base: 1.8, more: 0.4 },
  lookout: { base: 1.9, more: 0.6 },
  lair: { base: 2.3, more: 0.8 },
  sea: { base: 1.2, more: 0.4 },
};
/** How far a coast wanders in and out of its island's round, in hexes, and how fine the wandering is (in cells). */
const COAST_WANDER = 0.7;
const COAST_SCALE = 0.17;
/** How wide the strand at an island's edge is, in hexes. */
const COAST_STRAND = 0.4;
/** On an island of the mire, ground this fine or finer is a pool; of the ashlands, molten: a hex or two of it, here and there. */
const POOLS: Partial<Record<Clime, number>> = { mire: 0.2, ash: 0.2 };
/** How far in from its coast (as a share of its reach) an island of the hills begins to climb. */
const HILL_FOOT = 0.4;

/** The island a place stands on: where the place is, the lie of the land under it, and how far its land reaches. */
interface Isle {
  hex: HexPos;
  lie: AtlasLie;
  reach: number;
}
/** Islands already worked out, by seed and cell: a whole map asks for the same few thousands of times. */
const isles = new Map<string, Isle>();

/** The island in a cell of a chart. The same seed and cell always give the same island. */
function isleOf(seed: string, cell: AtlasCell): Isle {
  const key = `${seed}|${idOf(cell)}`;
  let isle = isles.get(key);
  if (!isle) {
    const hex = atlasHex(seed, cell);
    const ring = ringOf(cell);
    // Home: a green by the water, whatever the lie of the land was before the town was built on it.
    const lie: AtlasLie = ring === 0 ? { land: "grass", clime: "greenwood", tract: "greenwood", fine: 0.5, up: 0, lea: false } : plain(groundLie(seed, hex));
    const { base, more } = ISLE_REACH[ring === 0 ? "harbor" : lie.land === "sea" ? "sea" : kindOf(ring, rngFor(seed, "node", idOf(cell)).next())];
    isle = { hex, lie, reach: base + more * roll(seed, "isle", idOf(cell)) };
    if (isles.size > 4096) isles.clear();
    isles.set(key, isle);
  }
  return isle;
}
const plain = ({ pool: _pool, ...lie }: AtlasLie & { pool?: true }): AtlasLie => lie;

/**
 * The lie of the land at a hex of the world: what the atlas draws there (atlasMap.ts), and so what a place
 * standing on it is. Open sea, unless an island reaches this far: then the ground the slow noise says
 * (`groundLie`) is under the place on it, and so all over it, with a strand round its edge, a little of
 * something else here and there, and a pool or two in the mire and the ashlands. The hex a place stands on is the place's own lie exactly.
 * `memo` saves working the same noise out twice.
 */
export function atlasLie(seed: string, hex: HexPos, memo?: Map<string, number>): AtlasLie {
  const { x, y } = page(hex);
  // The island of the cell this hex lies in, or of one beside it: no island reaches further than that.
  const mid = hexRound(hex.q / ATLAS_SPACING, hex.r / ATLAS_SPACING);
  let on: Isle | null = null;
  let within = 0;
  for (const cell of [mid, ...around(mid)]) {
    const isle = isleOf(seed, cell);
    if (isle.hex.q === hex.q && isle.hex.r === hex.r) return isle.lie;
    const at = page(isle.hex);
    const inside = isle.reach - Math.hypot(x - at.x, y - at.y) * ATLAS_SPACING;
    if (inside > within - COAST_WANDER && (!on || inside > within)) [on, within] = [isle, inside];
  }
  const ground = groundLie(seed, hex, memo);
  const open: AtlasLie = { land: "sea", clime: ground.tract === "ash" ? "greenwood" : ground.tract, tract: ground.tract, fine: ground.fine, up: 0, lea: false, open: true };
  if (!on) return open;
  within += (atlasNoise(seed, "coast", hex, COAST_SCALE, memo) - 0.5) * 2 * COAST_WANDER;
  if (within < 0) return open;
  // An island is one country: the climate of the place on it, and the land the place stands on, with a strand
  // round its edge and a little of something else here and there (by the fine noise), so it reads at a glance
  // as what its map will be: a wooded island is woods with a glade or two, a desert one sand with a green patch.
  const own = on.lie;
  const tract = own.tract;
  const fine = ground.fine;
  const of = (land: AtlasLand, more: Partial<AtlasLie> = {}): AtlasLie => ({ land, clime: land === "sand" ? "dunes" : tract, tract, fine, up: 0, lea: false, ...more });
  if (within < COAST_STRAND) return of("strand");
  if (fine < (POOLS[tract] ?? 0)) return of("sea");
  switch (own.land) {
    case "sea":
    case "strand":
      return of("strand");
    case "sand":
      return of(fine > 0.82 ? "grass" : "sand");
    case "forest":
      return of(fine < 0.72 ? "forest" : "grass");
    case "grass":
      return of(fine > 0.74 ? "forest" : "grass", { lea: fine < 0.3 });
    case "hills": {
      // High in the middle, with green slopes down to the shore.
      const up = within / on.reach - HILL_FOOT;
      return up > 0 ? of("hills", { up: up * 0.4 }) : of(fine < 0.5 ? "forest" : "grass");
    }
  }
}

/** The ground a place's map is laid on (zone/sites.ts), by the land it stands on: the shore for the sea and its strand, high ground for the hills. */
export const LAND_GROUND: Record<AtlasLand, SiteGround> = { sea: "shore", strand: "shore", sand: "meadow", grass: "meadow", forest: "woods", hills: "heights" };

const FIRST = [
  "Gull", "Widow's", "Salt", "Drowned", "Lantern", "Brine", "Kelp", "Thistle", "Crooked", "Grey",
  "Amber", "Wrecker's", "Tinker's", "Mizzen", "Fathom", "Barnacle", "Squall", "Ember", "Moss", "Heron",
  "Cinder", "Marrow", "Bellman's", "Tarry", "Whistling", "Low", "Stray", "Cutler's", "Hag's", "Pale",
  "Nettle", "Rook", "Sorrel", "Dunlin", "Cooper's", "Wicker", "Rust", "Sable", "Petrel", "Longshore",
];
/** The first words in a chart's own order, kept per seed: working it out is the same shuffle every time. */
const shuffled = new Map<string, string[]>();
/**
 * The first word of a node's name. It steps through the chart's own shuffle of the list as the cells
 * do (7 a cell one way, 13 the other), so no two landfalls side by side share one.
 */
function firstWord(seed: string, cell: AtlasCell): string {
  let words = shuffled.get(seed);
  if (!words) {
    const rng = rngFor(seed, "names", "first");
    words = [...FIRST];
    for (let i = words.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [words[i], words[j]] = [words[j], words[i]];
    }
    if (shuffled.size > 64) shuffled.clear();
    shuffled.set(seed, words);
  }
  const n = words.length;
  return words[(((cell.q * 7 + cell.r * 13) % n) + n) % n];
}
/** What a place is called in a climate that is not the greenwood, whatever its ground. */
const CLIME_LAST: Record<Exclude<Clime, "greenwood">, string[]> = {
  frost: ["Floe", "Drift", "Fell", "Rime", "Tarn", "Hollow", "Scarp", "Firth"],
  dunes: ["Dunes", "Wadi", "Mesa", "Wells", "Flats", "Reach", "Sands", "Cairn"],
  mire: ["Mire", "Fen", "Slough", "Carr", "Bog", "Reeds", "Wash", "Sedge"],
  ash: ["Cinders", "Scar", "Slag", "Crater", "Kiln", "Embers", "Vent", "Clinker"],
};
/** What a place in the greenwood is called, by the land it stands on. (Open sand is the dunes' wherever it lies, and is named as theirs.) */
const LAST: Record<AtlasLand, string[]> = {
  sea: ["Isle", "Holm", "Skerry", "Key", "Rock", "Ait"],
  strand: ["Cove", "Strand", "Spit", "Shoals", "Bar", "Landing"],
  sand: CLIME_LAST.dunes,
  grass: ["Green", "Down", "Lea", "Rise", "Meadow", "Field"],
  forest: ["Wood", "Thicket", "Grove", "Holt", "Tangle", "Copse"],
  hills: ["Ridge", "Knoll", "Bluff", "Edge", "Pike", "Moor"],
};
const CAVE_LAST = ["Grotto", "Sea Cave", "Sump", "Gullet", "Hole", "Cellars"];

/** What a lookout and a lair are called, whatever ground or climate they are in. */
const KIND_LAST: Partial<Record<AtlasNodeKind, string[]>> = {
  lookout: ["Lookout", "Watch", "Height", "Crag", "Beacon", "Tor"],
  lair: ["Den", "Lair", "Warren", "Roost", "Hold", "Maw"],
};

/** How dangerous a ring is: the level of what stands there. A ring out is a level up. */
export const atlasLevel = (ring: number): number => Math.max(1, Math.min(40, Math.round(ring)));
/** How many modifiers a node in this ring may carry: none beside the Harbor, more the further out. */
export function atlasModCount(ring: number): [number, number] {
  return ring <= 1 ? [0, 0] : ring <= 3 ? [0, 1] : ring <= 6 ? [1, 2] : [1, 3];
}

/** The perils a node carries: a few picked by weight from those that suit it, one kind of ground at most, at ranks its ring can show. */
function rollMods(rng: Rng, ring: number, kind: AtlasNodeKind): ZoneMod[] {
  const [lo, hi] = atlasModCount(ring);
  const want = rng.int(lo, hi);
  // A sea cave's ground is the caverns' own: only what changes the enemy means anything there.
  const pool = PERIL_IDS.filter((id) => kind !== "seacave" || ZONE_MODS[id].kind === "enemy");
  const out: ZoneModId[] = [];
  const picked: ZoneMod[] = [];
  for (let tries = 0; out.length < want && tries < 24; tries++) {
    const mod = rollMod(rng, pool, ring, (id) => !out.includes(id) && !(ZONE_MODS[id].hazard && out.some((o) => ZONE_MODS[o].hazard)));
    if (!mod) break;
    out.push(modOf(mod)!.id);
    picked.push(mod);
  }
  // In the order they are listed, so the same set always reads the same.
  return cleanMods(picked);
}

/** What a place is, by its ring and the one throw that decides it: a sea cave, a lookout, a lair, or (most of them) a landfall. */
const kindOf = (ring: number, what: number): AtlasNodeKind =>
  ring === 0 ? "harbor"
  : ring >= 2 && what < SEACAVE_CHANCE ? "seacave"
  : ring >= 2 && what < SEACAVE_CHANCE + LOOKOUT_CHANCE ? "lookout"
  : ring >= 3 && what < SEACAVE_CHANCE + LOOKOUT_CHANCE + LAIR_CHANCE ? "lair"
  : "landfall";

/** The node in a cell of a chart. The same seed and cell always give the same node. */
export function atlasNode(seed: string, cell: AtlasCell): AtlasNode {
  const id = idOf(cell);
  const ring = ringOf(cell);
  const hex = atlasHex(seed, cell);
  const links = around(cell).filter((n) => joined(seed, cell, n)).map(idOf);
  // Home: a green by the water, whatever the lie of the land was before the town was built on it.
  if (ring === 0) return { id, cell, hex, name: "The Harbor", kind: "harbor", land: "grass", clime: "greenwood", biome: "meadow", ring: 0, level: 1, mods: [], links };
  const rng = rngFor(seed, "node", id);
  // One throw decides what it is (`kindOf`).
  const kind = kindOf(ring, rng.next());
  // Where it is decides what it is like: the land under it and that land's climate, as the atlas draws them.
  const { land, clime } = atlasLie(seed, hex);
  const biome: ZoneBiome = kind === "seacave" ? "caves" : groundBiome(LAND_GROUND[land]);
  // A cave is a cave wherever it is, and a lookout or a lair is named for what it is; anywhere else out of the
  // greenwood is named for its climate, and in it for its land.
  const last = rng.pick(kind === "seacave" ? CAVE_LAST : LAST[land]);
  const own = KIND_LAST[kind];
  const name = `${firstWord(seed, cell)} ${own ? rngFor(seed, "kind-name", id).pick(own) : clime === "greenwood" || kind === "seacave" ? last : rngFor(seed, "clime-name", id).pick(CLIME_LAST[clime])}`;
  return { id, cell, hex, name, kind, land, clime, biome, ring, level: atlasLevel(ring + (kind === "lair" ? 1 : 0)), mods: rollMods(rng, ring, kind), links };
}

/** The ground a map is made of (its options' `biome`), for each ground a place may stand on: high ground is open ground, laid steep. */
const groundBiome = (ground: SiteGround): ZoneBiome => (ground === "heights" ? "meadow" : ground);

/** The node an id names on a chart, or null if the id is not a node's. */
export function atlasNodeById(seed: string, id: unknown): AtlasNode | null {
  const cell = atlasCell(id);
  return cell ? atlasNode(seed, cell) : null;
}

// ---------- passages: the sea between two places ----------

/**
 * What lies on the water of a route. Most are calm: the ship sails straight over. The rest are an encounter
 * at sea, which a crew must beat once (after that the passage is calm for them) before they can sail on to
 * what lies past it.
 */
export type PassageKind = "calm" | "salvage";
export interface PassageDef {
  name: string;
  /** What it is, in a line, for the atlas. */
  blurb: string;
  /** The share of routes that are this, a ring out from the Harbor (`near`) and far out (`far`, from `PASSAGE_FAR` rings). */
  near: number;
  far: number;
  /** The pilot's soundings a charter needs to slip past it unfought (zone/mods.ts: `soundings`). */
  soundings: number;
}
/**
 * The encounters there are. A new one is a line here (and its share comes out of the calm water), and
 * whatever makes its map (voyage/).
 */
export const PASSAGES: Record<Exclude<PassageKind, "calm">, PassageDef> = {
  salvage: { name: "Salvage waters", blurb: "Wreckage adrift, and things in the water that want it too.", near: 0.3, far: 0.5, soundings: 1 },
};
/** How many rings out a passage's share stops rising. */
const PASSAGE_FAR = 8;

export interface AtlasPassage {
  /** The two places it lies between, lesser id first, with a bar between: its name in the database, beside the nodes'. */
  id: string;
  ends: [string, string];
  /** The hex of the world halfway along its route: where the atlas marks it. */
  hex: HexPos;
  /** The further out of its two ends: how dangerous it is. */
  ring: number;
  level: number;
  kind: PassageKind;
}

/** The id of the passage between two places, whichever way round they are given. */
export const passageId = (a: string, b: string): string => [a, b].sort().join("|");

/** The passage between two places a route joins, or null if none does. The same seed and pair always give the same passage. */
export function atlasPassage(seed: string, a: unknown, b: unknown): AtlasPassage | null {
  const [from, to] = [atlasCell(a), atlasCell(b)];
  if (!from || !to || ringOf({ q: from.q - to.q, r: from.r - to.r }) !== 1 || !joined(seed, from, to)) return null;
  const ends = [idOf(from), idOf(to)].sort() as [string, string];
  const id = ends.join("|");
  const [ha, hb] = [atlasHex(seed, from), atlasHex(seed, to)];
  const ring = Math.max(ringOf(from), ringOf(to));
  const hex = hexRound((ha.q + hb.q) / 2, (ha.r + hb.r) / 2);
  // The water off the Harbor is home water: nothing lies in wait there.
  let kind: PassageKind = "calm";
  if (Math.min(ringOf(from), ringOf(to)) > 0) {
    const out = Math.min(1, (ring - 2) / (PASSAGE_FAR - 2));
    let at = roll(seed, "passage", id);
    for (const [name, def] of Object.entries(PASSAGES) as [Exclude<PassageKind, "calm">, PassageDef][]) {
      if ((at -= def.near + (def.far - def.near) * out) < 0) {
        kind = name;
        break;
      }
    }
  }
  return { id, ends, hex, ring, level: atlasLevel(ring), kind };
}

/** The passage an id names on a chart, or null if the id is not one's. */
export function atlasPassageById(seed: string, id: unknown): AtlasPassage | null {
  if (typeof id !== "string") return null;
  const ends = id.split("|");
  if (ends.length !== 2) return null;
  const passage = atlasPassage(seed, ends[0], ends[1]);
  return passage?.id === id ? passage : null;
}

/** Whether the ship may sail a passage freely: it is calm water, or the crew has beaten what was there. */
const sailed = (passage: AtlasPassage, cleared: ReadonlySet<string>) => passage.kind === "calm" || cleared.has(passage.id);
/** Whether a charter's soundings will see the ship past a passage unfought. */
const slips = (passage: AtlasPassage, charter: readonly ZoneMod[]) => passage.kind !== "calm" && modsOf({ mods: [...charter] }).soundings >= PASSAGES[passage.kind].soundings;

/**
 * Whether a crew may set out to fight a passage: there is something there, they have not beaten it, and one
 * end of it is the Harbor or a place they have cleared.
 */
export function passageOpen(seed: string, cleared: ReadonlySet<string>, id: unknown): boolean {
  const passage = atlasPassageById(seed, id);
  if (!passage || sailed(passage, cleared)) return false;
  return passage.ends.some((end) => end === ATLAS_HOME || cleared.has(end));
}

/**
 * How a crew that has cleared `cleared` (places and passages both) stands to a node:
 *
 *   open    a route runs to it from the Harbor or a place they have cleared, over water they may sail
 *   beyond  such routes run to it, but every one crosses a passage they have not beaten
 *   null    it is the Harbor, or cleared already, or no route reaches it yet
 *
 * With `charter`, what they mean to set out with: soundings on it that will slip a passage make the way open.
 * `by` is the passage in the way (the least dangerous, where there are several), or slipped past.
 */
export function atlasWay(seed: string, cleared: ReadonlySet<string>, id: unknown, charter: readonly ZoneMod[] = []): { way: "open" | "beyond"; by?: AtlasPassage; silent?: true } | null {
  const node = atlasNodeById(seed, id);
  if (!node || node.kind === "harbor" || cleared.has(node.id)) return null;
  const ways = node.links.filter((l) => l === ATLAS_HOME || cleared.has(l)).map((l) => atlasPassage(seed, node.id, l)!);
  if (ways.length === 0) return null;
  if (ways.some((p) => sailed(p, cleared))) return { way: "open" };
  const barred = [...ways].sort((a, b) => PASSAGES[a.kind as Exclude<PassageKind, "calm">].soundings - PASSAGES[b.kind as Exclude<PassageKind, "calm">].soundings || a.id.localeCompare(b.id));
  return slips(barred[0], charter) ? { way: "open", by: barred[0], silent: true } : { way: "beyond", by: barred[0] };
}

/**
 * Whether a crew that has cleared `cleared` may open this node: it is not the Harbor, not cleared
 * already, and a route runs to it from the Harbor or from a node they have cleared, over water the ship may
 * sail (or slip past, with the soundings on `charter`).
 */
export function atlasOpen(seed: string, cleared: ReadonlySet<string>, id: unknown, charter: readonly ZoneMod[] = []): boolean {
  return atlasWay(seed, cleared, id, charter)?.way === "open";
}

/** A passage as a crew is shown it: `open` to be fought, `cleared` by them, or `calm` water from the first. */
export type AtlasPassageView = AtlasPassage & { state: "calm" | "open" | "cleared" };

/** The passages a crew knows: those on the routes out of the Harbor and out of every place they have cleared. */
export function atlasPassages(seed: string, cleared: ReadonlySet<string>): AtlasPassageView[] {
  const out = new Map<string, AtlasPassageView>();
  for (const id of [ATLAS_HOME, ...cleared]) {
    const node = atlasNodeById(seed, id);
    for (const link of node?.links ?? []) {
      const passage = atlasPassage(seed, node!.id, link);
      if (passage && !out.has(passage.id)) out.set(passage.id, { ...passage, state: passage.kind === "calm" ? "calm" : cleared.has(passage.id) ? "cleared" : "open" });
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The chart as a crew sees it: the Harbor, what they have cleared, what is open to them, and a ring
 * of fog beyond that. Routes are listed only between nodes that are shown.
 */
export function atlasView(seed: string, cleared: ReadonlySet<string>): AtlasNodeView[] {
  const known = new Map<string, AtlasNode>();
  for (const id of [ATLAS_HOME, ...cleared]) {
    const node = atlasNodeById(seed, id);
    if (node) known.set(node.id, node);
  }
  const open = new Map<string, AtlasNode>();
  for (const node of known.values()) {
    for (const link of node.links) {
      if (known.has(link) || open.has(link)) continue;
      const next = atlasNodeById(seed, link);
      if (next) open.set(next.id, next);
    }
  }
  const fog = new Map<string, AtlasNode>();
  for (const node of open.values()) {
    for (const link of node.links) {
      if (known.has(link) || open.has(link) || fog.has(link)) continue;
      const next = atlasNodeById(seed, link);
      if (next) fog.set(next.id, next);
    }
  }
  const shown = (id: string) => known.has(id) || open.has(id) || fog.has(id);
  // Fog knows only the routes that lead out of it to somewhere open: not what lies between two unknowns.
  const seen = (node: AtlasNode) => node.links.filter(shown);
  return [
    ...[...known.values()].map((n): AtlasNodeView => ({ ...n, links: seen(n), state: n.kind === "harbor" ? "harbor" : "cleared" })),
    ...[...open.values()].map((n): AtlasNodeView => ({ ...n, links: seen(n), state: atlasWay(seed, cleared, n.id)?.way ?? "open" })),
    ...[...fog.values()].map((n): AtlasNodeView => ({ id: n.id, hex: n.hex, ring: n.ring, links: n.links.filter((l) => open.has(l)), state: "fogged" })),
  ];
}

/** The ring a node's bounty is paid as: its own, or further out for a lair. */
export const atlasTier = (node: Pick<AtlasNode, "ring" | "kind">): number => Math.max(1, node.ring + (node.kind === "lair" ? LAIR_RINGS : 0));

/** The kind of place a node is (zone/sites.ts): what its map is laid out as. The same node is always the same kind of place. */
export const nodeSite = (seed: string, node: Pick<AtlasNode, "id" | "kind" | "land" | "clime">): string =>
  siteFor(LAND_GROUND[node.land], node.clime, node.kind === "lookout" ? "lookout" : node.kind === "lair" ? "lair" : "landfall", roll(seed, "site", node.id));

/**
 * What a node's map is, said plainly, for the atlas: the kind of place in its climate and on its ground
 * ("Desert ruins", "Frozen cove", "Woodland henge"). A sea cave is a sea cave wherever it is.
 */
export const nodePlace = (seed: string, node: Pick<AtlasNode, "id" | "kind" | "land" | "clime">): string =>
  node.kind === "seacave" ? "Sea cave" : placeName(nodeSite(seed, node) as SiteId, node.clime, LAND_GROUND[node.land]);

/**
 * What a node's map is made from, for a party of this many. The ring sets the level; the ground, the climate and
 * what the place is (its site) set the rest. The nodes beside the Harbor are small and gentle; further out a
 * place is a sprawl with several bands on it. `more` is what a lodestone set into the node adds to its own
 * modifiers (lodestone.ts: `stoneOn(node, stone).added`), and `stone` how much that stone carried in all (left
 * out with no stone): the lodestones in the place's spoils are reckoned from it.
 */
export function nodeOptions(seed: string, node: AtlasNode, party: number, more: readonly ZoneMod[] = [], stone?: number): ZoneOptions {
  const rng = rngFor(seed, "lay", node.id);
  const near = node.ring <= 1;
  const base = { party, level: node.level, mods: cleanMods([...node.mods, ...more]), tier: atlasTier(node), name: node.name, clime: node.clime, ...(stone !== undefined ? { stone } : {}) };
  if (node.kind === "seacave") return zoneOptions({ ...base, size: "medium", biome: "caves", delve: true });
  const site = nodeSite(seed, node);
  const ground = LAND_GROUND[node.land];
  // High, broken ground: whoever holds the top has the best of it.
  if (node.kind === "lookout") return zoneOptions({ ...base, site, size: "medium", biome: node.biome, groups: rng.int(3, 4), elevation: 3, obstacles: 1, clear: 4 });
  // The beast itself in its den, with a band of whatever else lives there about it, and more bands out on the
  // ground round it (never a second beast).
  if (node.kind === "lair") {
    return zoneOptions({ ...base, site, size: "medium", biome: node.biome, groups: 3, kinds: [CLIME_BEAST[node.clime] ?? LAIR_BEAST[node.biome]], elevation: rng.int(1, 2), obstacles: rng.int(1, 2), clear: 4 });
  }
  const groups = near ? rng.int(2, 3) : rng.int(3, 5);
  const rise = rng.int(1, ground === "shore" ? 2 : 3);
  return zoneOptions({
    ...base,
    site,
    size: near ? "small" : "medium",
    biome: node.biome,
    groups,
    // Up in the hills the ground is as steep as ground gets, whatever stands on it.
    elevation: ground === "heights" ? 3 : rise,
    obstacles: rng.int(0, 1) + (ground === "woods" ? 1 : 0),
    clear: 4,
  });
}
