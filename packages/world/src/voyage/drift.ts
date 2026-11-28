// The drift field: what slides past a ship under way, and where each piece
// of it is at any moment.
//
// The ship stands still on her map and the sea moves (see the plan in the
// voyage's own notes: zone kind "voyage"). Things come into sight ahead and
// drift astern down either side. Nothing here is stepped: where a thing is
// at time `t` is worked out from the sea's seed, the thing's number, the
// time, and the turns the helm has made, and from nothing else. So the
// client draws the field every frame and the server never simulates it:
// when a harpoon is loosed, the server works out where everything was at
// the moment it saw the shot, and judges the aim (`harpoon`).
//
// The arithmetic is plain on purpose (+, -, *, /, comparisons, and sqrt,
// which every engine rounds the same): no sin, cos, exp or pow, so a
// browser and the server agree to the last bit. The same rule as the
// fishing fight (fishfight.ts).
//
// The ship's frame, in hexes: `x` across her (starboard is +), `y` along
// her (ahead is +), 0,0 at the middle of her deck.

import { makeRng, seedFromString } from "../rng";
import { SEA_THINGS, rollSeaThing, type SeaThingId } from "./seathings";

/** How fast the sea runs astern, in hexes a second, at a thing's pace of 1. */
export const DRIFT_PACE = 0.9;
/** How far ahead of the ship's middle a thing comes into the field, and how far astern it leaves it. */
export const DRIFT_AHEAD = 16;
export const DRIFT_ASTERN = 12;
/** One thing comes into the field every so often (each a little early or late). */
export const DRIFT_GAP_MS = 2600;
/** How near the ship's side a thing may drift, and how far out. */
export const DRIFT_NEAR = 2.2;
export const DRIFT_FAR = 7.5;
/** How far a turn of the helm carries the ship sideways, in hexes, and how long she takes over it. */
export const LANE = 2;
export const LANE_MS = 1800;

/** A stretch of sea: what it is made from, and how long it runs (things stop coming once it is run). */
export interface Sea {
  seed: string;
  ms: number;
}

/** A turn of the helm: when, and which way (-1 to port, +1 to starboard). */
export interface Steer {
  at: number;
  dir: -1 | 1;
}

export interface Drifting {
  /** Its number in the sea: the same thing every time, and how the hold remembers what was taken. */
  n: number;
  kind: SeaThingId;
  x: number;
  y: number;
}

/** A thing as the sea first made it: what, when it comes into the field, and where across the ship's path. */
function born(sea: Sea, n: number): { kind: SeaThingId; at: number; x: number; pace: number } {
  const rng = makeRng(seedFromString(`${sea.seed}|drift|${n}`));
  const kind = rollSeaThing(rng);
  const side = rng.chance(0.5) ? -1 : 1;
  // Rocks lie nearer the ship's path than salvage does: they are there to be steered round.
  const out = kind === "rock" ? rng.next() * 2.6 : DRIFT_NEAR + rng.next() * (DRIFT_FAR - DRIFT_NEAR);
  return { kind, at: n * DRIFT_GAP_MS + rng.next() * DRIFT_GAP_MS * 0.6, x: side * out, pace: DRIFT_PACE * SEA_THINGS[kind].pace };
}

/** How far the helm has carried the ship to starboard by time `t`: each turn eased in over LANE_MS. */
export function leeway(steers: readonly Steer[], t: number): number {
  let x = 0;
  for (const s of steers) {
    if (t <= s.at) continue;
    const u = Math.min(1, (t - s.at) / LANE_MS);
    x += s.dir * LANE * u * u * (3 - 2 * u);
  }
  return x;
}

/** Where thing `n` is at time `t`, or null if it has not come into the field yet, has left it, or the sea had run before it came. */
export function driftAt(sea: Sea, n: number, t: number, steers: readonly Steer[]): Drifting | null {
  if (n < 0) return null;
  const b = born(sea, n);
  if (b.at > sea.ms || t < b.at) return null;
  const y = DRIFT_AHEAD - (b.pace * (t - b.at)) / 1000;
  if (y < -DRIFT_ASTERN) return null;
  // The ship going to starboard is the sea going to port.
  return { n, kind: b.kind, x: b.x - leeway(steers, t), y };
}

/** Everything in the field at time `t`, the furthest ahead first. `taken` are the numbers of things already hauled aboard. */
export function driftField(sea: Sea, t: number, steers: readonly Steer[], taken: ReadonlySet<number> = new Set()): Drifting[] {
  // The slowest thing takes this long to cross the field: nothing older than that is still in it.
  const slowest = Math.min(...Object.values(SEA_THINGS).map((d) => d.pace)) * DRIFT_PACE;
  const life = ((DRIFT_AHEAD + DRIFT_ASTERN) / slowest) * 1000;
  const first = Math.max(0, Math.floor((t - life) / DRIFT_GAP_MS) - 1);
  const last = Math.floor(t / DRIFT_GAP_MS);
  const out: Drifting[] = [];
  for (let n = first; n <= last; n++) {
    if (taken.has(n)) continue;
    const at = driftAt(sea, n, t, steers);
    if (at) out.push(at);
  }
  return out.sort((a, b) => b.y - a.y || a.n - b.n);
}

/**
 * A harpoon loosed at time `t` from `gun` along `aim` (any length: only its direction counts), reaching `reach`
 * hexes: the first thing it meets, or null if it meets none. A thing is met if the shot passes within the
 * thing's own size of its middle (plus `slack`, for the moment between the player's eye and the server's clock).
 */
export function harpoon(sea: Sea, t: number, steers: readonly Steer[], taken: ReadonlySet<number>, gun: { x: number; y: number }, aim: { x: number; y: number }, reach: number, slack = 0): Drifting | null {
  const len = Math.sqrt(aim.x * aim.x + aim.y * aim.y);
  if (!(len > 0)) return null;
  const [ux, uy] = [aim.x / len, aim.y / len];
  let best: Drifting | null = null;
  let bestAlong = Infinity;
  for (const thing of driftField(sea, t, steers, taken)) {
    const [dx, dy] = [thing.x - gun.x, thing.y - gun.y];
    const along = dx * ux + dy * uy;
    if (along <= 0 || along > reach) continue;
    const off = Math.abs(dx * uy - dy * ux);
    if (off <= SEA_THINGS[thing.kind].size + slack && along < bestAlong) [best, bestAlong] = [thing, along];
  }
  return best;
}

/**
 * The things that struck the hull between `from` and `to`: those whose middle came inside the ship's sides
 * (`half` hexes either way across, `fore` ahead of her middle and `aft` behind it) at some moment of it. Looked
 * for a tenth of a second at a time. Each strikes once: `struck` are the numbers of those that already have.
 */
export function strikes(sea: Sea, from: number, to: number, steers: readonly Steer[], hull: { half: number; fore: number; aft: number }, struck: ReadonlySet<number> = new Set()): Drifting[] {
  const out = new Map<number, Drifting>();
  for (let t = from; t <= to; t += 100) {
    for (const thing of driftField(sea, t, steers, struck)) {
      if (out.has(thing.n)) continue;
      const reach = SEA_THINGS[thing.kind].size * 0.5;
      if (Math.abs(thing.x) <= hull.half + reach && thing.y <= hull.fore + reach && thing.y >= -hull.aft - reach) out.set(thing.n, thing);
    }
  }
  return [...out.values()].sort((a, b) => a.n - b.n);
}
