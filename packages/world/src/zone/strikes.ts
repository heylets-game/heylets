// An enemy's ability aimed by hand: the combat sandbox (the Maps tab), where the dev plays the enemy too. What it
// does once aimed is the same as when the enemy's own turn uses it (combat.ts enemyAct); this is only what it is
// aimed at, whether it reaches, and what it would land on, for the map to show before it is used.

import type { HexPos } from "@gantt-quest/core";
import { aimReaches, strikeReaches } from "./behaviours";
import { alliesReached, dashWay, spreadHexes, spreads } from "./combat";
import { blast, covers, sameHex, span } from "./geometry";
import { ENEMY_BURST, type EnemyStrike } from "./kit";
import { quakeHexes } from "./weather";
import { kinSpots } from "./summon";
import type { Unit, ZoneState } from "./types";

/**
 * What an enemy ability is aimed at: `self`, nothing (a burst round it, a call to its own side or for more of it); `hex`, a hex (one that
 * lands on a clump of hexes or a blast of them, sweeps through rows of them, reaches over a cone or down a line of them, or dashes through a line of them); `unit`, one of the other side (a blow, a shot, a leap).
 */
export type StrikeAim = "self" | "hex" | "unit";

export const strikeAim = (attack: EnemyStrike): StrikeAim =>
  attack.burst || attack.kit.rally || attack.kit.aftershock || attack.kit.field || attack.kit.summon ? "self" : spreads(attack.kit) || attack.kit.dash || attack.kit.heal ? "hex" : "unit";

/** Why `enemy` cannot use `attack` on this aim from where it stands, in words, or null if it can. `anywhere`: range and line of sight are not asked. */
export function checkStrike(state: ZoneState, enemy: Unit, attack: EnemyStrike, aim: { target?: Unit; at?: HexPos }, anywhere = false): string | null {
  const kind = strikeAim(attack);
  if (kind === "unit") {
    if (!aim.target || aim.target.side === enemy.side || aim.target.down) return "Pick one of the other side, standing.";
    return anywhere || strikeReaches(state, enemy, enemy.pos, attack, aim.target) ? null : `${attack.name} does not reach them from there.`;
  }
  if (kind === "hex") {
    if (!aim.at) return "Pick a hex.";
    if (attack.kit.spread && ["sweep", "cone", "line"].includes(attack.kit.spread.shape)) return sameHex(aim.at, enemy.pos) ? "Pick a hex to aim toward." : null;
    if (attack.kit.dash) {
      if (sameHex(aim.at, enemy.pos)) return "Pick a hex to dash toward.";
      return dashWay(state, enemy, enemy.pos, aim.at, attack.range) ? null : `There is nowhere to come to rest that way.`;
    }
    return anywhere || aimReaches(state, enemy, enemy.pos, attack, aim.at) ? null : `${attack.name} does not reach there from here.`;
  }
  return null;
}

/** The hexes `attack` would land on, used by `enemy` from where it stands at `at` (its target's hex, for one aimed at a unit). */
export function strikeHexes(state: ZoneState, enemy: Unit, attack: EnemyStrike, at?: HexPos): HexPos[] {
  if (attack.kit.rally) return alliesReached(state, enemy, enemy.pos, attack).map((u) => u.pos);
  // An Earthquake shakes the ground round all of a big one; a burst reaches out from any of its hexes.
  if (attack.kit.aftershock) return quakeHexes(state, span(enemy), ENEMY_BURST);
  if (attack.kit.field) return quakeHexes(state, span(enemy), attack.kit.field.radius);
  if (attack.kit.summon) return kinSpots(state, enemy, attack.kit.summon);
  if (strikeAim(attack) === "self") {
    const all = new Map(span(enemy).flatMap((p) => blast(state.map, p, attack.range)).map((p) => [`${p.q},${p.r}`, p]));
    return [...all.values()].filter((p) => !covers(enemy, p));
  }
  if (!at) return [];
  const spread = spreadHexes(state, attack.kit, enemy.pos, at);
  if (spread) return spread;
  if (attack.kit.dash) {
    const way = dashWay(state, enemy, enemy.pos, at, attack.range);
    return way ? [...way.through, way.land] : [];
  }
  return [at];
}
