// What drifts past a ship at sea (voyage/drift.ts): salvage to harpoon and
// haul aboard, and rocks to steer round.
//
// A new kind of thing is a line in SEA_THINGS: how big it is (how forgiving
// the aim), how fast it drifts, how often it turns up, how many harpoons it
// takes to bring in, and what it is worth (`haul`) or what it does to the
// hull (`hull`).

import type { ResourceKind } from "../hut";
import type { Rng } from "../rng";

export type SeaThingId = "driftwood" | "crate" | "barrel" | "bottle" | "wreckage" | "rock";

/** Something hauled aboard, as the hold keeps it: gold, or so much of a material. */
export type Salvage = { t: "gold"; n: number } | { t: "res"; kind: ResourceKind; n: number };

export interface SeaThingDef {
  id: SeaThingId;
  name: string;
  /** How far from its middle a harpoon may pass and still take it, in hexes. */
  size: number;
  /** How fast it drifts astern, as a multiple of the sea's own pace: light things ride the wind. */
  pace: number;
  /** How often it turns up, against the others. */
  weight: number;
  /** How many harpoons it takes to bring in (each must strike while the last still holds). Left out: one. */
  harpoons?: number;
  /** What hauling it aboard puts in the hold. Left out: it is no salvage. */
  haul?: (rng: Rng, level: number) => Salvage[];
  /** What it takes off the hull when it strikes the ship. Left out: it bumps along the side and does no harm. */
  hull?: number;
}

/** What a crate may hold. */
const CRATE_KINDS: ResourceKind[] = ["wood", "iron", "copper", "fur", "stone"];
/** Gold in a find: more the further out the water is. */
const gold = (rng: Rng, lo: number, hi: number, level: number): Salvage => ({ t: "gold", n: Math.round(rng.int(lo, hi) * (1 + (level - 1) * 0.15)) });

export const SEA_THINGS: Record<SeaThingId, SeaThingDef> = {
  driftwood: { id: "driftwood", name: "Driftwood", size: 0.6, pace: 1, weight: 10, haul: (rng) => [{ t: "res", kind: "wood", n: rng.int(2, 4) }] },
  crate: { id: "crate", name: "Crate", size: 0.5, pace: 1, weight: 7, haul: (rng, level) => [{ t: "res", kind: rng.pick(CRATE_KINDS), n: rng.int(2, 5) }, gold(rng, 2, 6, level)] },
  barrel: { id: "barrel", name: "Barrel", size: 0.45, pace: 1.15, weight: 5, haul: (rng, level) => [gold(rng, 8, 18, level)] },
  bottle: { id: "bottle", name: "Bottle", size: 0.3, pace: 1.3, weight: 2, haul: (rng, level) => [gold(rng, 14, 30, level), { t: "res", kind: "gem", n: rng.chance(0.25) ? 1 : 0 }] },
  wreckage: {
    id: "wreckage", name: "Wreckage", size: 0.9, pace: 0.8, weight: 3, harpoons: 2,
    haul: (rng, level) => [{ t: "res", kind: "wood", n: rng.int(5, 9) }, { t: "res", kind: "iron", n: rng.int(2, 4) }, gold(rng, 6, 14, level)],
  },
  rock: { id: "rock", name: "Rock", size: 0.8, pace: 0.7, weight: 4, hull: 8 },
};

export const SEA_THING_IDS = Object.keys(SEA_THINGS) as SeaThingId[];

/** One kind of thing, picked by weight. */
export function rollSeaThing(rng: Rng): SeaThingId {
  const total = SEA_THING_IDS.reduce((n, id) => n + SEA_THINGS[id].weight, 0);
  let at = rng.next() * total;
  return SEA_THING_IDS.find((id) => (at -= SEA_THINGS[id].weight) < 0) ?? "driftwood";
}

/** What hauling a thing aboard puts in the hold (nothing of nothing: an empty find is left out). */
export function haulOf(id: SeaThingId, rng: Rng, level: number): Salvage[] {
  return (SEA_THINGS[id].haul?.(rng, level) ?? []).filter((s) => s.n > 0);
}
