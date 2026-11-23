// The alarm bell: a bell on a post, put up in the middle of an open place's enemy groups. Nobody rouses the rest of
// the place by starting a fight any more (zone.ts rouse); an enemy has to run to the bell and ring it, which takes
// BELL_AP of its Action Points, a whole turn's worth. The bell is a thing on the map (a poi), not a fighter: it takes
// no turns and is on nobody's side. Once rung it is `cleared`, and rings no more.

import { hexDistance, posKey, type HexPos } from "@gantt-quest/core";
import type { Poi } from "../map";
import { makeRng, seedFromString } from "../rng";
import type { Ctx } from "./engine";
import { freeHexNear } from "./gen";
import { tileAt } from "../map";
import { has } from "./engine";
import { solid, zoneReach, type Reached } from "./geometry";
import type { Budget, Unit, ZoneState } from "./types";

/** What ringing it costs the enemy that does: a whole turn's AP (AP_TURN). */
export const BELL_AP = 4;

/** The chance that a place with groups to rouse has a bell. */
export const BELL_CHANCE = 0.7;

/**
 * The chance, at the first turn an enemy could, that one of them sets out for the bell in a round of the fight: nobody
 * does in the first round, and it climbs steeply after (round 2, round 3, and from the round after, for certain).
 * One roll a round, for the whole enemy side, at the start of the round. Once one is picked, no other is; if it falls, another may be.
 */
export const BELL_RUSH = [0, 0.25, 0.6, 1];

/** Never closer than this to where the heroes arrive, so it is not rung on the first turn. */
const BELL_SAFE = 4;

/** Nor on or beside an enemy: the closest its hex may be to one. */
const BELL_APART = 2;

/** The bell on the map that has not been rung, if there is one. */
export const liveBell = (state: Pick<ZoneState, "map">): Poi | undefined => state.map.pois.find((p) => p.kind === "bell" && !p.cleared);

/** Whether ringing it would rouse anyone: a band that has noticed nobody, with one of its own standing. */
export const somethingToRouse = (state: ZoneState): boolean => state.units.some((u) => u.side === "enemy" && !u.down && u.group && !state.groups[u.group]?.alerted);

/**
 * Put a bell up, by chance, in a place out under the sky with two or more groups: as near the middle of where the
 * groups stand as there is open ground. Decided by the seed alone (its own dice, so the rest of the zone's are unmoved).
 */
export function placeBell(state: ZoneState): void {
  const groups = Object.keys(state.groups);
  if (groups.length < 2) return;
  const rng = makeRng(seedFromString(`bell|${state.seed}`));
  if (!rng.chance(BELL_CHANCE)) return;
  const posts = groups.map((g) => state.units.find((u) => u.group === g && !u.down)?.pos).filter((p): p is HexPos => !!p);
  if (posts.length < 2) return;
  const middle = { q: Math.round(posts.reduce((n, p) => n + p.q, 0) / posts.length), r: Math.round(posts.reduce((n, p) => n + p.r, 0) / posts.length) };
  const taken = new Set(state.units.map((u) => posKey(u.pos)));
  const spot = freeHexNear(state.map, middle, (p) => taken.has(posKey(p)) || hexDistance(p, state.start) < BELL_SAFE || state.units.some((u) => u.side === "enemy" && hexDistance(u.pos, p) < BELL_APART) || state.map.pois.some((o) => posKey(o.pos) === posKey(p)), (p) => tileAt(state.map, p));
  if (!spot || solid(tileAt(state.map, spot))) return;
  state.map.pois.push({ id: "bell", kind: "bell", pos: spot, hidden: false, cleared: false, usedBy: [], enemies: [] });
}

/**
 * An enemy rings the bell, if it stands beside it with the AP to (BELL_AP), there is a band left to rouse, and
 * it is on its feet. True if it did: the bell is spent, and its caller rouses the place (zone.ts rouse).
 */
export function ringBell(ctx: Ctx, enemy: Unit, budget: Budget): boolean {
  const bell = liveBell(ctx.state);
  if (!bell || enemy.down || budget.ap < BELL_AP || hexDistance(enemy.pos, bell.pos) > 1 || !somethingToRouse(ctx.state)) return false;
  budget.ap -= BELL_AP;
  bell.cleared = true;
  ctx.events.push({ t: "bell", poi: bell.id, id: enemy.id });
  return true;
}

/** Whether this enemy is the one that was picked to ring the bell (pickBellGoer). */
export const goesForBell = (state: ZoneState, enemy: Unit): boolean => !!liveBell(state) && state.encounter?.bell?.goer === enemy.id;

/** Whether an enemy has a way over the ground to the hex beside the bell: a valid one to send. */
function canReachBell(state: ZoneState, enemy: Unit, bell: Poi): boolean {
  const near = (r: Reached) => r.stop && hexDistance(r.pos, bell.pos) <= 1;
  return [...zoneReach(state, enemy, 400, undefined, undefined, near).values()].some(near);
}

/**
 * At the start of a round, from the second: if no enemy is going for the bell, the enemy side rolls (BELL_RUSH, once a
 * round), and on a success one is picked to go and told to everyone (`bell_goer`). Whoever it is, it must have a way
 * to the bell. The pick is the one nearest the bell, unless some are not beside a hero: then the nearest of those, so the
 * one sent is not the one holding the line. Nobody is picked if there is nobody to send.
 */
export function pickBellGoer(ctx: Ctx): void {
  const { state } = ctx;
  const enc = state.encounter;
  const bell = liveBell(state);
  if (!enc || !bell || !somethingToRouse(state)) return;
  const mark = (enc.bell ??= { goer: null, rolled: 0 });
  const going = mark.goer ? state.units.find((u) => u.id === mark.goer) : undefined;
  if (going && !going.down) return;
  mark.goer = null;
  if (enc.round < 2 || mark.rolled >= enc.round) return;
  mark.rolled = enc.round;
  if (!ctx.rng.chance(BELL_RUSH[Math.min(enc.round - 1, BELL_RUSH.length - 1)])) return;
  const heroes = state.units.filter((u) => u.side === "hero" && !u.down);
  const fighters = state.units.filter((u) => u.side === "enemy" && !u.down && enc.order.includes(u.id) && !has(u, "prone") && canReachBell(state, u, bell));
  const free = fighters.filter((u) => !heroes.some((h) => hexDistance(h.pos, u.pos) <= 1));
  const pool = free.length > 0 ? free : fighters;
  const pick = pool.sort((a, b) => hexDistance(a.pos, bell.pos) - hexDistance(b.pos, bell.pos) || (a.id < b.id ? -1 : 1))[0];
  if (!pick) return;
  mark.goer = pick.id;
  ctx.events.push({ t: "bell_goer", id: pick.id });
}
