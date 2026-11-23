// Where the pub's regulars are, out and about. The day's three (regularsOn) leave the pub soon after dawn on the
// Harbor's clock (gameclock.ts), stroll between the places they like round the town, stopping a while at each, and
// are back through the pub's door just after dusk; through the night they drift about inside it, between the bar,
// the hearth and the tables, sitting a while on a stool now and then.
//
// Nothing of it is stored or sent: where each of them is follows from the crew, the clock and the maps alone, so
// every browser in a crew sees the same regular in the same place, walking the same way. A day's routes are worked
// out once and kept.

import { hexNeighbors, type HexPos } from "@gantt-quest/core";
import { DAWN, DUSK, GAME_DAY_MS } from "./gameclock";
import { gatherDay } from "./gather";
import { HARBOR_BOARD, HARBOR_BRIDGE, HARBOR_GATHER, HARBOR_LIGHTHOUSE, HARBOR_PIERS, HARBOR_PUB, HARBOR_RING, HARBOR_SHOP, HARBOR_SPAWN, HARBOR_WELL, HARBOR_WORKS, generateHarbor, harborPath } from "./harbor";
import { tileAt, type WorldMap } from "./map";
import { PUB_COUNTER, PUB_DEALER_STAND, PUB_GRID, PUB_LEADERBOARD, PUB_TRADER, pubPath, pubRoom } from "./pub";
import { regularsOn, type RegularId } from "./regulars";
import { makeRng, seedFromString, type Rng } from "./rng";

/** How long a regular takes over a hex, walking: an easy stroll, slower than a hero (the renderer walks them at this pace). */
export const WANDER_STEP_MS = 750;

/** Where a regular is at a moment. */
export interface RegularAbout {
  id: RegularId;
  /** Out in the Harbor, or inside the pub. */
  place: "harbor" | "pub";
  /** The hex they stand on, or (walking) the one they are stepping onto. */
  pos: HexPos;
  walking: boolean;
}

/** A walk from one hex along a path (not counting where it starts), begun at `at`; standing at its end until the next. */
interface Leg {
  at: number;
  from: HexPos;
  path: HexPos[];
}

/** Each regular's haunts round the town, by what they do, besides the well and the notice board everyone stops at. */
const HAUNTS: Record<RegularId, HexPos[]> = {
  // The net-mender: on the piers with the boats, and at the fish shack.
  gretta: [HARBOR_PIERS[0], HARBOR_PIERS[1], HARBOR_GATHER.fishing, HARBOR_SHOP],
  // The old bosun: the pier heads and the lighthouse, watching the water.
  pike: [HARBOR_PIERS[1], HARBOR_PIERS[2], HARBOR_LIGHTHOUSE, HARBOR_SPAWN],
  // The carpenter: the builders' yard and the tree line, and the bridge he keeps patching.
  wen: [HARBOR_WORKS, HARBOR_GATHER.felling, HARBOR_BRIDGE[0], HARBOR_SPAWN],
  // The old lighthouse keeper: his light, still, and a sit by the well.
  moss: [HARBOR_LIGHTHOUSE, HARBOR_PIERS[2], HARBOR_SHOP],
  // The smuggler, allegedly: the quiet end of a pier, the stall, the strand by the ring, the bridge out.
  dacey: [HARBOR_PIERS[0], HARBOR_SHOP, HARBOR_RING, HARBOR_BRIDGE[2]],
};
const EVERYONE: HexPos[] = [HARBOR_WELL, HARBOR_BOARD];

/** A stop's length, in seconds: a while, but not so long the town stands still. */
const DWELL_S: [number, number] = [16, 38];
/** How long after dawn each sets out, and after dusk is back, at most, in seconds: so they come and go one by one. */
const STAGGER_S = 24;

const key = (p: HexPos) => `${p.q},${p.r}`;
const same = (a: HexPos, b: HexPos) => a.q === b.q && a.r === b.r;
const between = (rng: Rng, [lo, hi]: [number, number]) => lo + rng.next() * (hi - lo);

// ---------- the maps, made once ----------

let harbor: WorldMap | null = null;
let pub: { room: WorldMap; door: HexPos; spots: HexPos[] } | null = null;
const harborMap = () => (harbor ??= generateHarbor());

/** The pub's room, its door, and the hexes a regular may drift to: open floor away from where customers are served, and the stools. */
function pubPlaces() {
  if (pub) return pub;
  const room = pubRoom();
  const door = room.pois.find((p) => p.kind === "door")!.pos;
  const busy = [door, PUB_COUNTER, PUB_TRADER, PUB_DEALER_STAND, PUB_LEADERBOARD.stand, ...room.pois.map((p) => p.pos)];
  const spots: HexPos[] = [];
  for (let r = 0; r < PUB_GRID.rows; r++) {
    for (let col = 0; col < PUB_GRID.cols; col++) {
      const p = { q: col - Math.floor(r / 2), r };
      if (busy.some((b) => same(b, p)) || !tileAt(room, p)) continue;
      if (pubPath(room, door, p)) spots.push(p);
    }
  }
  pub = { room, door, spots };
  return pub;
}

/**
 * Where to stand at a haunt: a hex of open ground near it, not on it (the haunt is a door, a pier head or a spot
 * players stand at), picked by `rng`; null if none can be walked to from `from`.
 */
function standNear(map: WorldMap, from: HexPos, haunt: HexPos, rng: Rng): HexPos | null {
  const around = [...hexNeighbors(haunt, map.grid), ...hexNeighbors(haunt, map.grid).flatMap((n) => hexNeighbors(n, map.grid))];
  const seen = new Set<string>([key(haunt)]);
  const open = around.filter((p) => {
    if (seen.has(key(p))) return false;
    seen.add(key(p));
    const t = tileAt(map, p);
    return !!t && t.biome !== "water" && t.biome !== "rampart" && !t.built && !t.blocker && !map.pois.some((poi) => same(poi.pos, p));
  });
  for (let tries = 0; tries < 4 && open.length > 0; tries++) {
    const pick = open.splice(Math.floor(rng.next() * open.length), 1)[0];
    if (harborPath(map, from, pick)) return pick;
  }
  return null;
}

/**
 * A round of stops from `home`, begun at `from` and back at `home` by `to`: each stop picked by `next`, walked to
 * by `path`, and stood at for a while. Stops are added while there is time for the walk there, the stay and the
 * walk home; the last walk home is timed to arrive at `to`.
 */
function round(home: HexPos, from: number, to: number, rng: Rng, next: (at: HexPos) => HexPos | null, path: (a: HexPos, b: HexPos) => HexPos[] | null): Leg[] {
  const legs: Leg[] = [];
  let at = home;
  // A moment on the doorstep before setting off, so they are seen to come out of it.
  let t = from + WANDER_STEP_MS;
  for (let misses = 0; misses < 6; ) {
    const stop = next(at);
    const there = stop && !same(stop, at) ? path(at, stop) : null;
    const back = stop && there ? (same(stop, home) ? [] : path(stop, home)) : null;
    if (!stop || !there || !back) {
      misses++;
      continue;
    }
    const stay = between(rng, DWELL_S) * 1000;
    if (t + (there.length + back.length) * WANDER_STEP_MS + stay > to) break;
    legs.push({ at: t, from: at, path: there });
    t += there.length * WANDER_STEP_MS + stay;
    at = stop;
  }
  const back = same(at, home) ? [] : path(at, home);
  if (back && back.length > 0) legs.push({ at: Math.max(t, to - back.length * WANDER_STEP_MS), from: at, path: back });
  return legs;
}

// ---------- the day's rounds ----------

/** When the day `cycle` starts: its dawn. A cycle runs from one dawn to the next. */
const cycleStart = (cycle: number) => (cycle + DAWN) * GAME_DAY_MS;
const cycleOf = (now: number) => Math.floor(now / GAME_DAY_MS - DAWN);
/** How long a day lasts, dawn to dusk. */
const DAY_LEN = (DUSK - DAWN) * GAME_DAY_MS;

/** When a regular sets out on a day, and is back: a little after dawn, a little after dusk, each their own amount. */
function hours(crewId: string, id: RegularId, cycle: number): { out: number; back: number } {
  const rng = makeRng(seedFromString(`hours|${crewId}|${id}|${cycle}`));
  const start = cycleStart(cycle);
  return { out: start + (4 + rng.next() * STAGGER_S) * 1000, back: start + DAY_LEN + (3 + rng.next() * STAGGER_S) * 1000 };
}

const kept = new Map<string, Leg[]>();
function keep(k: string, make: () => Leg[]): Leg[] {
  const had = kept.get(k);
  if (had) return had;
  if (kept.size > 120) kept.clear();
  const legs = make();
  kept.set(k, legs);
  return legs;
}

/** A regular's day out in the Harbor: from the pub's door and back to it. */
function dayOut(crewId: string, id: RegularId, cycle: number): Leg[] {
  return keep(`out|${crewId}|${id}|${cycle}`, () => {
    const map = harborMap();
    const rng = makeRng(seedFromString(`out|${crewId}|${id}|${cycle}`));
    const haunts = [...HAUNTS[id], ...EVERYONE];
    const { out, back } = hours(crewId, id, cycle);
    let last: HexPos | null = null;
    return round(HARBOR_PUB, out, back, rng, (at) => {
      // Never the same haunt twice running.
      const choices = haunts.filter((h) => !last || !same(h, last));
      const haunt = choices[Math.floor(rng.next() * choices.length)];
      last = haunt;
      return standNear(map, at, haunt, rng);
    }, (a, b) => harborPath(map, a, b));
  });
}

/** A regular's night in the pub: from its door (back from the day) to its door (setting out the next morning). */
function nightIn(crewId: string, id: RegularId, cycle: number): Leg[] {
  return keep(`in|${crewId}|${id}|${cycle}`, () => {
    const { room, door, spots } = pubPlaces();
    const rng = makeRng(seedFromString(`in|${crewId}|${id}|${cycle}`));
    const { back } = hours(crewId, id, cycle);
    const { out } = hours(crewId, id, cycle + 1);
    return round(door, back, out, rng, () => spots[Math.floor(rng.next() * spots.length)], (a, b) => pubPath(room, a, b));
  });
}

/** Where a round of legs has got to at `now`, from `home`. */
function along(legs: Leg[], home: HexPos, now: number): { pos: HexPos; walking: boolean } {
  let leg: Leg | undefined;
  for (const l of legs) {
    if (l.at > now) break;
    leg = l;
  }
  if (!leg) return { pos: home, walking: false };
  const step = Math.floor((now - leg.at) / WANDER_STEP_MS);
  if (step >= leg.path.length) return { pos: leg.path[leg.path.length - 1] ?? leg.from, walking: false };
  return { pos: leg.path[step], walking: true };
}

/** Where one regular is at `now`, on whichever day `now` falls. */
export function regularAbout(crewId: string, id: RegularId, now: number): RegularAbout {
  const cycle = cycleOf(now);
  const today = hours(crewId, id, cycle);
  if (now >= today.out && now < today.back) return { id, place: "harbor", ...along(dayOut(crewId, id, cycle), HARBOR_PUB, now) };
  // Before setting out, they are still in from the night before; after coming back, in for this night.
  const night = now < today.out ? cycle - 1 : cycle;
  return { id, place: "pub", ...along(nightIn(crewId, id, night), pubPlaces().door, now) };
}

/** Where the day's regulars (the three in for the crew today, as on the server) are at `now`. */
export function regularsAbout(crewId: string, now: number): RegularAbout[] {
  return regularsOn(crewId, gatherDay(now)).map((r) => regularAbout(crewId, r.id, now));
}
