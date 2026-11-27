// When an effect does not work: a list of what stops it, each a plain piece of data, so any effect of any ability, a
// hero's or an enemy's, can carry one (a troll's drain does nothing while it burns).

import { gap, inFight } from "./geometry";
import { has, inWater } from "./engine";
import type { Condition, Unit, ZoneState } from "./types";

/** One thing that stops an effect while it holds of the unit the effect is for. */
export type Unless =
  /** It has this condition. */
  | { has: Condition }
  /** One of the other side, standing and in the fight, is beside it. */
  | { besideFoe: true }
  /** It stands in water. */
  | { inWater: true };

/** What a blow gives back to its user: this share of the damage it dealt (at least 1), unless something stops it. */
export interface Drain {
  share: number;
  unless?: Unless[];
}

/** Whether any of `unless` holds of `unit` now. Nothing (or an empty list): never. */
export function stopped(state: ZoneState, unit: Unit, unless: readonly Unless[] | undefined): boolean {
  return (unless ?? []).some((u) => {
    if ("has" in u) return has(unit, u.has);
    if ("besideFoe" in u) return state.units.some((o) => o.side !== unit.side && !o.down && inFight(state, o.id) && gap(o, unit) <= 1);
    return inWater(state, unit);
  });
}
