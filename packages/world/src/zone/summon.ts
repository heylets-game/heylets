// Creatures called into a fight: by a hero (Summon Sea Turtle, Summon Sunken
// Sailors), or by an enemy calling more of its own kind (a Broodmother's Brood
// Swarm, callKin). Each goes on its caller's initiative: it stands right after
// them in the order, and takes its own turn as soon as theirs is over. A hero's
// is on their side, played by their player. It is gone when it falls, when the
// fight is over, and (a hero's) when its caller calls again (everything they
// called before goes); it never walks the map out of a fight, and an enemy's
// is worth nothing when it falls: no XP, nothing to search.

import { hexDistance, hexNeighbors, posKey, type HexPos } from "@gantt-quest/core";
import { ENEMIES } from "../content";
import { tileAt } from "../map";
import type { Ctx } from "./engine";
import { HEX_ROOM, blockerAt, isDead, sameHex, solid, span, unitAt, unitsAt } from "./geometry";
import { SUMMON_AP_TURN, SUMMONS, SUMMON_CALLS, enemyHp, type SummonCall } from "./kit";
import type { KinCall } from "./enemyabilities";
import { modsOf } from "./mods";
import { HARMFUL, enterSurface } from "./surfaces";
import type { Unit, ZoneState } from "./types";
import { enterWeather } from "./weather";

/** An enemy's HP at full health, for its kind at this level on this map. */
export const enemyMaxHp = (state: ZoneState, kind: string, level: number): number => Math.round(enemyHp(kind, level) * modsOf(state.options).hp);

/** An enemy of this kind standing at `pos` in `group`, at the map's level or at `level`. */
export function enemyUnit(state: ZoneState, kind: string, pos: HexPos, group: string, level = state.options.level): Unit {
  const hp = enemyMaxHp(state, kind, level);
  return {
    id: `e${++state.seq}`,
    side: "enemy",
    name: ENEMIES[kind].name,
    kind,
    level,
    pos,
    hp,
    maxHp: hp,
    armor: 0,
    power: 0,
    // Its own copy of what its kind starts with: one enemy can be given more, or fewer, than the rest.
    abilities: [...(ENEMIES[kind].abilities ?? [])],
    conditions: [],
    down: false,
    cooldowns: {},
    items: {},
    group,
    home: pos,
  };
}

/** The creatures `by` has called that are still about. */
export const summonsOf = (state: ZoneState, by: string): Unit[] => state.units.filter((u) => u.summon?.by === by);

/** Take a called creature off the map, and out of the fight's order and turn. */
export function dismiss(ctx: Ctx, unit: Unit): void {
  const { state } = ctx;
  state.units = state.units.filter((u) => u.id !== unit.id);
  const enc = state.encounter;
  if (enc) {
    enc.order = enc.order.filter((id) => id !== unit.id);
    enc.acting = enc.acting.filter((id) => id !== unit.id);
    enc.done = enc.done.filter((id) => id !== unit.id);
    enc.reacted = enc.reacted.filter((id) => id !== unit.id);
    delete enc.budgets[unit.id];
    delete enc.init[unit.id];
  }
  ctx.events.push({ t: "dismissed", id: unit.id });
}

/**
 * Where each creature of a call would stand, aimed at `at` by `caller`: the first on `at`, each one after on the open hex
 * beside it nearest the caller. What the caller called before is about to go, so the hexes it holds count as open.
 * Null if any of them has nowhere to stand.
 */
export function summonSpots(state: ZoneState, caller: Unit, call: SummonCall, at: HexPos): HexPos[] | null {
  const leaving = new Set(summonsOf(state, caller.id).map((u) => u.id));
  const open = (p: HexPos) => {
    const tile = tileAt(state.map, p);
    const there = unitAt(state, p);
    return !!tile && !solid(tile) && !blockerAt(state, p) && (!there || leaving.has(there.id));
  };
  const spots: HexPos[] = [];
  for (let i = 0; i < SUMMON_CALLS[call].length; i++) {
    const spot =
      i === 0
        ? open(at) ? at : undefined
        : hexNeighbors(at, state.map.grid)
            .filter((p) => open(p) && !spots.some((s) => sameHex(s, p)))
            .sort((a, b) => hexDistance(a, caller.pos) - hexDistance(b, caller.pos) || a.q - b.q || a.r - b.r)[0];
    if (!spot) return null;
    spots.push(spot);
  }
  return spots;
}

/**
 * The creatures of a call, for `caller`, aimed at `at` (checked already: summonSpots has room for them all). Whatever the caller
 * called before is sent away first. They go into the order just after the caller, on their initiative, in the order called,
 * and if the caller's turn is underway each has one too, starting now.
 */
export function summonCall(ctx: Ctx, caller: Unit, call: SummonCall, at: HexPos): Unit[] {
  const { state } = ctx;
  const spots = summonSpots(state, caller, call, at) ?? [];
  for (const old of summonsOf(state, caller.id)) dismiss(ctx, old);
  const called: Unit[] = [];
  SUMMON_CALLS[call].forEach((kind, i) => {
    const pos = spots[i];
    if (!pos) return;
    const def = SUMMONS[kind];
    const hp = def.hp(caller.level);
    const unit: Unit = {
      id: `t${++state.seq}`,
      side: caller.side,
      name: def.name,
      kind,
      level: caller.level,
      pos: { q: pos.q, r: pos.r },
      hp,
      maxHp: hp,
      stats: { ...def.stats },
      armor: def.armor,
      power: 0,
      abilities: [...def.abilities],
      conditions: [],
      down: false,
      cooldowns: {},
      items: {},
      controller: caller.controller ?? caller.id,
      summon: { by: caller.id },
    };
    state.units.push(unit);
    ctx.events.push({ t: "summoned", id: unit.id, by: caller.id, at: { ...unit.pos } });
    joinBehind(ctx, caller, unit, called.length, def.move);
    called.push(unit);
  });
  arrive(ctx, called);
  return called;
}

/**
 * A creature just called goes into the fight's order just behind its caller, on their initiative, after the `before`
 * called with it; if the caller's turn is underway (and turns are shared, as in the tests), it has one too, starting now.
 */
function joinBehind(ctx: Ctx, caller: Unit, unit: Unit, before: number, stride: number): void {
  const enc = ctx.state.encounter;
  if (!enc || !enc.order.includes(caller.id)) return;
  enc.order.splice(enc.order.indexOf(caller.id) + 1 + before, 0, unit.id);
  enc.init[unit.id] = enc.init[caller.id];
  if (enc.tie?.[caller.id] !== undefined) enc.tie[unit.id] = enc.tie[caller.id] - 0.01 * (1 + before);
  // (The tests' switch for shared turns: called in the middle of its caller's turn, it shares what is left of it.)
  if (ctx.state.shareTurns && enc.acting.includes(caller.id)) {
    enc.acting.push(unit.id);
    enc.budgets[unit.id] = { ap: SUMMON_AP_TURN, move: 0, stride, disengaged: false };
  }
}

/** Those just called meet the ground and the weather where they stand. */
function arrive(ctx: Ctx, called: Unit[]): void {
  for (const unit of called) if (!enterSurface(ctx, unit) && !unit.down) enterWeather(ctx, unit);
}

/**
 * Where an enemy calling more of its side (EnemyDef ability `summon`) would put them: hexes beside it (any of its
 * hexes, for a big one) with nobody on them, or as many of the kind called as the call `share`s (and room for one more),
 * one to a hex: empty ones first, then ground that does no harm, then nearest its anchor. As many as there are, up to
 * the call's `count`, and only as many more as keep those it called standing to its `most`.
 */
export function kinSpots(state: ZoneState, caller: Unit, call: KinCall, from: HexPos = caller.pos): HexPos[] {
  const out = summonsOf(state, caller.id).filter((u) => !u.down && u.kind === call.kind).length;
  const count = Math.min(call.count, call.most === undefined ? Infinity : Math.max(0, call.most - out));
  if (count <= 0) return [];
  const mine = span(caller, from);
  const seen = new Set(mine.map(posKey));
  const open: HexPos[] = [];
  /** How many stand on each hex looked at already. */
  const crowd = new Map<string, number>();
  for (const p of mine.flatMap((h) => hexNeighbors(h, state.map.grid))) {
    const key = posKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    const tile = tileAt(state.map, p);
    if (!tile || solid(tile) || blockerAt(state, p)) continue;
    const there = unitsAt(state, p).filter((u) => !isDead(u) && u.id !== caller.id);
    const shared = there.length > 0 && there.length <= (call.share ?? 0) && there.every((u) => !u.down && u.side === caller.side && u.kind === call.kind);
    if (there.length === 0 || (shared && there.length < HEX_ROOM)) open.push(p);
    crowd.set(key, there.length);
  }
  const harmful = (p: HexPos) => {
    const kind = state.surfaces[posKey(p)]?.kind;
    return kind && HARMFUL.has(kind) ? 1 : 0;
  };
  const held = (p: HexPos) => crowd.get(posKey(p)) ?? 0;
  return open.sort((a, b) => held(a) - held(b) || harmful(a) - harmful(b) || hexDistance(a, from) - hexDistance(b, from) || a.q - b.q || a.r - b.r).slice(0, count);
}

/**
 * An enemy calls more of its side (a Broodmother's Brood Swarm): the call's `count` of its `kind`, at its level, in its
 * group, on open hexes beside it (kinSpots: fewer if there is no room, or it has its `most` out). Each goes in the
 * order just behind it (joinBehind).
 */
export function callKin(ctx: Ctx, caller: Unit, call: KinCall): Unit[] {
  const { state } = ctx;
  const kind = call.kind;
  if (!ENEMIES[kind]) return [];
  const called: Unit[] = [];
  for (const pos of kinSpots(state, caller, call)) {
    const unit = enemyUnit(state, kind, { q: pos.q, r: pos.r }, caller.group ?? "", caller.level);
    unit.summon = { by: caller.id };
    state.units.push(unit);
    ctx.events.push({ t: "summoned", id: unit.id, by: caller.id, at: { ...unit.pos } });
    joinBehind(ctx, caller, unit, called.length, ENEMIES[kind].move);
    called.push(unit);
  }
  arrive(ctx, called);
  return called;
}
