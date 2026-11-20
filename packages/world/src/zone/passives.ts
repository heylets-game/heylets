// What each passive does in a hex fight. A passive is picked in the logbook
// (traits.ts holds its name, blurb, class and level) and rides into a map
// with the hero as Unit.passives. Its hooks here, under the same id, are
// called at a few points of a fight; a passive uses only the ones it needs.

import { hexDistance } from "@gantt-quest/core";
import type { AbilityDef } from "../content";
import { addCondition, has, heal, removeCondition, type Ctx } from "./engine";
import { AURAS } from "./kit";
import type { Unit, ZoneState } from "./types";

export interface PassiveHooks {
  /** They enter a fight, or come back into one they fled. */
  enterFight?(ctx: Ctx, unit: Unit): void;
  /**
   * The start of each of their turns in a fight (`inFight`), and each round counted out of one: after bleeding
   * and burning have ticked, and only if they are still standing.
   */
  turnStart?(ctx: Ctx, unit: Unit, inFight: boolean): void;
  /** Damage added to an ability of theirs. Read for the preview as well as the blow, so it must not change anything. */
  damageBonus?(state: ZoneState, unit: Unit, def: AbilityDef): number;
  /** An ability of theirs has hit `target` for `dealt` HP (after armor, guard and the like). */
  hit?(ctx: Ctx, unit: Unit, target: Unit, def: AbilityDef, dealt: number, crit: boolean): void;
  /** An ability of theirs is done. `struck`: it hit at least one enemy. */
  abilityDone?(ctx: Ctx, unit: Unit, def: AbilityDef, struck: boolean): void;
  /** They have set an enemy Burning (it has caught: a Wet one does not). */
  kindled?(ctx: Ctx, unit: Unit, target: Unit): void;
  /** Hexes added to the reach of their auras (Beacon, Healing). */
  auraReach?: number;
  /** Defence they give `ally` (themselves too). Two of the same passive do not stack: the best one counts. */
  defenceFor?(state: Pick<ZoneState, "units">, unit: Unit, ally: Unit): number;
  /** Added to their roll to hit `target` with an ability. Read for the preview too, so it must not change anything. */
  toHit?(unit: Unit, target: Unit, def: AbilityDef): number;
  /** HP `ally` (themselves too) heals as its turn in a fight starts. Two of the same passive do not stack. */
  allyTurnHeal?(unit: Unit, ally: Unit): number;
}

/** The Mage's lightning: what Greater Conductivity and Potent Shocks work with. */
export const LIGHTNING: ReadonlySet<string> = new Set(["shock", "lightning_strike", "chain_lightning"]);
/** Osmosis: what one Wet heals as each of their turns starts. */
export const OSMOSIS_HEAL = 2;
/** Potent Shocks: the turns of Shocked a lightning hit leaves, and the Defence it takes. */
export const SHOCKED = { rounds: 2, defence: 2 };

/** Half a hero's level, rounded up. */
const halfLevel = (unit: Unit): number => Math.ceil(unit.level / 2);

/** Whether an ability is an attack: it does damage. */
const isAttack = (def: AbilityDef): boolean => (def.damage ?? 0) > 0;

/** Every passive's hooks, by its id in traits.ts. */
export const PASSIVE_HOOKS: Record<string, PassiveHooks> = {
  // Paladin, first pick.
  inspiring_strikes: {
    abilityDone(ctx, unit, def, struck) {
      if (!struck || !isAttack(def) || unit.down) return;
      const ally = ctx.state.units
        .filter((u) => u.side === unit.side && u.id !== unit.id && !u.down && u.hp < u.maxHp && hexDistance(u.pos, unit.pos) <= INSPIRING_RANGE)
        .sort((a, b) => hexDistance(a.pos, unit.pos) - hexDistance(b.pos, unit.pos) || a.hp - b.hp || a.id.localeCompare(b.id))[0];
      if (ally) heal(ctx, ally, halfLevel(unit), { actor: unit.id, what: "inspiring_strikes" });
    },
  },
  // Fervor's `amount` is the bonus ready for the next attack (0: none yet). Lit by an attack, a new one is
  // `pending` until that attack is done, so it is never the attack that lit it that it adds to, and it
  // does not stack: one ready, or one waiting, at a time.
  beaming_fervor: {
    kindled(ctx, unit) {
      const c = unit.conditions.find((x) => x.kind === "fervor");
      if (c) {
        c.pending = true;
        return;
      }
      addCondition(ctx, unit, "fervor", 1);
      const lit = unit.conditions.find((x) => x.kind === "fervor");
      if (lit) Object.assign(lit, { amount: 0, pending: true });
    },
    damageBonus(_state, unit, def) {
      return isAttack(def) ? (unit.conditions.find((x) => x.kind === "fervor")?.amount ?? 0) : 0;
    },
    abilityDone(_ctx, unit, def) {
      const c = unit.conditions.find((x) => x.kind === "fervor");
      if (!c) return;
      if (isAttack(def)) c.amount = 0;
      ready(unit);
    },
    // Lit outside an attack of theirs (a blow while it is someone else's turn), it is ready by their own.
    turnStart(_ctx, unit) {
      ready(unit);
    },
  },
  // Paladin, second pick.
  brighter_beacon: { auraReach: 1 },
  stay_near: {
    defenceFor: (_state, unit, ally) => (hexDistance(unit.pos, ally.pos) <= STAY_NEAR.range ? STAY_NEAR.defence : 0),
  },
  // Mage, first pick.
  evening_mist: {
    defenceFor: (_state, unit, ally) => (ally.id === unit.id && has(unit, "wet") ? 1 : 0),
  },
  greater_conductivity: {
    toHit: (_unit, target, def) => (LIGHTNING.has(def.id) && has(target, "wet") ? 1 : 0),
  },
  // Mage, second pick.
  potent_shocks: {
    hit(ctx, _unit, target, def) {
      if (LIGHTNING.has(def.id) && !target.down) addCondition(ctx, target, "shocked", SHOCKED.rounds);
    },
  },
  osmosis: {
    allyTurnHeal: (_unit, ally) => (has(ally, "wet") ? OSMOSIS_HEAL : 0),
  },
};

/** Beaming Fervor: a Fervor waiting is made ready; one spent with none waiting is gone. */
function ready(unit: Unit): void {
  const c = unit.conditions.find((x) => x.kind === "fervor");
  if (!c) return;
  if (c.pending) {
    delete c.pending;
    c.amount = halfLevel(unit);
  } else if (!c.amount) removeCondition(unit, "fervor");
}

/** Inspiring Strikes: how near the ally it heals must be. */
export const INSPIRING_RANGE = 2;
/** Stay Near: how near an ally must be, and the Defence it gives. */
export const STAY_NEAR = { range: 2, defence: 1 };

/** The hooks of the passives a unit carries, in the order they were picked. */
export function passiveHooks(unit: Unit): PassiveHooks[] {
  return (unit.passives ?? []).flatMap((id) => (PASSIVE_HOOKS[id] ? [PASSIVE_HOOKS[id]] : []));
}

/** How far a unit's auras reach. */
export const auraRange = (unit: Unit): number => AURAS.range + passiveHooks(unit).reduce((n, p) => n + (p.auraReach ?? 0), 0);

/**
 * What the passives of a unit's side (its own too) give it, by each one's `pick`: the best of each passive,
 * so two of the same do not stack, and different passives add up.
 */
function bestOfEach(state: Pick<ZoneState, "units">, ally: Unit, pick: (p: PassiveHooks, holder: Unit) => number): number {
  const best = new Map<string, number>();
  for (const u of state.units) {
    if (u.side !== ally.side || u.down) continue;
    for (const id of u.passives ?? []) {
      const p = PASSIVE_HOOKS[id];
      if (p) best.set(id, Math.max(best.get(id) ?? 0, pick(p, u)));
    }
  }
  return [...best.values()].reduce((a, b) => a + b, 0);
}

/** Defence a unit has from the passives of its side (its own too). */
export const passiveDefence = (state: Pick<ZoneState, "units">, ally: Unit): number =>
  bestOfEach(state, ally, (p, u) => p.defenceFor?.(state, u, ally) ?? 0);

/** What a unit's passives add to its roll to hit `target` with an ability. */
export const passiveToHit = (unit: Unit, target: Unit, def: AbilityDef): number =>
  passiveHooks(unit).reduce((n, p) => n + (p.toHit?.(unit, target, def) ?? 0), 0);

/** As a unit's turn in a fight starts: what the passives of its side heal it (Osmosis). */
export function allyTurnHeal(ctx: Ctx, ally: Unit): void {
  if (ally.down || ally.hp >= ally.maxHp) return;
  for (const id of new Set(ctx.state.units.filter((u) => u.side === ally.side && !u.down).flatMap((u) => u.passives ?? []))) {
    const p = PASSIVE_HOOKS[id];
    if (!p?.allyTurnHeal) continue;
    const holders = ctx.state.units.filter((u) => u.side === ally.side && !u.down && u.passives?.includes(id));
    const best = holders.map((u) => ({ u, n: p.allyTurnHeal!(u, ally) })).sort((a, b) => b.n - a.n)[0];
    if (best && best.n > 0) heal(ctx, ally, best.n, { actor: best.u.id, what: id });
  }
}

/** Tell a unit's passives it has set `target` Burning, if it has caught. */
export function kindledBy(ctx: Ctx, unit: Unit | undefined, target: Unit): void {
  if (!unit || unit.side === target.side || !has(target, "burning")) return;
  for (const p of passiveHooks(unit)) p.kindled?.(ctx, unit, target);
}
