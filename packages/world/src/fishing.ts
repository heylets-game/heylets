// Fishing: where you can fish from, what comes up on the line, how big it
// is, and what it is worth.
//
// A sitting (sitting.ts) rolls one catch per cast with `rollCatch` and
// `rollSize`, then hands it to the fight (fishfight.ts). Everything here runs
// on the server only: the client is told what it caught once it is landed.

import { FISH, FISH_IDS, KEPT_HAUL_PRICE, type FishDef, type FishRarity, type Water } from "./fishcatalog";
import type { Rng } from "./rng";

/**
 * Where a sitting is fished from: a pier head, or anywhere else along the shore; afloat, the coast's waters (by barrel or
 * rowboat), by the rocks and the wreck; or, by rowboat, the open sea.
 */
export type FishSpot = "west" | "middle" | "east" | "shore" | "coast_west" | "coast_south" | "coast_east" | "wreck" | "sea";
export const FISH_SPOT_IDS: FishSpot[] = ["west", "middle", "east", "shore", "coast_west", "coast_south", "coast_east", "wreck", "sea"];

/** A boat a hero can take out: a barrel keeps to the coast; a rowboat goes anywhere, and out to sea. */
export type Vessel = "barrel" | "rowboat";

/**
 * The boats the fishmonger sells, by their furnishing id (hut.ts), for gold: the same boats as are crafted at home, for
 * those who would rather pay than build. A rowboat does everything a barrel does, so one is never sold to a hero who
 * has the other the better way round.
 */
export type BoatId = "float_barrel" | "rowboat";
export const BOAT_IDS: BoatId[] = ["float_barrel", "rowboat"];
export const BOAT_SALE: Record<BoatId, { vessel: Vessel; price: number }> = {
  float_barrel: { vessel: "barrel", price: 80 },
  rowboat: { vessel: "rowboat", price: 300 },
};
export const isBoatId = (id: unknown): id is BoatId => BOAT_IDS.includes(id as BoatId);

/** Why a hero whose best boat is `have` cannot buy `boat` with `gold`, or null if they can. */
export function boatBuyProblem(boat: BoatId, have: Vessel | null, gold: number): string | null {
  const vessel = BOAT_SALE[boat].vessel;
  if (have === vessel) return vessel === "rowboat" ? "You have a rowboat already." : "You have a barrel already.";
  if (have === "rowboat") return "You have a rowboat. A barrel would be a step down.";
  if (gold < BOAT_SALE[boat].price) return `That costs ${BOAT_SALE[boat].price} gold.`;
  return null;
}

/** Why `vessel` cannot take a hero to `spot`, or null if it can (or the spot is ashore). */
export function vesselProblem(spot: FishSpot, vessel: Vessel | null | undefined): string | null {
  const need = FISH_SPOTS[spot]?.vessel;
  if (!need) return null;
  if (!vessel) return "You need a boat to fish out there.";
  if (need === "rowboat" && vessel !== "rowboat") return "A barrel will not get you out to the open sea. You need a rowboat.";
  return null;
}

export interface FishSpotDef {
  id: FishSpot;
  name: string;
  water: Water;
  /** How far a full cast reaches, 0 to 1: the shore only gets short casts. */
  maxCast: number;
  /** Not yet fishable. */
  closed?: string;
  /** Fished afloat: the least boat that gets there. */
  vessel?: Vessel;
  /** Kinds that bite more often here, and by how much. */
  bonus?: Record<string, number>;
}

export const FISH_SPOTS: Record<FishSpot, FishSpotDef> = {
  west: { id: "west", name: "The west pier", water: "shallows", maxCast: 1 },
  middle: { id: "middle", name: "The middle pier", water: "mouth", maxCast: 1 },
  east: { id: "east", name: "The east pier", water: "deep", maxCast: 1 },
  shore: { id: "shore", name: "From the shore", water: "shallows", maxCast: 0.5 },
  coast_west: { id: "coast_west", name: "Off the west coast", water: "shallows", maxCast: 1, vessel: "barrel" },
  coast_south: { id: "coast_south", name: "In the harbor mouth", water: "mouth", maxCast: 1, vessel: "barrel" },
  coast_east: { id: "coast_east", name: "Off the east coast", water: "deep", maxCast: 1, vessel: "barrel" },
  wreck: { id: "wreck", name: "By the rocks and the wreck", water: "deep", maxCast: 1, vessel: "barrel", bonus: { wreck_grouper: 2, blue_lobster: 2 } },
  sea: { id: "sea", name: "The open sea", water: "sea", maxCast: 1, vessel: "rowboat" },
};

/** Bites per hundred, by rarity, before a cast's reach shifts them. */
export const RARITY_WEIGHT: Record<FishRarity, number> = { common: 60, uncommon: 25, rare: 10, legendary: 1.5, mythic: 0.05 };
/** The share of bites that are hauls (junk and treasure) rather than anything alive. */
export const HAUL_SHARE = 0.12;
/** Specimens are in the top fifth of their kind's weight. Every rare or better catch is one. */
export const SPECIMEN_SHARE = 0.2;

/** How far out a cast lands, in metres, for a reach of 0 to 1. */
export const castMetres = (reach: number): number => Math.round(5 + 30 * Math.max(0, Math.min(1, reach)));

/** A far cast finds rarer fish: commons thin out, rare and legendary bites grow. */
function reachWeight(rarity: FishRarity, reach: number): number {
  const base = RARITY_WEIGHT[rarity];
  if (rarity === "common") return base * (1.2 - 0.4 * reach);
  if (rarity === "uncommon") return base;
  if (rarity === "rare") return base * (0.6 + 0.8 * reach);
  return base * (0.4 + 1.2 * reach);
}

function weighted<T>(rng: Rng, items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let roll = rng.next() * total;
  for (const [item, w] of items) if ((roll -= w) < 0) return item;
  return items[items.length - 1][0];
}

/**
 * Bait on the hook: makes some kinds of fish bite more often, by rarity. Hauls do not care what is on the hook.
 * Each suits one kind of fishing hole (fishingholes.ts), and is at its best there: worms for a shoal's middling
 * fish, shrimp for a deep hole's big ones, a glow lure for night feeders (and only after dark).
 */
export type BaitId = "worms" | "shrimp" | "glow_lure";
export const BAIT_IDS: BaitId[] = ["worms", "shrimp", "glow_lure"];

export interface BaitDef {
  id: BaitId;
  name: string;
  blurb: string;
  /** How much more (or less) often each rarity bites with it on. */
  rarity: Partial<Record<FishRarity, number>>;
  /** Works only after dark. */
  nightOnly?: boolean;
  /** Night fish bite this much more often again (after dark). */
  nightFish?: number;
  /** The kind of fishing hole it suits. */
  suits: "shoal" | "deep" | "night";
}

export const BAITS: Record<BaitId, BaitDef> = {
  worms: { id: "worms", name: "Worms", blurb: "Everyday bait. Fewer tiddlers, more of the fish worth keeping.", rarity: { common: 0.6, uncommon: 2, rare: 1.1 }, suits: "shoal" },
  shrimp: { id: "shrimp", name: "Shrimp", blurb: "What the big fish eat. The small ones leave it alone.", rarity: { common: 0.5, uncommon: 0.7, rare: 1.6, legendary: 1.3 }, suits: "deep" },
  glow_lure: { id: "glow_lure", name: "Glow lure", blurb: "A painted lure that shines in the dark. Useless by day.", rarity: { rare: 1.4, legendary: 1.5 }, nightOnly: true, nightFish: 2.5, suits: "night" },
};

export const isBaitId = (id: unknown): id is BaitId => BAIT_IDS.includes(id as BaitId);

/**
 * What the fishmonger sells bait for. Worms and shrimp go by the tin and the pot, and one is eaten on every cast. A
 * lure is bought one at a time and comes back with the line, unless the line goes with the fish (`lineLost`).
 */
export interface BaitSale {
  /** Gold for one lot. */
  price: number;
  /** How many come in a lot. */
  per: number;
  /** "a tin of ten". */
  lot: string;
  /** The most a hero carries. */
  max: number;
  /** Kept between casts: lost only with the line. */
  lure?: true;
}

export const BAIT_SALE: Record<BaitId, BaitSale> = {
  worms: { price: 6, per: 10, lot: "a tin of ten", max: 60 },
  shrimp: { price: 15, per: 10, lot: "a pot of ten", max: 60 },
  glow_lure: { price: 35, per: 1, lot: "one lure", max: 3, lure: true },
};

/** How much bait of each kind a hero has. A kind they have none of may be left out. */
export type BaitCounts = Partial<Record<BaitId, number>>;

/** Why a hero with `have` of `kind` and `gold` cannot buy a lot of it, or null if they can. */
export function baitBuyProblem(kind: BaitId, have: number, gold: number): string | null {
  const sale = BAIT_SALE[kind];
  if (have + sale.per > sale.max) return sale.lure ? `You can carry only ${sale.max} glow lures.` : `Your ${BAITS[kind].name.toLowerCase()} won't keep past ${sale.max}. Use some first.`;
  if (gold < sale.price) return `That's ${sale.price} gold, and you've ${gold}.`;
  return null;
}

/** Whether a cast with `bait` on uses one up. Bait is taken by the bite; a lure comes back on the line. */
export const baitEaten = (bait: BaitId | null | undefined): bait is BaitId => !!bait && !BAIT_SALE[bait].lure;

/** How much more often `f` bites with `bait` on, under a sky that is `night` or not. */
export function baitWeight(f: FishDef, bait: BaitId | null | undefined, night: boolean): number {
  const b = bait ? BAITS[bait] : undefined;
  if (!b || f.kind === "haul" || (b.nightOnly && !night)) return 1;
  return (b.rarity[f.rarity] ?? 1) * (f.night && night ? b.nightFish ?? 1 : 1);
}

/** The sky a cast is made under: night and storm fish bite only then. */
export interface CastSky {
  night: boolean;
  storm: boolean;
}

/** Whether `f` bites at all under `sky`. */
export const bitesUnder = (f: FishDef, sky: CastSky): boolean => (!f.night || sky.night) && (!f.storm || sky.storm);

/** What bites on a cast into `water` that reached `reach` (0 to 1) of the way out, under `sky` (by day, fair, if not given), with `bait` on the hook. */
export function rollCatch(rng: Rng, water: Water, reach: number, bonus: Record<string, number> = {}, sky: CastSky = { night: false, storm: false }, bait: BaitId | null = null): FishDef {
  const haul = rng.next() < HAUL_SHARE;
  const pool = FISH_IDS.map((id) => FISH[id]).filter((f) => f.water.includes(water) && (f.kind === "haul") === haul && bitesUnder(f, sky));
  return weighted(rng, pool.map((f) => [f, (haul ? RARITY_WEIGHT[f.rarity] : reachWeight(f.rarity, reach)) * (bonus[f.id] ?? 1) * baitWeight(f, bait, sky.night)] as [FishDef, number]));
}

export interface FishSize {
  grams: number;
  mm: number;
  specimen: boolean;
}

/**
 * How big this one is. Most are small; a far cast leans a little larger.
 * Weight follows length cubed between the kind's ends, give or take how well
 * fed it is.
 */
export function rollSize(rng: Rng, def: FishDef, reach: number): FishSize {
  const [l0, l1] = def.lengthCm;
  const [w0, w1] = def.weightKg;
  const r = Math.pow(rng.next(), 2.2 - 0.6 * Math.max(0, Math.min(1, reach)));
  const length = l0 + (l1 - l0) * r;
  const cube = l1 === l0 ? r : (length ** 3 - l0 ** 3) / (l1 ** 3 - l0 ** 3);
  const condition = 0.9 + 0.2 * rng.next();
  const kg = Math.max(w0 * 0.9, Math.min(w1 * 1.08, (w0 + (w1 - w0) * cube) * condition));
  const grams = Math.max(1, Math.round(kg * 1000));
  const rare = def.rarity === "rare" || def.rarity === "legendary" || def.rarity === "mythic";
  const specimen = def.kind !== "haul" && (rare || kg >= w0 + (1 - SPECIMEN_SHARE) * (w1 - w0));
  return { grams, mm: Math.round(length * 10), specimen };
}

/** The fishmonger's price: by weight, at today's `rate`, a quarter more for a specimen. Plain hauls are worth nothing. */
export function marketPrice(def: FishDef, grams: number, specimen: boolean, rate = 1): number {
  if (def.kind === "haul") return KEPT_HAUL_PRICE[def.id] ?? 0;
  return Math.max(1, Math.round(def.pricePerKg * Math.pow(grams / 1000, 0.85) * rate * (specimen ? 1.25 : 1)));
}

/**
 * What Old Tam pays for the pub's kitchen, at his steady rate (TAM_RATE): what the fishmonger pays on an ordinary
 * board, every day, with nothing more for a specimen. Null for anything he will not cook. His stew of the day pays
 * more (fishmarket.ts).
 */
export const TAM_RATE = 1;
export function tamPrice(def: FishDef, grams: number): number | null {
  if (!def.kitchen) return null;
  return marketPrice(def, grams, false, TAM_RATE);
}

/** The measures a player reads catches in. Weights and lengths are always stored in grams and millimetres. */
export type Units = "metric" | "imperial";

const GRAMS_PER_OZ = 28.349523125;
const MM_PER_INCH = 25.4;

/** Metric "1.24 kg", "860 g"; imperial "12 lb 4 oz", "5.3 oz". */
export function formatWeight(grams: number, units: Units = "metric"): string {
  if (units === "imperial") {
    const oz = grams / GRAMS_PER_OZ;
    // Rounded first, so 15.98 oz reads as a pound, not "16 oz".
    if (Math.round(oz) < 16) return `${oz < 10 ? oz.toFixed(1) : Math.round(oz)} oz`;
    const lb = Math.floor(oz / 16);
    const rest = Math.round(oz - lb * 16);
    return rest === 16 ? `${lb + 1} lb` : rest === 0 || lb >= 100 ? `${lb} lb` : `${lb} lb ${rest} oz`;
  }
  return grams >= 1000 ? `${(grams / 1000).toFixed(grams >= 100_000 ? 0 : grams >= 10_000 ? 1 : 2)} kg` : `${grams} g`;
}

/** Metric "62 cm", "2.4 m"; imperial "24 in", "7 ft 10 in". */
export function formatLength(mm: number, units: Units = "metric"): string {
  if (units === "imperial") {
    const inches = Math.round(mm / MM_PER_INCH);
    if (inches < 60) return `${inches} in`;
    const ft = Math.floor(inches / 12);
    return inches % 12 === 0 ? `${ft} ft` : `${ft} ft ${inches % 12} in`;
  }
  return mm >= 1000 ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm / 10)} cm`;
}

/** A load, as the creel shows it: "11.4 kg" or "25 lb". */
export function formatLoad(grams: number, units: Units = "metric"): string {
  if (units === "imperial") {
    const lb = grams / (GRAMS_PER_OZ * 16);
    return `${lb < 10 ? lb.toFixed(1) : Math.round(lb)} lb`;
  }
  return `${(grams / 1000).toFixed(grams >= 10_000 ? 0 : 1)} kg`;
}
