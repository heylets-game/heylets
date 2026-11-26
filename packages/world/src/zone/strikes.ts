// An enemy's ability aimed by hand: the combat sandbox (the Maps tab), where the dev plays the enemy too. What it
// does once aimed is the same as when the enemy's own turn uses it (combat.ts enemyAct); this is only what it is
// aimed at, whether it reaches, and what it would land on, for the map to show before it is used.

import type { HexPos } from "@gantt-quest/core";
import { aimReaches, strikeReaches } from "./behaviours";
import { alliesReached, sweepHexes } from "./combat";
import { blast, sameHex } from "./geometry";
import { ENEMY_BURST, type EnemyStrike } from "./kit";
import { clusterHexes } from "./weather";
import type { Unit, ZoneState } from "./types";

/**
 * What an enemy ability is aimed at: `self`, nothing (a burst round it, a call to its own side); `hex`, a hex (one that
 * lands on a clump of hexes, or sweeps through rows of them); `unit`, one of the other side (a blow, a shot, a leap).
 */
export type StrikeAim = "self" | "hex" | "unit";

export const strikeAim = (attack: EnemyStrike): StrikeAim =>
  attack.burst || attack.kit.rally || attack.kit.aftershock ? "self" : attack.kit.area || attack.kit.sweep ? "hex" : "unit";

/** Why `enemy` cannot use `attack` on this aim from where it stands, in words, or null if it can. `anywhere`: range and line of sight are not asked. */
export function checkStrike(state: ZoneState, enemy: Unit, attack: EnemyStrike, aim: { target?: Unit; at?: HexPos }, anywhere = false): string | null {
  const kind = strikeAim(attack);
  if (kind === "unit") {
    if (!aim.target || aim.target.side === enemy.side || aim.target.down) return "Pick one of the other side, standing.";
    return anywhere || strikeReaches(state, enemy, enemy.pos, attack, aim.target) ? null : `${attack.name} does not reach them from there.`;
  }
  if (kind === "hex") {
    if (!aim.at) return "Pick a hex.";
    if (attack.kit.sweep) return sameHex(aim.at, enemy.pos) ? "Pick a hex to swing toward." : null;
    return anywhere || aimReaches(state, enemy, enemy.pos, attack, aim.at) ? null : `${attack.name} does not reach there from here.`;
  }
  return null;
}

/** The hexes `attack` would land on, used by `enemy` from where it stands at `at` (its target's hex, for one aimed at a unit). */
export function strikeHexes(state: ZoneState, enemy: Unit, attack: EnemyStrike, at?: HexPos): HexPos[] {
  if (attack.kit.rally) return alliesReached(state, enemy, enemy.pos, attack).map((u) => u.pos);
  if (strikeAim(attack) === "self") return blast(state.map, enemy.pos, ENEMY_BURST);
  if (!at) return [];
  if (attack.kit.area) return clusterHexes(state, enemy.pos, at, attack.kit.area);
  if (attack.kit.sweep) return sweepHexes(state, enemy.pos, at, attack.kit.sweep);
  return [at];
}
