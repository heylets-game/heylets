// How an enemy weighs up using one of its abilities: a behaviour. Each ability in the pool (enemyabilities.ts) names
// the behaviour that judges it (`behaviour`; by its shape when it names none), so what an enemy does follows from
// what it carries: give it another ability and it weighs that one up too, with no change to the turn (ai.ts).
//
// A behaviour answers two questions about an ability, used from a hex the enemy could stand on:
// - `reaches`: could it be used on any of these from there at all? Cheap, and asked of a great many hexes while
//   the enemy looks for somewhere to go.
// - `value`: at its best from there, on whom, and what is that worth? Null when there is nobody to use it on.
// What the ability then does when used is the rules' business (combat.ts enemyAct), not the behaviour's.

import { hexDistance, type HexPos } from "@gantt-quest/core";
import { attackContext, defenceOf, has } from "./engine";
import { HIGH_REACH, reachFrom, seesFor, strikes } from "./geometry";
import { ENEMY_BURST, type EnemyStrike, type Mind } from "./kit";
import { diceAverage, hitChance } from "./rules";
import type { Unit, ZoneState } from "./types";

/** What a behaviour is told: the place, and the enemy weighing it up. */
export interface Look {
  state: ZoneState;
  enemy: Unit;
  /** How it likes to fight (kit.ts Mind). */
  mind: Mind;
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

/** Whether an attack of an enemy's reaches from `pos` to a hero: a blow by hand, by the rules of reach (strikes); a shot, by its range (further from above) and a clear line. */
export function strikeReaches(state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike, hero: Unit): boolean {
  if (attack.range === 1) return strikes(state.map, pos, hero.pos);
  // The lie of the land is looked up only where it could settle it: height adds up to HIGH_REACH to a range and takes nothing from it.
  const far = hexDistance(pos, hero.pos);
  if (far > attack.range + HIGH_REACH) return false;
  return (far <= attack.range || far <= reachFrom(state.map, pos, hero.pos, attack.range)) && seesFor(state, enemy.side, pos, hero.pos);
}

/** The heroes a burst from `pos` catches: everyone within ENEMY_BURST it can see. */
const caughtBy = (look: Look, pos: HexPos, targets: readonly Unit[]): Unit[] =>
  targets.filter((h) => hexDistance(pos, h.pos) <= ENEMY_BURST && seesFor(look.state, look.enemy.side, pos, h.pos));

/**
 * One hero, hit or missed: the chance it lands times the damage it does. How hurt they are does not come into it: it
 * picks no one out for being near down. It rises to a taunt, and thinks less of a blow at someone guarded.
 */
const strike: Behaviour = {
  reaches: (look, from, attack, targets) => targets.some((h) => strikeReaches(look.state, look.enemy, from, attack, h)),
  value(look, from, attack, targets) {
    const { state, enemy } = look;
    const there = { ...enemy, pos: from };
    const average = diceAverage(attack.dice);
    let best: Use | null = null;
    for (const hero of targets) {
      if (!strikeReaches(state, enemy, from, attack, hero)) continue;
      const c = attackContext(state, there, hero, { melee: attack.range === 1 });
      let worth = hitChance(attack.bonus + c.mods, defenceOf(hero, state), c.adv) * average * (has(hero, "guarded") ? 0.5 : 1);
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
    return caught.length > 0 ? { attack, target: null, worth: caught.length * diceAverage(attack.dice) * 0.75 } : null;
  },
};

export const BEHAVIOURS = { strike, burst } satisfies Record<string, Behaviour>;

export type BehaviourId = keyof typeof BEHAVIOURS;

/** The behaviour that judges an ability: the one it names, else by its shape. */
export const behaviourOf = (attack: EnemyStrike): Behaviour => BEHAVIOURS[attack.behaviour];
