// The garden: a patch of beds by a hut's door, in the corner of its doorstep,
// that its owner plants and picks and the whole crew can tend.
//
// A bed is planted with a packet of herb seeds (sold at the market stall) or a
// herb from the owner's own stock, and grows herbs; or with a mushroom from the
// owner's stock (picked in the caverns), and grows mushrooms, a little slower.
// It grows in real time: no timer runs for
// it anywhere. It is stored as when it was planted and when it will be ready,
// and everything about it (how far it has grown, what it looks like) is worked
// out from those and the clock. A ready bed waits, sparkling, for as long as it
// takes to be picked.
//
// Anyone in the crew may water a bed once while it grows (an extra herb when it
// is picked) and feed it bonemeal once (it grows faster). Bonemeal is ground
// from bone. Pure functions: the server holds the beds and moves the materials.

import { HUT_TIERS, type ResourceKind, type Resources } from "./hut";
import { makeRng, seedFromString } from "./rng";
import { HARBOR_GARDEN_SPOTS, HARBOR_PLOTS, HARBOR_PLOT_FACING } from "./harbor";
import type { HexPos } from "@gantt-quest/core";

/** How many beds a garden has, by the tier of the hut it belongs to: a Shack's two, a Cottage's three, a Lodge's four. */
export const GARDEN_BEDS: Record<number, number> = { 1: 2, 2: 3, 3: 4 };
/** The beds in the garden of a hut of `tier`. */
export const gardenBeds = (tier: number): number => GARDEN_BEDS[Math.max(1, Math.min(HUT_TIERS.length, Math.floor(tier) || 1))] ?? 2;

/** What a bed grows: herbs, or mushrooms. */
export const CROPS = ["herbs", "mushrooms"] as const satisfies readonly ResourceKind[];
export type Crop = (typeof CROPS)[number];
/** A crop as stored: mushrooms if it says so, else herbs (what every bed grew before mushrooms could be). */
export const asCrop = (s: unknown): Crop => (s === "mushrooms" ? "mushrooms" : "herbs");
/** How long a bed of herbs takes from planting to picking, without bonemeal. */
export const GROW_MS = 6 * 60 * 60_000;
/** How long a bed of each crop takes from planting to picking, without bonemeal: mushrooms take their time. */
export const CROP_GROW_MS: Record<Crop, number> = { herbs: GROW_MS, mushrooms: 8 * 60 * 60_000 };
/** What a feed of bonemeal takes off the growing still to do: half of it. */
export const BONEMEAL_CUT = 0.5;
/** Bonemeal ground from one bone. */
export const BONEMEAL_PER_BONE = 2;
/** Herbs (or mushrooms) a bed gives when it is picked, fewest to most, before watering. */
export const GARDEN_YIELD: [number, number] = [2, 3];
/** The extra herb (or mushroom) a watered bed gives. */
export const WATERED_BONUS = 1;
/** Gold the market stall asks for a packet of herb seeds. */
export const SEED_PRICE = 10;
/** Waterings a full watering can holds: enough for a Lodge's four beds. It is filled at the town well. */
export const CAN_CAPACITY = 4;
/** Gold the market stall asks for a watering can. */
export const CAN_PRICE = 15;
/** The most packets bought at once. */
export const SEED_BUY_MAX = 20;
/** What a bed can be planted with: a packet of seeds or a herb from the owner's stock, or a mushroom. */
export const SOW_WITH = ["seeds", "herbs", "mushrooms"] as const satisfies readonly ResourceKind[];
export type SowWith = (typeof SOW_WITH)[number];
/** What a bed planted with `sow` grows: seeds and herbs grow herbs, a mushroom grows mushrooms. */
export const cropOf = (sow: SowWith): Crop => (sow === "mushrooms" ? "mushrooms" : "herbs");

/** A bed with something growing in it. An empty bed has none. */
export interface GardenBed {
  bed: number;
  /** What grows in it. */
  crop: Crop;
  plantedAt: number;
  readyAt: number;
  /** Who watered it while it grew, by name, if anyone did. */
  wateredBy?: string;
  /** Who fed it bonemeal, by name, if anyone did. */
  fedBy?: string;
}

/**
 * How a bed looks, step by step as it grows: bare earth, seed just in, the first shoots, young plants, a full bush,
 * ready to pick (for mushrooms: the first pale buttons, small caps, nearly full caps, a cluster ready to pick).
 */
export type BedStage = "empty" | "sown" | "sprout" | "young" | "leafy" | "ready";
export const BED_STAGES: readonly BedStage[] = ["empty", "sown", "sprout", "young", "leafy", "ready"];

/** How far a bed has grown, 0 to 1 (1 is ready). */
export function bedProgress(bed: Pick<GardenBed, "plantedAt" | "readyAt">, now: number): number {
  const span = bed.readyAt - bed.plantedAt;
  if (span <= 0 || now >= bed.readyAt) return 1;
  return Math.max(0, Math.min(1, (now - bed.plantedAt) / span));
}

/** What a bed looks like now. */
export function bedStage(bed: Pick<GardenBed, "plantedAt" | "readyAt"> | null | undefined, now: number): BedStage {
  if (!bed) return "empty";
  const p = bedProgress(bed, now);
  return p >= 1 ? "ready" : p < 0.08 ? "sown" : p < 0.35 ? "sprout" : p < 0.7 ? "young" : "leafy";
}

/** A bed as the renderer draws it: how far along, and whether it has been watered and fed. */
export interface BedLook {
  stage: BedStage;
  /** What grows in it (herbs while it is empty). */
  crop: Crop;
  watered: boolean;
  fed: boolean;
}

/** Every bed of a garden of `count` beds as it looks now, the empty ones too. */
export function gardenLooks(beds: readonly GardenBed[], count: number, now: number): BedLook[] {
  return Array.from({ length: count }, (_, i) => {
    const b = beds.find((x) => x.bed === i);
    return { stage: bedStage(b, now), crop: b?.crop ?? "herbs", watered: !!b?.wateredBy, fed: !!b?.fedBy };
  });
}

/** When the next bed of a garden is ready, or null if none is growing. */
export function nextReady(beds: readonly GardenBed[], now: number): number | null {
  const growing = beds.filter((b) => b.readyAt > now).map((b) => b.readyAt);
  return growing.length > 0 ? Math.min(...growing) : null;
}

/** How many beds are ready to pick. */
export const readyCount = (beds: readonly GardenBed[], now: number): number => beds.filter((b) => b.readyAt <= now).length;

/** "2h 15m", "40m", "under a minute": how long until `at`. */
export function growText(at: number, now: number): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 1) return "under a minute";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// ---------- checks ----------

/** Why the owner cannot plant bed `bed` with `with_` now, or null if they can. */
export function plantProblem(ctx: { tier: number; beds: readonly GardenBed[]; resources: Resources }, bed: unknown, with_: unknown): string | null {
  if (!Number.isInteger(bed) || (bed as number) < 0 || (bed as number) >= gardenBeds(ctx.tier)) return "There is no such bed.";
  const sow = SOW_WITH.find((k) => k === with_);
  if (!sow) return "Plant it with herb seeds, a herb or a mushroom.";
  if (ctx.beds.some((b) => b.bed === bed)) return "Something is already growing there.";
  if ((ctx.resources[sow] ?? 0) < 1) {
    return sow === "seeds" ? "You have no herb seeds. The market stall sells them." : sow === "mushrooms" ? "You have no mushrooms to plant. They grow in the caverns." : "You have no herbs to plant.";
  }
  return null;
}

/**
 * Why bed `bed` cannot be watered now by someone whose watering can holds `water` waterings (null: they have no
 * can), or null if it can.
 */
export function waterProblem(bed: GardenBed | undefined, now: number, water: number | null): string | null {
  if (!bed) return "Nothing is growing there to water.";
  if (bed.readyAt <= now) return "It is ready to pick: no need to water it.";
  if (bed.wateredBy) return `${bed.wateredBy} has watered it already.`;
  if (water === null) return "You have no watering can. The market stall sells them.";
  if (water < 1) return "Your watering can is empty. Fill it at the well on the green.";
  return null;
}

/** Why someone whose can holds `water` (null: no can) cannot fill it at the well now, or null if they can. */
export function fillProblem(water: number | null): string | null {
  if (water === null) return "You have no watering can to fill. The market stall sells them.";
  if (water >= CAN_CAPACITY) return "Your watering can is full already.";
  return null;
}

/** Why someone with `gold` whose can holds `water` (null: no can) cannot buy a watering can, or null if they can. */
export function canBuyProblem(water: number | null, gold: number): string | null {
  if (water !== null) return "You have a watering can already.";
  if (gold < CAN_PRICE) return "Not enough gold.";
  return null;
}

/** Why bed `bed` cannot be fed bonemeal by someone holding `resources`, or null if it can. */
export function feedProblem(bed: GardenBed | undefined, resources: Resources, now: number): string | null {
  if (!bed) return "Nothing is growing there to feed.";
  if (bed.readyAt <= now) return "It is ready to pick already.";
  if (bed.fedBy) return `${bed.fedBy} has fed it bonemeal already.`;
  if ((resources.bonemeal ?? 0) < 1) return "You have no bonemeal. Grind some from a bone.";
  return null;
}

/** When a bed fed bonemeal now will be ready: half of what it still had to grow is taken off. */
export const fedReadyAt = (bed: Pick<GardenBed, "readyAt">, now: number): number => Math.max(now, Math.round(bed.readyAt - Math.max(0, bed.readyAt - now) * BONEMEAL_CUT));

/** Why `qty` bones cannot be ground into bonemeal by someone holding `resources`, or null if they can. */
export function grindProblem(qty: unknown, resources: Resources): string | null {
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > 99) return "Grind one bone or more.";
  if ((resources.bone ?? 0) < (qty as number)) return (resources.bone ?? 0) > 0 ? `You have only ${resources.bone} bone.` : "You have no bones to grind.";
  return null;
}

/** Why `qty` packets of seeds cannot be bought by someone with `gold`, or null if they can. */
export function seedBuyProblem(qty: unknown, gold: number): string | null {
  if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > SEED_BUY_MAX) return `Buy between 1 and ${SEED_BUY_MAX} packets.`;
  if (gold < (qty as number) * SEED_PRICE) return "Not enough gold.";
  return null;
}

/**
 * The herbs (or mushrooms) a bed gives when it is picked: rolled from the owner, the bed and when it was planted, so
 * asking twice for the same planting gives the same, and a watered bed one more.
 */
export function bedYield(ownerId: string, bed: Pick<GardenBed, "bed" | "plantedAt" | "wateredBy">): number {
  const rng = makeRng(seedFromString(`${ownerId}|garden|${bed.bed}|${bed.plantedAt}`));
  return rng.int(GARDEN_YIELD[0], GARDEN_YIELD[1]) + (bed.wateredBy ? WATERED_BONUS : 0);
}

/** What picking every bed in `beds` gives, crop by crop (a crop with none is left out). */
export function gardenHarvest(ownerId: string, beds: readonly GardenBed[]): Partial<Record<Crop, number>> {
  const out: Partial<Record<Crop, number>> = {};
  for (const b of beds) out[b.crop] = (out[b.crop] ?? 0) + bedYield(ownerId, b);
  return out;
}

/** "3 herbs and 2 mushrooms", "1 herb": what a harvest comes to, in words. */
export function harvestText(h: Partial<Record<Crop, number>>): string {
  const word: Record<Crop, [string, string]> = { herbs: ["herb", "herbs"], mushrooms: ["mushroom", "mushrooms"] };
  const parts = CROPS.filter((c) => (h[c] ?? 0) > 0).map((c) => `${h[c]} ${word[c][h[c] === 1 ? 0 : 1]}`);
  return parts.length > 0 ? parts.join(" and ") : "nothing";
}

// ---------- where it is ----------

/**
 * The corner of each plot's doorstep its garden is laid out in (a corner as the town's dressing counts them, see
 * townDressing.ts): beside the door, on the side away from the path, where the patch of garden has always been.
 */
export const gardenCorner = (plot: number): number => ((HARBOR_PLOT_FACING[plot] ?? 0) + 4) % 6;
/** Where a hero stands to tend each plot's garden (see HARBOR_GARDEN_SPOTS). */
export const GARDEN_SPOTS = HARBOR_GARDEN_SPOTS;
/** The plot whose garden is tended from `pos`, or -1. */
export const gardenSpotAt = (pos: HexPos): number => GARDEN_SPOTS.findIndex((p) => p.q === pos.q && p.r === pos.r);
/** The plot whose doorstep is `pos`, or -1. */
export const plotAt = (pos: HexPos): number => HARBOR_PLOTS.findIndex((p) => p.q === pos.q && p.r === pos.r);
