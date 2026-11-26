// How an enemy weighs up using one of its abilities: a behaviour. Each ability in the pool (enemyabilities.ts) names
// the behaviour that judges it (`behaviour`; by its shape when it names none), so what an enemy does follows from
// what it carries: give it another ability and it weighs that one up too, with no change to the turn (ai.ts).
//
// A behaviour answers two questions about an ability, used from a hex the enemy could stand on:
// - `reaches`: could it be used on any of these from there at all? Cheap, and asked of a great many hexes while
//   the enemy looks for somewhere to go.
// - `value`: at its best from there, on whom, and what is that worth? Null when there is nobody to use it on.
// What the ability then does when used is the rules' business (combat.ts enemyAct), not the behaviour's.

import { hexDistance, posKey, type HexPos } from "@gantt-quest/core";
import { leaps, leavesReach, lungeLanding, shiftInto, shoveDest } from "./combat";
import { has } from "./engine";
import { HIGH_REACH, inFight, reachFrom, seesFor, strikes } from "./geometry";
import { ENEMY_BURST, SPLASH_SHARE, type EnemyStrike, type Mind } from "./kit";
import { diceAverage } from "./rules";
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
  if (attack.range === 1) return strikes(state.map, pos, hero.pos);
  // The lie of the land is looked up only where it could settle it: height adds up to HIGH_REACH to a range and takes nothing from it.
  const far = hexDistance(pos, hero.pos);
  if (far > attack.range + HIGH_REACH) return false;
  return (far <= attack.range || far <= reachFrom(state.map, pos, hero.pos, attack.range)) && seesFor(state, enemy.side, pos, hero.pos);
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
  reaches: (look, from, attack, targets) => targets.some((h) => strikeReaches(look.state, look.enemy, from, attack, h)),
  value(look, from, attack, targets) {
    const average = diceAverage(attack.dice);
    let best: Use | null = null;
    for (const hero of targets) {
      if (!strikeReaches(look.state, look.enemy, from, attack, hero)) continue;
      // A blow that splashes is worth its share again for every other hero beside the one it is aimed at.
      const beside = attack.kit.splash ? targets.filter((h) => h !== hero && hexDistance(h.pos, hero.pos) === 1).length : 0;
      let worth = average * (1 + beside * SPLASH_SHARE) * (look.whim?.(attack, hero) ?? 1);
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

export const BEHAVIOURS = { strike, burst, shove } satisfies Record<string, Behaviour>;

export type BehaviourId = keyof typeof BEHAVIOURS;

/** The behaviour that judges an ability: the one it names, else by its shape. */
export const behaviourOf = (attack: EnemyStrike): Behaviour => BEHAVIOURS[attack.behaviour];
