// Fishing holes: where the fish are in the Harbor's waters right now, and fishing from anywhere along the shore.
//
// A handful of holes lie on the water at a time, some close in along the shore and some further out, where only a
// boat gets to. They move every half a day on the Harbor's clock (gameclock.ts), and the sky changes them:
// after dark one of them turns to night feeders, and in a storm one far out churns with what a storm brings up.
// Each is known for a few fish, which bite there more often (the same `bonus` a fishing spot carries).
//
// Nothing of it is stored or sent, as with the townsfolk (wander.ts): the holes follow from the crew and the clock
// alone, so every browser in a crew draws the same holes, and the server works out the same ones again when a
// line is cast. It never takes the client's word for where the hero stands or which hole they are at.

import { hexDistance, type HexPos } from "@gantt-quest/core";
import { FISH, FISH_IDS, type FishDef, type FishRarity, type Water } from "./fishcatalog";
import { FISH_SPOTS, bitesUnder, type CastSky, type FishSpot, type Vessel } from "./fishing";
import { GAME_DAY_MS, harborSky } from "./gameclock";
import { HARBOR_BOATS, HARBOR_BRIDGE, HARBOR_CAVE, HARBOR_LAPIDARY, HARBOR_PLOTS, HARBOR_RING, HARBOR_GATHER, HARBOR_LIGHTHOUSE, HARBOR_PIERS, HARBOR_PUB, HARBOR_ROCKS, HARBOR_SIDES, HARBOR_SPAWN, HARBOR_WRECK, fishSpotAt, generateHarbor, seaEdge, waterSpotAt } from "./harbor";
import { tileAt, type WorldMap } from "./map";
import { makeRng, seedFromString, type Rng } from "./rng";

/** The holes stay put this long, then move: half the Harbor's day, about one short spell of fishing. */
export const HOLE_SLOT_MS = GAME_DAY_MS / 2;
/** Holes close in, fishable from the shore beside them, and holes further out, for a boat. */
export const NEAR_HOLES = 3;
export const FAR_HOLES = 2;
/** No two holes lie closer than this, in hexes. */
const HOLE_GAP = 4;

/**
 * What a hole is: a shoal of good fish; a deep hole where the big ones lie; night feeders, after dark; churned
 * water in a storm.
 */
export type HoleKind = "shoal" | "deep" | "night" | "storm";

export const HOLE_NAMES: Record<HoleKind, string> = {
  shoal: "A shoal",
  deep: "A deep hole",
  night: "Night feeders",
  storm: "Storm water",
};

export interface FishingHole {
  /** Stable for as long as the hole stays where it is. */
  id: string;
  pos: HexPos;
  kind: HoleKind;
  /** What is fished there: a cast at the hole fishes this water, whatever the spot it is cast from. */
  water: Water;
  /** Kinds that bite more often here, and by how much (as `FishSpotDef.bonus`). */
  bonus: Record<string, number>;
  /** The fish it is known for, best first: what someone who knows the water would name. */
  featured: string[];
  /** Close in: fishable from the land beside it. Otherwise only from a boat. */
  near: boolean;
  /** Where it lies, in plain words: "off the west pier", "out past the lighthouse". */
  where: string;
  /** How good it is: the higher the better (`bestHole`). */
  worth: number;
  /** When it moves on, server clock. */
  until: number;
}

const key = (p: HexPos) => `${p.q},${p.r}`;
const around = (p: HexPos): HexPos[] => HARBOR_SIDES.map((d) => ({ q: p.q + d.q, r: p.r + d.r }));

// ---------- the shore ----------

/** The land a hero can walk to from where heroes arrive, by map: flooded once and kept. */
const walkable = new WeakMap<WorldMap, Set<string>>();
function landOf(map: WorldMap): Set<string> {
  const known = walkable.get(map);
  if (known) return known;
  const open = (p: HexPos) => {
    const t = tileAt(map, p);
    return !!t && t.biome !== "water" && t.biome !== "rampart" && !t.built && !t.blocker;
  };
  const seen = new Set<string>([key(HARBOR_SPAWN)]);
  const queue = [HARBOR_SPAWN];
  while (queue.length) {
    const p = queue.pop()!;
    for (const n of around(p)) if (!seen.has(key(n)) && open(n)) (seen.add(key(n)), queue.push(n));
  }
  walkable.set(map, seen);
  return seen;
}

/** A hex of land a hero can walk to, with water beside it: anywhere a line can be cast from the shore. */
export function shoreAt(map: WorldMap, p: HexPos): boolean {
  return landOf(map).has(key(p)) && around(p).some((n) => tileAt(map, n)?.biome === "water");
}

/**
 * Where a hero on `pos` fishes from, or null if they cannot fish there: a pier head; anywhere else along the
 * shore; or afloat (in `vessel`), the coast's waters, the rocks and the wreck, or with a rowboat at the map's
 * edge the open sea.
 */
export function fishFrom(map: WorldMap, pos: HexPos, vessel: Vessel | null): FishSpot | null {
  const t = tileAt(map, pos);
  if (!t) return null;
  if (t.biome === "water") {
    if (!vessel) return null;
    return vessel === "rowboat" && seaEdge(map, pos) ? "sea" : waterSpotAt(map, pos);
  }
  return fishSpotAt(pos) ?? (shoreAt(map, pos) ? "shore" : null);
}

// ---------- where holes can lie ----------

interface Places {
  /** Water beside the walkable shore, clear of the rocks, the wreck and the moored boats. */
  near: HexPos[];
  /** Water with no land beside it. */
  far: HexPos[];
}

const HARBOR = generateHarbor();
let places: Places | null = null;
function placesOf(): Places {
  if (places) return places;
  const land = landOf(HARBOR);
  const kept = new Set([...HARBOR_ROCKS, HARBOR_WRECK, ...HARBOR_BOATS.map((b) => b.at)].map(key));
  const near: HexPos[] = [];
  const far: HexPos[] = [];
  for (const t of HARBOR.tiles) {
    if (t.biome !== "water" || kept.has(key(t))) continue;
    const sides = around(t);
    const p = { q: t.q, r: t.r };
    if (sides.some((n) => land.has(key(n)))) near.push(p);
    else if (sides.every((n) => !tileAt(HARBOR, n) || tileAt(HARBOR, n)!.biome === "water")) far.push(p);
  }
  return (places = { near, far });
}

/** The water a hole on `p` is: the open sea at the map's edge, otherwise the coast's water there. */
function waterOf(p: HexPos): Water {
  if (seaEdge(HARBOR, p)) return "sea";
  return FISH_SPOTS[waterSpotAt(HARBOR, p) ?? "coast_south"].water;
}

/** Landmarks to say where a hole is by. */
const LANDMARKS: { at: HexPos; name: string }[] = [
  { at: HARBOR_PIERS[0], name: "the west pier" },
  { at: HARBOR_PIERS[1], name: "the middle pier" },
  { at: HARBOR_PIERS[2], name: "the east pier" },
  { at: HARBOR_LIGHTHOUSE, name: "the lighthouse" },
  { at: HARBOR_WRECK, name: "the wreck" },
  { at: HARBOR_BRIDGE[1], name: "the bridge" },
  { at: HARBOR_GATHER.fishing, name: "the fish shack" },
  { at: HARBOR_PUB, name: "the pub" },
  { at: HARBOR_GATHER.felling, name: "the woods" },
  { at: HARBOR_GATHER.quarry, name: "the quarry" },
  { at: HARBOR_CAVE, name: "the caverns" },
  { at: HARBOR_RING, name: "the sparring ring" },
  { at: HARBOR_LAPIDARY, name: "the Lapidary" },
  { at: HARBOR_PLOTS[HARBOR_PLOTS.length - 1], name: "the huts" },
];
function whereOf(p: HexPos, near: boolean): string {
  const mark = LANDMARKS.reduce((a, b) => (hexDistance(b.at, p) < hexDistance(a.at, p) ? b : a));
  return `${near ? "off" : "out past"} ${mark.name}`;
}

// ---------- the holes ----------

/** What a fish is worth to find, by rarity: how much a hole known for it is worth. */
const RARITY_WORTH: Record<FishRarity, number> = { common: 0.5, uncommon: 1, rare: 3, legendary: 8, mythic: 20 };

const shuffle = <T>(rng: Rng, items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** The living catch of `water` that bites under `sky`, of the given rarities. */
const catchOf = (water: Water, sky: CastSky, rarities: FishRarity[]): FishDef[] =>
  FISH_IDS.map((id) => FISH[id]).filter((f) => f.kind !== "haul" && f.water.includes(water) && rarities.includes(f.rarity) && bitesUnder(f, sky));

const FISH_RARITIES_LIVING: FishRarity[] = ["common", "uncommon", "rare", "legendary"];

/** What a hole of `kind` in `water` is known for, and how much more often each bites there. */
function stock(rng: Rng, kind: HoleKind, water: Water, sky: CastSky): Record<string, number> {
  const bonus: Record<string, number> = {};
  const add = (fish: FishDef[], n: number, by: number) => {
    for (const f of shuffle(rng, fish).filter((f) => !(f.id in bonus)).slice(0, n)) bonus[f.id] = by;
  };
  if (kind === "night") add(catchOf(water, sky, FISH_RARITIES_LIVING).filter((f) => f.night), 2, 4);
  if (kind === "storm") add(catchOf(water, sky, FISH_RARITIES_LIVING).filter((f) => f.storm), 2, 4);
  if (kind === "shoal") add(catchOf(water, sky, ["uncommon"]), 2, 3);
  if (kind === "deep") add(catchOf(water, sky, ["rare"]), 2, 2.5);
  // Every hole has something good about it besides: one rare, or better out in the deep and in the dark.
  add(catchOf(water, sky, kind === "shoal" ? ["rare"] : ["rare", "legendary"]), 1, 2);
  return bonus;
}
/** Whether a night (or storm) hole on this water would have anything of its own to show. */
const hasOwn = (water: Water, sky: CastSky, flag: "night" | "storm") => catchOf(water, sky, FISH_RARITIES_LIVING).some((f) => f[flag]);

/** Where the crew's holes lie in the half-day `slot`: places only, as the sky does not move them. */
function laid(crewId: string, slot: number): { pos: HexPos; near: boolean; base: HoleKind }[] {
  const rng = makeRng(seedFromString(`${crewId}:holes:${slot}`));
  const { near, far } = placesOf();
  const out: { pos: HexPos; near: boolean; base: HoleKind }[] = [];
  const clear = (p: HexPos) => out.every((h) => hexDistance(h.pos, p) >= HOLE_GAP);
  const take = (from: HexPos[], n: number, isNear: boolean, first?: (p: HexPos) => boolean) => {
    const order = shuffle(rng, from);
    // The first of each lot is laid where it can be what the dark (or a storm) makes of it, so there always is one.
    const lead = first ? order.find((p) => first(p) && clear(p)) : undefined;
    let left = n;
    if (lead) (out.push({ pos: lead, near: isNear, base: rng.chance(0.6) ? "shoal" : "deep" }), left--);
    for (const p of order) {
      if (left === 0) break;
      if (!clear(p)) continue;
      out.push({ pos: p, near: isNear, base: rng.chance(0.6) ? "shoal" : "deep" });
      left--;
    }
  };
  const anySky = { night: true, storm: true };
  take(near, NEAR_HOLES, true, (p) => hasOwn(waterOf(p), anySky, "night"));
  take(far, FAR_HOLES, false, (p) => hasOwn(waterOf(p), anySky, "storm"));
  return out;
}

/**
 * The crew's fishing holes at `now`: where they lie this half-day, what each is known for under this sky. After
 * dark the first hole close in is night feeders; in a storm the first far out is storm water.
 */
export function fishingHoles(crewId: string, now: number): FishingHole[] {
  const slot = Math.floor(now / HOLE_SLOT_MS);
  const sky = harborSky(now);
  const until = (slot + 1) * HOLE_SLOT_MS;
  const nearLead = 0;
  const farLead = NEAR_HOLES;
  return laid(crewId, slot).map((h, i) => {
    const water = waterOf(h.pos);
    const kind: HoleKind = sky.night && i === nearLead && hasOwn(water, sky, "night") ? "night" : sky.storm && i === farLead && hasOwn(water, sky, "storm") ? "storm" : h.base;
    // Each hole's stock is its own draw, so a hole turning to night feeders leaves the others as they were.
    const rng = makeRng(seedFromString(`${crewId}:hole:${slot}:${i}:${kind}`));
    const bonus = stock(rng, kind, water, sky);
    const featured = Object.keys(bonus).sort((a, b) => RARITY_WORTH[FISH[b].rarity] * bonus[b] - RARITY_WORTH[FISH[a].rarity] * bonus[a]);
    const worth = Math.round(featured.reduce((a, id) => a + RARITY_WORTH[FISH[id].rarity] * bonus[id], 0) * 10) / 10;
    return { id: `${slot}-${i}-${kind}`, pos: h.pos, kind, water, bonus, featured, near: h.near, where: whereOf(h.pos, h.near), worth, until };
  });
}

/** The best hole there is at `now`: the one a fishmonger would point you to. `near` keeps to holes reachable from the shore. */
export function bestHole(crewId: string, now: number, near = false): FishingHole {
  const holes = fishingHoles(crewId, now).filter((h) => !near || h.near);
  return holes.reduce((a, b) => (b.worth > a.worth ? b : a));
}

/** The hole a hero on `pos` is fishing at, if any: on it or beside it, the best if there are two. */
export function holeAt(crewId: string, now: number, pos: HexPos): FishingHole | null {
  const by = fishingHoles(crewId, now).filter((h) => hexDistance(h.pos, pos) <= 1);
  return by.length ? by.reduce((a, b) => (b.worth > a.worth ? b : a)) : null;
}

/** A hole's bonus laid over a spot's own, kind by kind (the larger of the two). */
export function withHole(bonus: Record<string, number> | undefined, hole: FishingHole | null): Record<string, number> | undefined {
  if (!hole) return bonus;
  const out = { ...(bonus ?? {}) };
  for (const [id, by] of Object.entries(hole.bonus)) out[id] = Math.max(out[id] ?? 1, by);
  return out;
}

/** "Mackerel, Sea Bass" for a hole's fish, as many as `n`. */
export const holeFishNames = (hole: FishingHole, n = 2): string => hole.featured.slice(0, n).map((id) => FISH[id].name).join(", ");

