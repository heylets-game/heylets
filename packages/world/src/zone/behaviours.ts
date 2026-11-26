// How an enemy weighs up using one of its abilities: a behaviour. Each ability in the pool (enemyabilities.ts) names
// the behaviour that judges it (`behaviour`; by its shape when it names none), so what an enemy does follows from
// what it carries: give it another ability and it weighs that one up too, with no change to the turn (ai.ts).
//
// A behaviour answers two questions about an ability, used from a hex the enemy could stand on:
// - `reaches`: could it be used on any of these from there at all? Cheap, and asked of a great many hexes while
//   the enemy looks for somewhere to go.
// - `value`: at its best from there, on whom, and what is that worth? Null when there is nobody to use it on.
// What the ability then does when used is the rules' business (combat.ts enemyAct), not the behaviour's.

import { hexDistance, hexNeighbors, posKey, type HexPos } from "@gantt-quest/core";
import { tileAt } from "../map";
import { alliesReached, leaps, leavesReach, lungeLanding, shiftInto, shoveDest, sweepHexes } from "./combat";
import { has } from "./engine";
import { HIGH_REACH, inFight, reachFrom, sameHex, seesFor, strikes } from "./geometry";
import { ENEMY_BURST, SPLASH_SHARE, type EnemyStrike, type Mind } from "./kit";
import { diceAverage } from "./rules";
import { clusterHexes } from "./weather";
import { HARMFUL } from "./surfaces";
import type { Unit, ZoneState } from "./types";

/** What a behaviour is told: the place, and the enemy weighing it up. */
export interface Look {
  state: ZoneState;
  enemy: Unit;
  /** How it likes to fight (kit.ts Mind). */
  mind: Mind;
  /** Its fancy this turn: what it makes of using an ability on someone (null: on everyone round), as a factor on its worth. None: 1. */
  whim?: (attack: EnemyStrike, target: Unit | null) => number;
}

/** An ability used on someone (or on nobody in particular, for one that catches everyone round), and what that is worth. */
export interface Use {
  attack: EnemyStrike;
  target: Unit | null;
  /** For one that lands on more than one hex (`area`, `sweep`): the hex it is aimed at, which need not be the target's. */
  at?: HexPos;
  worth: number;
}

export interface Behaviour {
  reaches(look: Look, from: HexPos, attack: EnemyStrike, targets: readonly Unit[]): boolean;
  value(look: Look, from: HexPos, attack: EnemyStrike, targets: readonly Unit[]): Use | null;
}

/** Whether an attack of an enemy's reaches from `pos` to a hero: a blow by hand, by the rules of reach (strikes); a leap, by where it could land; a shot, by its range (further from above) and a clear line. */
export function strikeReaches(state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike, hero: Unit): boolean {
  // A leap (a Dire Wolf's Lunge): anyone it could spring at and land beside.
  if (leaps(attack)) return !!lungeLanding(state, enemy, pos, attack, hero);
  return aimReaches(state, enemy, pos, attack, hero.pos);
}

/** Whether an attack of an enemy's (not a leap) reaches from `pos` to the hex `at`, whoever is on it: as strikeReaches. */
function aimReaches(state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike, at: HexPos): boolean {
  if (attack.range === 1) return strikes(state.map, pos, at);
  // The lie of the land is looked up only where it could settle it: height adds up to HIGH_REACH to a range and takes nothing from it.
  const far = hexDistance(pos, at);
  if (far > attack.range + HIGH_REACH) return false;
  return (far <= attack.range || far <= reachFrom(state.map, pos, at, attack.range)) && seesFor(state, enemy.side, pos, at);
}

/** Where an ability that lands on more than one hex is aimed, and the heroes caught there. */
interface Aim {
  at: HexPos;
  caught: Unit[];
}

/**
 * Where an ability that lands on more than one hex (`area`, `sweep`) could be aimed from `from`, and who each aim
 * catches: any hex it reaches, not only one a hero stands on, so it can come down between two heroes and catch both.
 * Aims that catch nobody are left out. Null for an ability aimed at one hero.
 */
function spreadAims(look: Look, from: HexPos, attack: EnemyStrike, targets: readonly Unit[]): Aim[] | null {
  const { state, enemy } = look;
  const { area, sweep } = attack.kit;
  if (!area && !sweep) return null;
  let aims: HexPos[];
  if (area) {
    // What lands on a clump round the hex aimed at covers no hex further than one from it: so a hero's own hex, or one beside it.
    const seen = new Set<string>();
    aims = [];
    for (const h of targets) {
      for (const p of [h.pos, ...hexNeighbors(h.pos, state.map.grid)]) {
        const key = posKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        if (tileAt(state.map, p) && aimReaches(state, enemy, from, attack, p)) aims.push(p);
      }
    }
  } else {
    // A sweep is swung toward a hex beside it.
    aims = hexNeighbors(from, state.map.grid).filter((p) => tileAt(state.map, p) && strikes(state.map, from, p));
  }
  const out: Aim[] = [];
  for (const at of aims) {
    const hexes = area ? clusterHexes(state, from, at, area) : sweepHexes(state, from, at, sweep!);
    const caught = targets.filter((h) => hexes.some((p) => sameHex(p, h.pos)));
    if (caught.length > 0) out.push({ at, caught });
  }
  return out;
}

/**
 * What leaping from `from` to `land` (a Lunge at someone out of reach) puts at risk, as a factor on what the blow is
 * worth: half as much for each hero it would leap out of reach of who could strike at it as it went, and half again
 * for landing in fire, poison or on ice. 1: it is safe, or there is no leap.
 */
export function leapRisk(state: ZoneState, enemy: Unit, from: HexPos, land: HexPos): number {
  if (from.q === land.q && from.r === land.r) return 1;
  const reacted = state.encounter?.reacted ?? [];
  const strikers = state.units.filter(
    (u) => u.side !== enemy.side && !u.down && inFight(state, u.id) && !reacted.includes(u.id) && !has(u, "stunned") && !has(u, "prone") && leavesReach(state, u.pos, from, land),
  ).length;
  const kind = state.surfaces[posKey(land)]?.kind;
  return 0.5 ** strikers * (kind && HARMFUL.has(kind) ? 0.5 : 1);
}

/** The heroes a burst from `pos` catches: everyone within ENEMY_BURST it can see. */
const caughtBy = (look: Look, pos: HexPos, targets: readonly Unit[]): Unit[] =>
  targets.filter((h) => hexDistance(pos, h.pos) <= ENEMY_BURST && seesFor(look.state, look.enemy.side, pos, h.pos));

/**
 * One hero: the damage it does. Neither how likely it is to land nor how hurt they are comes into it: it picks no one
 * out for being easy to hit or near down, and does not mind if they are guarded. It rises to a taunt. A leap is worth
 * less for what it risks on the way (leapRisk).
 */
const strike: Behaviour = {
  reaches: (look, from, attack, targets) => {
    if (targets.some((h) => strikeReaches(look.state, look.enemy, from, attack, h))) return true;
    // One that lands on several hexes may reach a hero from a hex beside them, though not their own.
    return (spreadAims(look, from, attack, targets)?.length ?? 0) > 0;
  },
  value(look, from, attack, targets) {
    const average = diceAverage(attack.dice);
    let best: Use | null = null;
    // One that lands on several hexes (thrown onto a clump, or swept through rows) is worth what a burst is to each
    // hero caught: about half save for half. It is weighed at every hex it could be aimed at, and its whim and any
    // taunt go by whoever is on that hex, or else the first caught.
    const aims = spreadAims(look, from, attack, targets);
    if (aims) {
      for (const { at, caught } of aims) {
        const hero = caught.find((h) => sameHex(h.pos, at)) ?? caught[0];
        let worth = average * 0.75 * caught.length * (look.whim?.(attack, hero) ?? 1);
        if (caught.some((h) => has(h, "taunting"))) worth *= 3;
        if (!best || worth > best.worth) best = { attack, target: hero, at, worth };
      }
      return best;
    }
    for (const hero of targets) {
      if (!strikeReaches(look.state, look.enemy, from, attack, hero)) continue;
      // A blow that splashes is worth its share again for every other hero beside the one it is aimed at.
      const beside = attack.kit.splash ? targets.filter((h) => h !== hero && hexDistance(h.pos, hero.pos) === 1).length : 0;
      const share = 1 + beside * SPLASH_SHARE;
      let worth = average * share * (look.whim?.(attack, hero) ?? 1);
      if (leaps(attack)) worth *= leapRisk(look.state, look.enemy, from, lungeLanding(look.state, look.enemy, from, attack, hero)!);
      if (has(hero, "taunting")) worth *= 3;
      if (!best || worth > best.worth) best = { attack, target: hero, worth };
    }
    return best;
  },
};

/** Everyone round it at once: about half save for half, so three quarters of the damage, to each one caught. */
const burst: Behaviour = {
  reaches: (look, from, _attack, targets) => caughtBy(look, from, targets).length > 0,
  value(look, from, attack, targets) {
    const caught = caughtBy(look, from, targets);
    return caught.length > 0 ? { attack, target: null, worth: caught.length * diceAverage(attack.dice) * 0.75 * (look.whim?.(attack, null) ?? 1) } : null;
  },
};

/**
 * A hero beside it with a drop or a pit at their back, knocked over it: worth what the fall would do to them, and
 * into a pit (deep water, lava, off the edge) as much as their whole life. Shoving someone onto open ground is worth
 * nothing to it: it does not use it then. As with a blow, how likely it is to land, or that they catch the edge, does
 * not come into it.
 */
const shove: Behaviour = {
  reaches: (look, from, _attack, targets) => targets.some((h) => strikes(look.state.map, from, h.pos)),
  value(look, from, attack, targets) {
    let best: Use | null = null;
    for (const hero of targets) {
      if (!strikes(look.state.map, from, hero.pos) || has(hero, "prone")) continue;
      const into = shiftInto(look.state, hero.pos, shoveDest(from, hero.pos), hero);
      if (!into || into.how === "open") continue;
      let worth = (into.how === "pit" ? Math.max(8, hero.hp) : 2.5 * (into.levels - 1) + 2) * (look.whim?.(attack, hero) ?? 1);
      if (has(hero, "taunting")) worth *= 3;
      if (!best || worth > best.worth) best = { attack, target: hero, worth };
    }
    return best;
  },
};

/**
 * What a call to its own side (a Pack Leader's Howl) is worth for each ally it would Frenzy: about what two blows with
 * advantage, each leaving a stack of Bleeding, gain over two without.
 */
export const RALLY_WORTH = 5;

/** The allies a call from `pos` would stir (combat.ts alliesReached): those it reaches who are not stirred already. */
export const rallied = (state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike): Unit[] =>
  alliesReached(state, enemy, pos, attack).filter((u) => !has(u, "frenzied"));

/**
 * An ability for its own side: worth RALLY_WORTH for each ally it would stir from where it would be used, so the more
 * of them it would reach, the likelier it is to be used (and it may step in among them first); nothing with none in
 * reach. It reaches none of the other side, so it is nothing to walk toward by itself.
 */
const rally: Behaviour = {
  reaches: () => false,
  value(look, from, attack) {
    const allies = rallied(look.state, look.enemy, from, attack).length;
    return allies > 0 ? { attack, target: null, worth: allies * RALLY_WORTH * (look.whim?.(attack, null) ?? 1) } : null;
  },
};

export const BEHAVIOURS = { strike, burst, shove, rally } satisfies Record<string, Behaviour>;

export type BehaviourId = keyof typeof BEHAVIOURS;

/** The behaviour that judges an ability: the one it names, else by its shape. */
export const behaviourOf = (attack: EnemyStrike): Behaviour => BEHAVIOURS[attack.behaviour];
