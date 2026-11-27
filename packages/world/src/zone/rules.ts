// The dice. An attack is one d20 plus a bonus against the target's Defence;
// advantage and disadvantage roll two and keep the better or the worse; a
// natural 20 is a critical hit and rolls its damage dice twice. Damage and
// healing are dice too. Everything here is plain arithmetic on a seeded Rng.

import type { StatKey, Stats } from "@gantt-quest/core";
import type { Rng } from "../rng";
import type { Roll, RollMod, Rolled, Unit } from "./types";

export interface Dice {
  n: number;
  d: number;
  plus: number;
}

/** A hero's modifier for a stat: 5 is average. */
export const mod = (stat: number): number => Math.floor((stat - 5) / 2);

/** What practice adds to every attack and save difficulty: 2, and one more every four levels. */
export const proficiency = (level: number): number => 2 + Math.floor((Math.max(1, level) - 1) / 4);

export const statOf = (unit: Pick<Unit, "stats">, stat: StatKey): number => unit.stats?.[stat] ?? 5;

/** Steps of open ground 1 AP buys a hero: half of 5 shifted by Agility (that never under 4 or over 8), so 2 to 4. */
export function heroMove(stats: Stats): number {
  return Math.max(1, Math.floor(Math.max(4, Math.min(8, 5 + Math.floor((stats.agi - 5) / 3))) / 2));
}

/** A hero's Defence: 10, plus Agility, plus half their armor (armor counts for 6 at most). */
export function heroDefence(stats: Stats, armor: number): number {
  return 10 + mod(stats.agi) + Math.min(6, Math.floor(armor / 2));
}

/**
 * Dice that average about `amount`: one die up to 8, two beyond, and whatever is left over as a flat bonus.
 * 6 is 1d8+2; 12 is 2d8+3.
 */
export function diceFor(amount: number): Dice {
  const want = Math.max(1, amount);
  const n = want <= 8 ? 1 : 2;
  const sizes = [4, 6, 8, 10, 12];
  const ideal = (want / n) * 1.3;
  const d = sizes.reduce((best, s) => (Math.abs(s - ideal) < Math.abs(best - ideal) ? s : best), sizes[0]);
  const plus = Math.max(0, Math.round(want - (n * (d + 1)) / 2));
  return { n, d, plus };
}

/** How fast a number on an ability grows with level: its share more for every level past the first (SCALE_RATES). */
export type ScaleRate = "none" | "low" | "standard" | "high" | "extreme";

/** What each rate adds, per level past the first, as a share of the number at level 1. */
export const SCALE_RATES: Record<ScaleRate, number> = { none: 0, low: 0.05, standard: 0.1, high: 0.15, extreme: 0.2 };

/** The rate a number grows at when an ability does not say. */
export const DEFAULT_SCALE: ScaleRate = "standard";

/** `base` (its level-1 value) at `level`, growing at `rate`: 6 at standard is 6 at level 1, 11.4 at 10, 17.4 at 20. */
export const scaled = (base: number, rate: ScaleRate, level: number): number => base * (1 + SCALE_RATES[rate] * Math.max(0, level - 1));

export const diceAverage = (dice: Dice): number => (dice.n * (dice.d + 1)) / 2 + dice.plus;

export const diceText = (dice: Dice): string => `${dice.n}d${dice.d}${dice.plus > 0 ? `+${dice.plus}` : dice.plus < 0 ? `${dice.plus}` : ""}`;

/** Roll damage or healing. A critical hit rolls the dice (not the flat part) twice. */
export function rollDice(rng: Rng, dice: Dice, crit = false): number {
  return rollShown(rng, dice, 0, crit).total;
}

/**
 * Roll damage or healing and keep what each die showed, for the log: the dice, `more` added to their flat
 * part (a hero's stat, weapon and level; whatever else the blow adds), and what it all came to. `mods`: what of
 * `more` came from the moment (Rolled `mods`), kept to be shown; those that add nothing are left out.
 */
export function rollShown(rng: Rng, dice: Dice, more = 0, crit = false, mods: RollMod[] = []): Rolled {
  const faces: number[] = [];
  for (let i = 0; i < dice.n * (crit ? 2 : 1); i++) faces.push(rng.int(1, dice.d));
  const plus = dice.plus + more;
  const shown = mods.filter((m) => m.n !== 0);
  return { d: dice.d, faces, plus, total: Math.max(0, faces.reduce((n, f) => n + f, 0) + plus), ...(crit ? { crit: true } : {}), ...(shown.length > 0 ? { mods: shown } : {}) };
}

/** Advantage and disadvantage cancel: any of each leaves a plain roll. */
export const netAdvantage = (advantage: boolean, disadvantage: boolean): -1 | 0 | 1 => (advantage === disadvantage ? 0 : advantage ? 1 : -1);

/**
 * One d20 against a number to reach. A natural 20 always makes it and a natural 1 never does, on attacks;
 * saves and shoves just add up.
 */
export function d20(rng: Rng, opts: Pick<Roll, "kind" | "id" | "target" | "label" | "bonus" | "vs" | "adv" | "mods" | "vsMods" | "advWhy" | "cancelled">): Roll {
  const dice = opts.adv === 0 ? [rng.int(1, 20)] : [rng.int(1, 20), rng.int(1, 20)];
  const kept = opts.adv === 1 ? Math.max(...dice) : opts.adv === -1 ? Math.min(...dice) : dice[0];
  const total = kept + opts.bonus;
  const crit = opts.kind === "attack" && kept === 20;
  return { ...opts, d20: dice, kept, total, ok: reaches(opts.kind, kept, total, opts.vs), crit };
}

/** Whether a d20 that showed `kept` and came to `total` makes it against `vs`: on an attack a 20 always does and a 1 never. */
const reaches = (kind: Roll["kind"], kept: number, total: number, vs: number): boolean =>
  kind === "attack" && kept === 20 ? true : kind === "attack" && kept === 1 ? false : total >= vs;

/** Something that made the difference to a roll (swingsOf). */
export interface Swing {
  /** Short names of what did it: the RollMods' names, or for advantage its reasons (Roll `advWhy`, maybe none). */
  names: string[];
  /** It went the roller's way: what did it helped them make the roll. False: it cost them the roll. */
  helped: boolean;
  /** No one of `names` would have turned it alone, but all of them together did. */
  between?: boolean;
  /** It was advantage or disadvantage: the die it dropped would have turned it. */
  adv?: boolean;
  /**
   * What it turned was a critical hit: advantage kept a 20 over a die that was not one (`helped`), or disadvantage
   * dropped a 20 (not), whether or not the blow would have landed all the same.
   */
  crit?: boolean;
}

/**
 * What made the difference to a roll: what of the moment (Roll `mods`, `vsMods`, `adv`) the roll would have come out
 * the other way without.
 *
 * Only what pushed the way it came out counts: on a roll made, what helped (its bonuses, and what lowered the number to
 * reach); on one missed, what hurt. Each is first taken away alone, and any that turns it on its own is named. Should
 * none, they are taken away all at once, and if that turns it they are named together (`between`): a 10 + 2 + 1
 * against 11 was made by the two between them, neither alone. Advantage or disadvantage made the difference if the die
 * it dropped would have, or if it was the difference between a critical hit and none (`crit`): that one can go the
 * other way from the rest, disadvantage costing a critical on a blow a bonus landed. Nothing for initiative, nor for a roll whose outcome was not its sum's (a Ghostsail Cloak's).
 */
export function swingsOf(roll: Roll): Swing[] {
  if (roll.kind === "initiative" || reaches(roll.kind, roll.kept, roll.total, roll.vs) !== roll.ok) return [];
  const turns = (kept: number, total: number, vs: number) => reaches(roll.kind, kept, total, vs) !== roll.ok;
  const out: Swing[] = [];
  // The numbers: each that pushed the way it went, as what taking it away would do to the total and to what was reached for.
  const way = roll.ok ? 1 : -1;
  const parts = [
    ...(roll.mods ?? []).filter((m) => m.n * way > 0).map((m) => ({ name: m.name, total: -m.n, vs: 0 })),
    ...(roll.vsMods ?? []).filter((m) => m.n * way < 0).map((m) => ({ name: m.name, total: 0, vs: -m.n })),
  ];
  const alone = parts.filter((p) => turns(roll.kept, roll.total + p.total, roll.vs + p.vs));
  if (alone.length > 0) out.push({ names: alone.map((p) => p.name), helped: roll.ok });
  else if (parts.length > 1 && turns(roll.kept, roll.total + parts.reduce((n, p) => n + p.total, 0), roll.vs + parts.reduce((n, p) => n + p.vs, 0))) {
    out.push({ names: parts.map((p) => p.name), helped: roll.ok, between: true });
  }
  // Advantage or disadvantage: the other die, had it been the one kept.
  if (roll.adv !== 0 && roll.d20.length === 2) {
    const other = roll.adv === 1 ? Math.min(...roll.d20) : Math.max(...roll.d20);
    const turned = turns(other, roll.total - roll.kept + other, roll.vs);
    // To hit, a 20 is a critical hit: one kept over a die that was not, or one dropped, turned that, if nothing else.
    const crit = roll.kind === "attack" && (other === 20) !== (roll.kept === 20);
    if (turned || crit) out.push({ names: roll.advWhy ?? [], helped: turned ? roll.ok : roll.kept === 20, adv: true, ...(crit ? { crit: true } : {}) });
  }
  return out;
}

/** The chance, 0 to 1, that an attack with this bonus reaches this Defence. For the tooltip, and for the enemy weighing its moves. */
export function hitChance(bonus: number, vs: number, adv: -1 | 0 | 1): number {
  // Faces that hit: a 20 always, a 1 never, the rest by the sum.
  let faces = 0;
  for (let face = 1; face <= 20; face++) if (face === 20 || (face !== 1 && face + bonus >= vs)) faces++;
  const p = faces / 20;
  return adv === 1 ? 1 - (1 - p) ** 2 : adv === -1 ? p ** 2 : p;
}
