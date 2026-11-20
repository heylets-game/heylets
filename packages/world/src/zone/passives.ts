// What each passive does in a hex fight. A passive is picked in the logbook
// (traits.ts holds its name, blurb, class and level) and rides into a map
// with the hero as Unit.passives. Its hooks here, under the same id, are
// called at a few points of a fight; a passive uses only the ones it needs.
// None are written yet.

import type { AbilityDef } from "../content";
import type { Ctx } from "./engine";
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
}

/** Every passive's hooks, by its id in traits.ts. */
export const PASSIVE_HOOKS: Record<string, PassiveHooks> = {};

/** The hooks of the passives a unit carries, in the order they were picked. */
export function passiveHooks(unit: Unit): PassiveHooks[] {
  return (unit.passives ?? []).flatMap((id) => (PASSIVE_HOOKS[id] ? [PASSIVE_HOOKS[id]] : []));
}
