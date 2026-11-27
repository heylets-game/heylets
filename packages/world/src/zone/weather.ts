// Weather: an area a spell leaves over some hexes for a few rounds of a
// fight, acting on whoever is in it. Soothing Rain heals the caster's side
// and keeps its hexes under water; Trade Winds speed the caster's side and
// slow the other; a Coral Field cuts and slows the other side, and lets the
// caster's walk through untouched; a wall (Fortify) stands on its hexes, and
// nobody passes it (geometry.ts blockerAt). What is laid on the ground (surfaces.ts) is the ground's
// business; weather hangs over it, and puts water down where it rains.
//
// It acts on a unit as the weather is made, as the unit's turn starts in it,
// and as the unit steps (or is pushed) into it on its own turn. Rain heals a
// unit, and coral cuts one, at most once a turn, however often it goes in and out.
//
// A quake (a Guardian's Earthquake) is ground left cracked and shaking: it does nothing to whoever walks on it,
// but as its maker's next turn begins it heaves once, hard, under everyone on it, and is gone (quakeAtTurn).

import { hexDistance, hexNeighbors, posKey, type HexPos } from "@gantt-quest/core";
import { addCondition, damage, heal, inPlay, inflict, saveRoll, type Ctx } from "./engine";
import { HEX_DIRS, blockerAt, covers, directionToward, flies, inFight, leanWithin, nearestHexes, solid, unitAt, type Lean } from "./geometry";
import { FORTIFY, WEATHER } from "./kit";
import { tileAt } from "../map";
import { rollDice, rollShown, type Dice } from "./rules";
import { placeSurface } from "./surfaces";
import type { Unit, Weather, WeatherKind, ZoneState } from "./types";
import type { Inflict } from "../content";

/** Each weather as the player sees it. */
export const WEATHER_INFO: Record<WeatherKind, { name: string; blurb: string; color: string }> = {
  rain: { name: "Soothing Rain", blurb: "Lays water, and heals the caster's side as each starts a turn in it or first walks in on a turn.", color: "#8fd3ff" },
  wind: { name: "Trade Winds", blurb: "The caster's side is Hasted in it, the other side Slowed.", color: "#d9f2e6" },
  coral: { name: "Coral Field", blurb: "Harmless to the caster's side. The other side is cut and Slowed, once a turn, as each starts a turn in it or walks into it.", color: "#ff7f6e" },
  wall: { name: "Fortification", blurb: `Nobody gets through it. The side that raised it sees over it, and has +${FORTIFY.defence} Defence beside it; the other side cannot see through it.`, color: "#c9b48a" },
  quake: { name: "Cracked Ground", blurb: "Shaking still. It heaves hard when the one who cracked it starts their next turn: get off it before then, or save on Agility for half and to keep your feet.", color: "#d9a066" },
};

/**
 * The hexes a wall (Fortify) raised on `at` stands on: that hex and the two beside it that are as far from `from` (the
 * user's hex) as it is, so it stands broadside on to them. A hex nobody could stand on (rock, a chest, somebody already there) is left out.
 */
export function wallHexes(state: Pick<ZoneState, "map" | "units" | "weather">, from: HexPos, at: HexPos): HexPos[] {
  const i = HEX_DIRS.indexOf(directionToward(from, at));
  const wings = [HEX_DIRS[(i + 2) % 6], HEX_DIRS[(i + 4) % 6]].slice(0, FORTIFY.hexes - 1).map((d) => ({ q: at.q + d.q, r: at.r + d.r }));
  return [at, ...wings].filter((p) => !!tileAt(state.map, p) && !solid(tileAt(state.map, p)) && !blockerAt(state, p) && !unitAt(state as ZoneState, p));
}

/**
 * `n` hexes in a clump about the one aimed at. Aimed at a spot in it (`lean`, as a hero aims with the pointer): the `n`
 * whose middles lie nearest that spot (nearestHexes), so three are always a triangle and four a diamond, turned to
 * where the pointer is. Aimed at the hex alone (an enemy): the one aimed at, the one beside it nearest `from`, and then,
 * nearest `from` first, those beside the one aimed at that touch one already taken. Fewer at the edge of the map.
 */
export function clusterHexes(state: Pick<ZoneState, "map">, from: HexPos, at: HexPos, n: number, lean?: Lean): HexPos[] {
  // Right on the middle, every way is as near as every other: then it is turned toward `from`, as an enemy's is.
  const spot = lean && leanWithin(at, lean);
  if (spot && Math.hypot(spot.q, spot.r) > 0.02) return nearestHexes(state.map, at, spot, n);
  const near = hexNeighbors(at, state.map.grid).sort((a, b) => hexDistance(a, from) - hexDistance(b, from) || a.q - b.q || a.r - b.r);
  const out = [at];
  const taken: HexPos[] = [];
  while (out.length < n) {
    const next = near.find((p) => !taken.includes(p) && (taken.length === 0 || taken.some((t) => hexDistance(t, p) === 1)));
    if (!next) break;
    taken.push(next);
    out.push(next);
  }
  return out;
}

/** The three hexes a rain cloud covers: the one aimed at and the two beside it nearest the caster. */
export const rainHexes = (state: Pick<ZoneState, "map">, from: HexPos, at: HexPos, lean?: Lean): HexPos[] => clusterHexes(state, from, at, 3, lean);

/** Whether a unit is under a weather: on any of its hexes, for a big one. */
const inside = (w: Weather, unit: Unit) => w.hexes.some((p) => covers(unit, p));

/** Whether it is this unit's own turn just now. */
function ownTurn(state: ZoneState, unit: Unit): boolean {
  const enc = state.encounter;
  return !!enc && enc.acting.includes(unit.id) && !enc.done.includes(unit.id);
}

/** Put water down under the rain wherever there is none. */
function wetGround(ctx: Ctx, w: Weather): void {
  const dry = w.hexes.filter((p) => ctx.state.surfaces[posKey(p)]?.kind !== "water");
  if (dry.length > 0) placeSurface(ctx, dry, "water", WEATHER.rain.water, w.by);
}

/** What a weather does to one unit in it. `turn`: the turn it counts against, for rain's once-a-turn heal and coral's once-a-turn cut. */
function weatherOn(ctx: Ctx, w: Weather, unit: Unit, turn: number): void {
  // A wall acts on nobody: nobody is ever in it. Cracked ground only acts as it heaves (quakeAtTurn).
  // Out of a fight it does nobody any harm, or good (inPlay).
  if (unit.down || w.kind === "wall" || w.kind === "quake" || !inPlay(ctx, unit)) return;
  const friend = unit.side === w.side;
  if (w.kind === "rain") {
    if (!friend || w.touched[unit.id] === turn) return;
    w.touched[unit.id] = turn;
    if (unit.hp < unit.maxHp) heal(ctx, unit, rollDice(ctx.rng, WEATHER.rain.heal), { actor: w.by, what: "soothing_rain" });
    return;
  }
  if (w.kind === "coral") {
    // It grows on the ground: what flies is over it.
    if (friend || flies(unit) || w.touched[unit.id] === turn) return;
    w.touched[unit.id] = turn;
    damage(ctx, unit, rollDice(ctx.rng, WEATHER.coral.damage), { actor: w.by, what: "coral_field" });
    addCondition(ctx, unit, "slowed", 1);
    return;
  }
  // The winds last as long as the turn they are felt in: out of them, a unit is back to its own pace.
  const kind = friend ? "hasted" : "slowed";
  const had = unit.conditions.some((c) => c.kind === kind);
  addCondition(ctx, unit, kind, 1);
  const c = unit.conditions.find((x) => x.kind === kind);
  if (!had && c) delete c.fresh;
}

/** The turn a unit's rain heal counts against: its turn in a fight, or once for good out of one. */
const turnOf = (state: ZoneState, unit: Unit) => (state.encounter && inFight(state, unit.id) ? state.encounter.turnNo : -1);

/** Make a weather over some hexes, and have it act on everyone already under it. */
export function makeWeather(ctx: Ctx, kind: WeatherKind, hexes: HexPos[], by: Unit): void {
  const state = ctx.state;
  const w: Weather = { kind, hexes, rounds: WEATHER[kind].rounds, fresh: true, by: by.id, side: by.side, touched: {} };
  state.weather = [...(state.weather ?? []), w];
  ctx.events.push({ t: "weather", kind, hexes, by: by.id });
  if (kind === "rain") wetGround(ctx, w);
  for (const unit of state.units) if (inside(w, unit)) weatherOn(ctx, w, unit, turnOf(state, unit));
}

/** A unit's turn starts: the rain comes down again, and whatever weather it stands in acts on it. */
export function weatherAtTurn(ctx: Ctx, unit: Unit): void {
  for (const w of ctx.state.weather ?? []) {
    if (w.kind === "rain") wetGround(ctx, w);
    if (inside(w, unit)) weatherOn(ctx, w, unit, turnOf(ctx.state, unit));
  }
}

/**
 * A unit has come onto a hex: weather there acts on it, if it is the unit's own turn (or no fight is on). `flush`
 * (a walk's, as enterSurface takes it): says the steps walked so far, so what the weather does is told after the unit
 * is seen to come in, not before it sets off. Called only if some weather acted, so a walk through none stays one.
 */
export function enterWeather(ctx: Ctx, unit: Unit, flush?: () => void): void {
  if (unit.down) return;
  const fighting = !!ctx.state.encounter && inFight(ctx.state, unit.id);
  if (fighting && !ownTurn(ctx.state, unit)) return;
  const mark = ctx.events.length;
  for (const w of ctx.state.weather ?? []) {
    if (!inside(w, unit)) continue;
    // The winds do nothing out of a fight: there is no pace to change. Nor does coral: it is for a fight.
    if ((w.kind === "wind" || w.kind === "coral") && !fighting) continue;
    weatherOn(ctx, w, unit, turnOf(ctx.state, unit));
  }
  if (flush && ctx.events.length > mark) {
    const said = ctx.events.splice(mark);
    flush();
    ctx.events.push(...said);
  }
}

/**
 * The hexes an Earthquake shakes: every one within `radius` of any of `from` (the hexes its maker stands on) that
 * there is ground on (not rock, not off the map), each once.
 */
export function quakeHexes(state: Pick<ZoneState, "map">, from: readonly HexPos[], radius: number): HexPos[] {
  const out = new Map<string, HexPos>();
  for (const at of from) {
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const p = { q: at.q + dq, r: at.r + dr };
        const tile = tileAt(state.map, p);
        if (tile && !solid(tile)) out.set(posKey(p), p);
      }
    }
  }
  return [...out.values()];
}

/**
 * The ground shakes under every one of `by`'s foes on `hexes` who is in the fight and not flying: `dice` of damage,
 * or half on an Agility save against `dc`, and `saveOr` on a failure.
 */
function shake(ctx: Ctx, by: Unit, hexes: HexPos[], name: string, dice: Dice, dc: number, saveOr?: Inflict): void {
  const state = ctx.state;
  const rolled = rollShown(ctx.rng, dice);
  for (const victim of state.units.filter((u) => u.side !== by.side && !u.down && !flies(u) && inFight(state, u.id) && hexes.some((p) => covers(u, p)))) {
    const saved = saveRoll(ctx, victim, "agi", dc, name).ok;
    damage(ctx, victim, saved ? Math.floor(rolled.total / 2) : rolled.total, { actor: by.id, what: name, dice: rolled, halved: saved });
    if (!saved && saveOr && !victim.down) inflict(ctx, victim, saveOr);
  }
}

/**
 * An Earthquake, begun: the ground round `by` shakes now (`first` damage), and is left cracked over `hexes` until
 * `by`'s next turn, when it heaves (`shock`).
 */
export function makeQuake(ctx: Ctx, by: Unit, hexes: HexPos[], name: string, first: Dice, dc: number, shock: { dice: Dice; saveOr?: Inflict }): void {
  const state = ctx.state;
  // One quake at a time from each maker: a new one takes the place of the old.
  state.weather = [...(state.weather ?? []).filter((w) => !(w.kind === "quake" && w.by === by.id)), { kind: "quake", hexes, rounds: WEATHER.quake.rounds, fresh: true, by: by.id, side: by.side, touched: {}, shock: { name, dice: shock.dice, dc, saveOr: shock.saveOr, from: { ...by.pos } } }];
  ctx.events.push({ t: "weather", kind: "quake", hexes, by: by.id });
  shake(ctx, by, hexes, name, first, dc);
}

/**
 * `unit`'s turn begins: the ground it cracked on its last turn heaves under everyone still on it, and settles (told
 * as the ability used `again`; the weather's going is not told: the picture follows the state).
 */
export function quakeAtTurn(ctx: Ctx, unit: Unit): void {
  const mine = (ctx.state.weather ?? []).filter((w) => w.kind === "quake" && w.by === unit.id);
  if (mine.length === 0) return;
  ctx.state.weather = ctx.state.weather!.filter((w) => !mine.includes(w));
  for (const w of mine) {
    if (w.shock) {
      ctx.events.push({ t: "used", id: unit.id, what: "attack", name: w.shock.name, again: true, at: w.shock.from });
      shake(ctx, unit, w.hexes, w.shock.name, w.shock.dice, w.shock.dc, w.shock.saveOr);
    }
  }
}

/** A round has passed: every weather has one less to go (bar one made this round), and the spent ones clear. */
export function tickWeather(ctx: Ctx): void {
  const list = ctx.state.weather;
  if (!list || list.length === 0) return;
  for (const w of list) {
    if (w.fresh) delete w.fresh;
    else w.rounds -= 1;
  }
  // Cracked ground whose maker has fallen settles: it will not heave now.
  const over = (w: Weather) => w.rounds <= 0 || (w.kind === "quake" && !!ctx.state.units.find((u) => u.id === w.by)?.down);
  const gone = list.filter(over);
  ctx.state.weather = list.filter((w) => !over(w));
  // Cracked ground settles quietly: the weather clearing is not news of it.
  for (const w of gone) if (w.kind !== "quake") ctx.events.push({ t: "weather", kind: null, hexes: w.hexes, by: w.by });
}
