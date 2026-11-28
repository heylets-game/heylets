// A voyage: a stretch of sea sailed on the crew's ship, as a map.
//
// The map is the ship's deck with water round it (`deckPlan`), and the ship
// never moves on it: the sea drifts past (drift.ts). Heroes walk the deck as
// they walk any map out of a fight, and work her stations:
//
//   a harpoon gun   loose a line at something adrift (an aim, not a hex):
//                   what it strikes is hauled aboard into the hold
//   the helm        put her over a lane to port or starboard, which slides
//                   the whole sea the other way: clear of a rock, or within
//                   reach of salvage
//
// Time at sea (`VoyageState.t`) runs with the server's clock while nobody is
// fighting, and stands still while a fight is on: boarders hold the ship
// fast. As it runs, rocks that drift into the hull strike it, boarders come
// over the rail at set moments of the stretch, and when the stretch is run
// (and the deck is clear) the ship is through: the hold is shared out.
// If the hull gives first she is sunk: the hold is lost.
//
// A new station is a line in STATIONS and a place for it in `stationsOn`.
// The reducer's part (who may do what, the fight with boarders, paying out)
// is in zone/zone.ts; this file is the sea's own arithmetic, and touches
// nothing but the voyage's own state.

import { allHexesInGrid, hexDistance, type HexGrid, type HexPos } from "@gantt-quest/core";
import type { Tile, WorldMap } from "../map";
import { makeRng, seedFromString } from "../rng";
import { LANE_MS, driftAt, harpoonHit, hullStrikes, type Drifting, type Sea, type Steer } from "./drift";
import { SEA_THINGS, haulOf, type Salvage } from "./seathings";

/** What a map's options say of the ship a voyage is sailed on (voyage/ships.ts `ShipDef` has these). */
export interface VoyageOptions {
  /** Her deck, in hexes: columns across, rows from stern to bow. */
  deck: { cols: number; rows: number };
  /** How much her hull takes, and how much it had left when she set out. */
  hull: number;
  sound?: number;
  /** How many hauls her hold takes. */
  hold: number;
  /** How long the stretch runs, in ms. Left out: `VOYAGE_MS`. */
  ms?: number;
}

/** How long a stretch of sea runs, and how long after it the last things take to drift clear. */
export const VOYAGE_MS = 150_000;
export const VOYAGE_TAIL_MS = 14_000;
/** How many hexes of water lie round the deck on the map: room for what comes alongside. */
export const DECK_MARGIN = 4;
/** When boarders come over the rail, as shares of the stretch. */
export const BOARDINGS = [0.3, 0.68];
/** The most lanes the helm may carry her off her course, either way. */
export const LANES = 2;

export type StationKind = "harpoon" | "helm";
export interface StationDef {
  name: string;
  /** What working it does, in a line. */
  blurb: string;
  /** How long before it can be worked again, in ms of time at sea. */
  reload: number;
  /** For a gun: how far it reaches, in hexes; and how far off a thing's edge a shot may pass and still take it (the moment between eye and clock). */
  reach?: number;
  slack?: number;
}
export const STATIONS: Record<StationKind, StationDef> = {
  harpoon: { name: "Harpoon gun", blurb: "Loose a line at something adrift and haul it aboard.", reload: 2400, reach: 7.5, slack: 0.3 },
  helm: { name: "Helm", blurb: "Put her over to port or starboard: clear of a rock, or nearer the salvage.", reload: LANE_MS },
};

export interface Station {
  id: string;
  kind: StationKind;
  pos: HexPos;
  /** Which side of the ship it is on: -1 port, +1 starboard, 0 amidships. A gun bears on its own side. */
  side: -1 | 0 | 1;
}

/** The voyage as a map's state keeps it. */
export interface VoyageState {
  /** Time at sea so far, in ms: it stands still while a fight is on. */
  t: number;
  /** The server's clock when `t` was last counted (null until the room first tells the time). */
  now: number | null;
  /** How long the stretch runs. */
  ms: number;
  steers: Steer[];
  /** The numbers of the things hauled aboard, and of those that have struck the hull. */
  taken: number[];
  struck: number[];
  /** Things with a line in them that take more than one: how many they have, by number. */
  held: Record<string, number>;
  hull: number;
  hullMax: number;
  /** What has been hauled aboard, a haul at a time, and how many hauls she takes. */
  hold: Salvage[][];
  holdMax: number;
  /** When each station may be worked again, by its id, in time at sea. */
  ready: Record<string, number>;
  /** How many of the boardings have come. */
  boarded: number;
  /** How it ended: she is through the stretch, or sunk. Missing while she sails. */
  outcome?: "through" | "sunk";
}

// ---------- the deck ----------

const colOf = (p: HexPos) => p.q + Math.floor(p.r / 2);
const hexAt = (col: number, r: number): HexPos => ({ q: col - Math.floor(r / 2), r });

/** The map's grid for a deck: the deck, and `DECK_MARGIN` of water on every side. */
export const deckGrid = (v: VoyageOptions): HexGrid => ({ cols: v.deck.cols + DECK_MARGIN * 2, rows: v.deck.rows + DECK_MARGIN * 2 });
/** Whether a hex of that map is deck. The bow is at the top (the lowest row). */
export const onDeck = (v: VoyageOptions, p: HexPos): boolean => p.r >= DECK_MARGIN && p.r < DECK_MARGIN + v.deck.rows && colOf(p) >= DECK_MARGIN && colOf(p) < DECK_MARGIN + v.deck.cols;

/** The map a voyage is sailed on: planks where the deck is, the sea everywhere else, and the stern for a start. */
export function deckPlan(v: VoyageOptions): { map: WorldMap; start: HexPos } {
  const grid = deckGrid(v);
  const tiles: Tile[] = allHexesInGrid(grid).map((p) => ({ q: p.q, r: p.r, biome: onDeck(v, p) ? "dock" : "water", h: 0, elev: 0 }));
  return { map: { grid, tiles, pois: [] }, start: hexAt(DECK_MARGIN + Math.floor(v.deck.cols / 2), DECK_MARGIN + v.deck.rows - 2) };
}

/** Her stations: a harpoon gun each side near the bow, and the helm at the stern. */
export function stationsOn(v: VoyageOptions): Station[] {
  const bow = DECK_MARGIN + 1;
  return [
    { id: "harpoon-port", kind: "harpoon", pos: hexAt(DECK_MARGIN, bow), side: -1 },
    { id: "harpoon-starboard", kind: "harpoon", pos: hexAt(DECK_MARGIN + v.deck.cols - 1, bow), side: 1 },
    { id: "helm", kind: "helm", pos: hexAt(DECK_MARGIN + Math.floor(v.deck.cols / 2), DECK_MARGIN + v.deck.rows - 1), side: 0 },
  ];
}

const SQRT3 = Math.sqrt(3);
/** Where a hex is on the page, a hex's step being 1: across, and down. */
const flat = (p: HexPos) => ({ x: p.q + p.r / 2, y: (p.r * SQRT3) / 2 });
/**
 * Where a hex of the map is in the ship's own frame (drift.ts): hexes to starboard of the middle of her deck, and
 * hexes ahead of it. The bow is toward the map's first row.
 */
export function shipFrame(v: VoyageOptions, p: HexPos): { x: number; y: number } {
  const mid = flat(hexAt(DECK_MARGIN + (v.deck.cols - 1) / 2, DECK_MARGIN + (v.deck.rows - 1) / 2));
  const at = flat(p);
  return { x: at.x - mid.x, y: mid.y - at.y };
}
/** Her hull in that frame: how far it reaches across, ahead and astern of the middle of her deck. */
export const hullOf = (v: VoyageOptions) => ({ half: v.deck.cols / 2, fore: (v.deck.rows * SQRT3) / 4, aft: (v.deck.rows * SQRT3) / 4 });

// ---------- the sea ----------

export const newVoyage = (v: VoyageOptions): VoyageState => ({
  t: 0, now: null, ms: v.ms ?? VOYAGE_MS, steers: [], taken: [], struck: [], held: {}, hull: Math.min(v.hull, v.sound ?? v.hull), hullMax: v.hull, hold: [], holdMax: v.hold, ready: {}, boarded: 0,
});

/** The sea a map's voyage is sailed through: its own, from the map's seed. */
export const seaOf = (seed: string, voyage: Pick<VoyageState, "ms">): Sea => ({ seed: `${seed}|sea`, ms: voyage.ms });

/** How far the helm has put her over, in lanes: starboard is +. */
export const lanesOver = (voyage: Pick<VoyageState, "steers">): number => voyage.steers.reduce((n, s) => n + s.dir, 0);

/** Why a hero standing at `at` cannot work a station now, or null if they can. */
export function stationProblem(v: VoyageOptions, voyage: VoyageState, station: Station | undefined, at: HexPos): string | null {
  if (!station) return "There is no such station aboard.";
  if (voyage.outcome) return "The voyage is over.";
  if (hexDistance(at, station.pos) > 1) return `Stand at the ${STATIONS[station.kind].name.toLowerCase()} to work it.`;
  if ((voyage.ready[station.id] ?? 0) > voyage.t) return station.kind === "harpoon" ? "The line is still being hauled in." : "She is still coming round.";
  return null;
}

/** What came of a harpoon: nothing, a line made fast in something that takes another, or a haul. */
export type Shot = { miss: true } | { held: Drifting; needs: number } | { hauled: Drifting; haul: Salvage[] };

/**
 * Loose a harpoon from a gun along `aim` (in the ship's frame: any length). The gun is reloading from now.
 * Returns why not, or what came of it: the voyage's own state is changed to suit.
 */
export function looseHarpoon(v: VoyageOptions, voyage: VoyageState, seed: string, level: number, station: Station, aim: { x: number; y: number }): Shot | { error: string } {
  const def = STATIONS.harpoon;
  // A gun bears on its own side of the ship: never back across the deck.
  if (station.side !== 0 && aim.x * station.side <= 0) return { error: "That gun does not bear on the other side." };
  if (voyage.hold.length >= voyage.holdMax) return { error: "The hold is full." };
  voyage.ready[station.id] = voyage.t + def.reload;
  const sea = seaOf(seed, voyage);
  const hit = harpoonHit(sea, voyage.t, voyage.steers, new Set(voyage.taken), shipFrame(v, station.pos), aim, def.reach!, def.slack);
  if (!hit) return { miss: true };
  const needs = SEA_THINGS[hit.kind].harpoons ?? 1;
  const lines = (voyage.held[hit.n] ?? 0) + 1;
  if (lines < needs) {
    voyage.held[hit.n] = lines;
    return { held: hit, needs: needs - lines };
  }
  delete voyage.held[hit.n];
  voyage.taken.push(hit.n);
  // A rock is no salvage: the line comes back with nothing on it, and the rock is still there to strike her.
  const haul = haulOf(hit.kind, makeRng(seedFromString(`${seed}|haul|${hit.n}`)), level);
  if (haul.length === 0) {
    voyage.taken.pop();
    return { miss: true };
  }
  voyage.hold.push(haul);
  return { hauled: hit, haul };
}

/** Put the helm over a lane. Returns why not, or null: the turn is made from now. */
export function putOver(voyage: VoyageState, station: Station, dir: -1 | 1): string | null {
  if (Math.abs(lanesOver(voyage) + dir) > LANES) return dir > 0 ? "She is as far to starboard as she will go." : "She is as far to port as she will go.";
  voyage.steers.push({ at: voyage.t, dir });
  voyage.ready[station.id] = voyage.t + STATIONS.helm.reload;
  return null;
}

/** What a spell of time at sea brought: what struck the hull, whether boarders come now, and whether it is over. */
export interface SeaPassed {
  struck: { thing: Drifting; hull: number }[];
  boarding: boolean;
}

/**
 * Time at sea runs on by `ms`: what drifted into the hull strikes it, and a boarding may fall due. Nothing is
 * decided here about how it ends but the hull giving way (`outcome: "sunk"`): whether she is through depends on
 * the deck being clear, which is the reducer's to know (`through`).
 */
export function passSea(v: VoyageOptions, voyage: VoyageState, seed: string, ms: number): SeaPassed {
  const out: SeaPassed = { struck: [], boarding: false };
  if (voyage.outcome || ms <= 0) return out;
  const [from, to] = [voyage.t, voyage.t + ms];
  voyage.t = to;
  const sea = seaOf(seed, voyage);
  for (const thing of hullStrikes(sea, from, to, voyage.steers, hullOf(v), new Set([...voyage.taken, ...voyage.struck]))) {
    voyage.struck.push(thing.n);
    delete voyage.held[thing.n];
    const hull = SEA_THINGS[thing.kind].hull ?? 0;
    if (hull <= 0) continue;
    voyage.hull = Math.max(0, voyage.hull - hull);
    out.struck.push({ thing, hull });
  }
  if (voyage.hull <= 0) {
    voyage.outcome = "sunk";
    voyage.hold = [];
    return out;
  }
  if (voyage.boarded < BOARDINGS.length && to >= BOARDINGS[voyage.boarded] * voyage.ms) {
    voyage.boarded++;
    out.boarding = true;
  }
  return out;
}

/** Whether the stretch is run: the sea has no more to bring, and the last of it has drifted clear. */
export const stretchRun = (voyage: VoyageState): boolean => voyage.t >= voyage.ms + VOYAGE_TAIL_MS && voyage.boarded >= BOARDINGS.length;

/**
 * The hold shared out among so many: each gets a share of every stack, rounded up, so nobody is handed nothing of
 * something. As gold and materials, for a grant.
 */
export function holdShare(voyage: Pick<VoyageState, "hold">, among: number): { gold: number; resources: Record<string, number> } {
  const total = { gold: 0, resources: {} as Record<string, number> };
  for (const piece of voyage.hold.flat()) {
    if (piece.t === "gold") total.gold += piece.n;
    else total.resources[piece.kind] = (total.resources[piece.kind] ?? 0) + piece.n;
  }
  const share = (n: number) => Math.ceil(n / Math.max(1, among));
  return { gold: share(total.gold), resources: Object.fromEntries(Object.entries(total.resources).map(([k, n]) => [k, share(n)])) };
}

/** Where a thing with a line in it is now, for whoever draws the line: null once it is gone. */
export const heldThing = (seed: string, voyage: VoyageState, n: number): Drifting | null => driftAt(seaOf(seed, voyage), n, voyage.t, voyage.steers);
