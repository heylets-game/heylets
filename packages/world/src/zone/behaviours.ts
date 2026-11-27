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
import { alliesReached, dashWay, leaps, leavesReach, lungeLanding, shiftInto, shoveDest, spreadHexes } from "./combat";
import { has } from "./engine";
import { HIGH_REACH, blast, covers, gap, inFight, meet, nearOf, reachFrom, reaches, sameHex, seesFor, span, strikes } from "./geometry";
import { SPLASH_SHARE, type EnemyStrike, type Mind } from "./kit";
import { diceAverage } from "./rules";
import { HARMFUL } from "./surfaces";
import { kinSpots } from "./summon";
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

/**
 * Whether an attack of an enemy's (not a leap) reaches from `pos` to the hex `at`, whoever is on it: as strikeReaches.
 * A big enemy (geometry.ts span) anchored at `pos` reaches from any of its hexes.
 */
export function aimReaches(state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike, at: HexPos): boolean {
  return span(enemy, pos).some((p) => aimReachesFrom(state, enemy, p, attack, at));
}

function aimReachesFrom(state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike, at: HexPos): boolean {
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
 * Where an ability that lands on more than one hex (`area`, `sweep`, `cone`, `line`, `dash`) could be aimed from `from`, and who each aim
 * catches: any hex it reaches, not only one a hero stands on, so it can come down between two heroes and catch both.
 * Aims that catch nobody are left out. Null for an ability aimed at one hero.
 */
function spreadAims(look: Look, from: HexPos, attack: EnemyStrike, targets: readonly Unit[]): Aim[] | null {
  const { state, enemy } = look;
  const { area, blast: wide, sweep, cone, line, dash } = attack.kit;
  if (!area && !wide && !sweep && !cone && !line && !dash) return null;
  if (dash) {
    // A dash goes as straight as hexes lie toward its aim: aimed at each hex of the ring as far out as it reaches, it
    // goes every way it can. It catches whoever is on the hexes it passes through, not where it comes to rest.
    const out: Aim[] = [];
    for (const at of blast(state.map, from, attack.range)) {
      if (hexDistance(from, at) !== attack.range) continue;
      const way = dashWay(state, enemy, from, at, attack.range);
      const caught = way ? targets.filter((h) => way.through.some((p) => covers(h, p))) : [];
      if (caught.length > 0) out.push({ at, caught });
    }
    return out;
  }
  let aims: HexPos[];
  if (area || wide) {
    // What lands on a clump round the hex aimed at covers no hex further than one from it: so a hero's own hex, or one
    // beside it. What lands on a blast covers every hex as far from it as it is wide.
    const seen = new Set<string>();
    aims = [];
    for (const h of targets) {
      for (const p of wide ? blast(state.map, h.pos, wide) : [h.pos, ...hexNeighbors(h.pos, state.map.grid)]) {
        const key = posKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        if (tileAt(state.map, p) && aimReaches(state, enemy, from, attack, p)) aims.push(p);
      }
    }
  } else if (sweep) {
    // A sweep is swung toward a hex beside it.
    aims = hexNeighbors(from, state.map.grid).filter((p) => tileAt(state.map, p) && strikes(state.map, from, p));
  } else {
    // A cone or a line points whichever way it is aimed: aimed at each hex of the ring as far out as it reaches, it
    // points every way it can.
    const far = (cone ?? line)!;
    aims = blast(state.map, from, far).filter((p) => hexDistance(from, p) === far);
  }
  const out: Aim[] = [];
  for (const at of aims) {
    const hexes = spreadHexes(state, attack.kit, from, at) ?? [];
    const caught = targets.filter((h) => hexes.some((p) => covers(h, p)));
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
    (u) => u.side !== enemy.side && !u.down && inFight(state, u.id) && !reacted.includes(u.id) && !has(u, "stunned") && !has(u, "prone") && leavesReach(state, u, enemy, from, land),
  ).length;
  const kind = state.surfaces[posKey(land)]?.kind;
  return 0.5 ** strikers * (kind && HARMFUL.has(kind) ? 0.5 : 1);
}

/** The heroes a burst from `pos` catches: everyone within its reach (`range`) it can see. */
const caughtBy = (look: Look, pos: HexPos, attack: EnemyStrike, targets: readonly Unit[]): Unit[] =>
  targets.filter((h) => gap(look.enemy, h, pos) <= attack.range && seesFor(look.state, look.enemy.side, ...meet(look.enemy, h, pos)));

/**
 * What a burst that does no harm (Memento Mori) is worth for each hero it would leave its condition on: about a blow,
 * for what it spoils of theirs after. One who has it already is worth nothing to it.
 */
export const CURSE_WORTH = 6;

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
        // One that does no harm (Spin Web) is worth what it leaves on the ground: CURSE_WORTH for each hero caught who is
        // not standing in that ground already.
        const ground = attack.kit.surface?.kind;
        const fresh = attack.harmless ? caught.filter((h) => !ground || !span(h).some((p) => look.state.surfaces[posKey(p)]?.kind === ground)).length : 0;
        let worth = (attack.harmless ? fresh * CURSE_WORTH : average * 0.75 * caught.length) * (look.whim?.(attack, hero) ?? 1);
        if (worth <= 0) continue;
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

/**
 * Everyone round it at once: about half save for half, so three quarters of the damage, to each one caught. One that
 * does no harm is worth CURSE_WORTH for each it would catch who does not have what it leaves already.
 */
const burst: Behaviour = {
  reaches: (look, from, attack, targets) => caughtBy(look, from, attack, targets).length > 0,
  value(look, from, attack, targets) {
    if (attack.harmless) {
      const effect = attack.saveOr?.effect;
      const fresh = caughtBy(look, from, attack, targets).filter((h) => !effect || !has(h, effect)).length;
      return fresh > 0 ? { attack, target: null, worth: fresh * CURSE_WORTH * (look.whim?.(attack, null) ?? 1) } : null;
    }
    const caught = caughtBy(look, from, attack, targets);
    // An Earthquake's heave on its next turn counts for half: some will have got off the cracked ground by then.
    const heave = attack.kit.aftershock ? diceAverage(attack.kit.aftershock.dice) * 0.5 : 0;
    return caught.length > 0 ? { attack, target: null, worth: caught.length * (diceAverage(attack.dice) + heave) * 0.75 * (look.whim?.(attack, null) ?? 1) } : null;
  },
};

/**
 * A hero beside it with a drop or a pit at their back, knocked over it: worth what the fall would do to them, and
 * into a pit (deep water, lava, off the edge) as much as their whole life. Shoving someone onto open ground is worth
 * nothing to it: it does not use it then. As with a blow, how likely it is to land, or that they catch the edge, does
 * not come into it.
 */
const shove: Behaviour = {
  reaches: (look, from, _attack, targets) => targets.some((h) => reaches(look.state.map, look.enemy, h, from)),
  value(look, from, attack, targets) {
    let best: Use | null = null;
    for (const hero of targets) {
      if (!reaches(look.state.map, look.enemy, hero, from) || has(hero, "prone")) continue;
      // Shoved straight away from the hex of a big one nearest them.
      const into = shiftInto(look.state, hero.pos, shoveDest(nearOf(look.enemy, hero.pos, from), hero.pos), hero);
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

/** What a Slowing Field is worth for each hero it would reach (behaviour `field`): about a blow, for keeping them close. */
export const FIELD_WORTH = 6;

/**
 * A field round its user (a Slowing Field): worth FIELD_WORTH for each hero, in the fight and not Slowed already, within
 * its reach of where it would be raised, so the more it would hold near it the likelier it is; nothing with none near.
 * Heroes it would reach are worth walking toward.
 */
const fielded = (look: Look, from: HexPos, attack: EnemyStrike, targets: readonly Unit[]): Unit[] =>
  targets.filter((h) => !has(h, "slowed") && gap(look.enemy, h, from) <= (attack.kit.field?.radius ?? 0));

const field: Behaviour = {
  reaches: (look, from, attack, targets) => fielded(look, from, attack, targets).length > 0,
  value(look, from, attack, targets) {
    const caught = fielded(look, from, attack, targets).length;
    return caught > 0 ? { attack, target: null, worth: caught * FIELD_WORTH * (look.whim?.(attack, null) ?? 1) } : null;
  },
};

/** What a call for more of its side (a Broodmother's Brood Swarm) is worth for each one that would come: about a blow of theirs. */
export const KIN_WORTH = 5;

/**
 * A call for more of its side (behaviour `summon`): worth KIN_WORTH for each that has room to stand beside it where it
 * would call them (summon.ts kinSpots: none once it has its most out), and only while one of the other side is in the fight. It reaches none of the
 * other side, so it is nothing to walk toward by itself.
 */
const summon: Behaviour = {
  reaches: () => false,
  value(look, from, attack, targets) {
    const call = attack.kit.summon;
    if (!call || targets.length === 0) return null;
    const room = kinSpots(look.state, look.enemy, call, from).length;
    return room > 0 ? { attack, target: null, worth: room * KIN_WORTH * (look.whim?.(attack, null) ?? 1) } : null;
  },
};

export const BEHAVIOURS = { strike, burst, shove, rally, field, summon } satisfies Record<string, Behaviour>;

export type BehaviourId = keyof typeof BEHAVIOURS;

/** The behaviour that judges an ability: the one it names, else by its shape. */
export const behaviourOf = (attack: EnemyStrike): Behaviour => BEHAVIOURS[attack.behaviour];
