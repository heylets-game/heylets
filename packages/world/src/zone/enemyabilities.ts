// What an enemy can do in a fight: its abilities, a pool of their own, apart from the heroes' (content.ts
// ABILITIES). An enemy kind starts with a list of them (content.ts ENEMIES `abilities`), and each enemy carries its
// own copy (`Unit.abilities`), so one enemy can be given more, or fewer, than the rest of its kind.
//
// An ability's numbers are its own: how hard it hits and its potency at level 1, how its numbers grow with level
// (`scales`), before the edge every enemy has (kit.ts ENEMY_EDGE) and the map's modifiers are added (kit.ts
// enemyStrikes). Nothing about it is tied to a kind, so any enemy can be given any of them.

import type { Inflict } from "../content";
import type { ScaleRate } from "./rules";
import type { SurfaceKind } from "./types";

/**
 * How each of an ability's numbers grows with its user's level, by name (rules.ts SCALE_RATES: a share more for
 * every level past the first). A number not named grows at rules.ts DEFAULT_SCALE.
 */
export interface AbilityScales {
  damage?: ScaleRate;
}

export interface EnemyAbilityDef {
  id: string;
  /** What it is called in the fight's log and on the enemy's card. */
  name: string;
  /** How hard it hits at level 1, before edge: grown by `scales.damage`, then turned into dice (rules.ts diceFor). 0: it does no harm (a shove). */
  damage: number;
  /**
   * How sure and how strong it is, before level and edge: added to its roll to hit, and what saves against what it
   * leaves are made against (8 + it, combat.ts enemyAct).
   */
  potency: number;
  /** `single`: one hero, in reach (`range`). `burst`: every hero round the enemy (ENEMY_BURST), each saving for half. */
  shape?: "single" | "burst";
  /** Hexes it reaches: 1 (the default) is a blow by hand; more is a shot, and needs a clear line. */
  range?: number;
  /**
   * A leap: `range` is how far it springs, not a shot. A hero beyond arm's reach (but in range, and in sight) it
   * leaps at, landing on an open hex beside them, and then it strikes as a blow by hand (combat.ts lungeLanding).
   */
  leap?: boolean;
  /** Action Points it takes: ACTION_AP (kit.ts) when not said. */
  cost?: number;
  /** Its user's turns it is not ready for after it is used, as a hero's cooldowns are (kit.ts Tactic). None: every turn. */
  cooldown?: number;
  /** Left on a hero it gets through to, unless they save (a burst: on one who fails to brace). */
  saveOr?: Inflict;
  /** Left under the target when it lands. */
  surface?: { kind: SurfaceKind; rounds: number };
  /** Knocks the target back a hex when it lands. */
  push?: boolean;
  /**
   * When it lands, its shock pulses out: every other hero beside the target takes half the blow too (SPLASH_SHARE),
   * or a quarter if they save (Agility).
   */
  splash?: boolean;
  /**
   * Thrown at the target's hex, it lands on this many hexes together round it (weather.ts clusterHexes), not on the
   * target alone: no roll to hit, but everyone on them makes an Agility save, taking half on a success and suffering
   * `saveOr` on a failure. Its `surface` is left on all of them.
   */
  area?: number;
  /** Freezes water under the target. */
  chills?: boolean;
  /**
   * How an enemy weighs up using it (behaviours.ts): `strike` for one target, `burst` for everyone round, `shove` for
   * one beside it with a drop or a pit at their back. When not said, it follows the shape.
   */
  behaviour?: string;
  /** How much its user favours it, beside its other abilities: a multiplier on what it is worth (ai.ts bestAttack). */
  weight: number;
  /** How its numbers grow with level. */
  scales?: AbilityScales;
}

export const ENEMY_ABILITIES: Record<string, EnemyAbilityDef> = {
  // An attack that does no harm: on a hit, the hero beside it goes a hex back, over a drop or into a pit if that is
  // what is behind them (they roll to catch the edge). It is only worth it to an enemy where there is an edge. Once a turn.
  shove: { id: "shove", name: "Shove", damage: 0, potency: 3, push: true, cost: 1, cooldown: 1, behaviour: "shove", weight: 1 },
  wobble: { id: "wobble", name: "Wobble", damage: 1, potency: 0, weight: 1 },
  slash: { id: "slash", name: "Slash", damage: 6, potency: 3, weight: 1 },
  cheap_shot: { id: "cheap_shot", name: "Cheap Shot", damage: 6, potency: 3, saveOr: { effect: "bleeding" }, cooldown: 3, weight: 2 },
  wolf_bite: { id: "wolf_bite", name: "Bite", damage: 5, potency: 3, weight: 1 },
  // A dire wolf's opener: it throws its whole weight at one hero, jaws first, to bring them down. It springs again
  // once it has its breath back, and bites in between. It springs from up to 3 hexes off, landing beside its target.
  wolf_lunge: { id: "wolf_lunge", name: "Lunge", damage: 5, potency: 3, range: 3, leap: true, saveOr: { effect: "prone", turns: 1 }, cooldown: 2, weight: 2 },
  mauling_swipe: { id: "mauling_swipe", name: "Rending Swipe", damage: 12, potency: 4, saveOr: { effect: "bleeding" }, weight: 1 },
  // A cave bear's favourite: it rears and comes down with its whole weight. Slow to wind up (most of its turn), but
  // whoever it lands on is left reeling, with less to do on their next turn.
  bear_maul: { id: "bear_maul", name: "Maul", damage: 12, potency: 4, saveOr: { effect: "reeling", turns: 1 }, cost: 3, cooldown: 3, weight: 2 },
  roar: { id: "roar", name: "Roar", damage: 4, potency: 3, saveOr: { effect: "stunned", turns: 1 }, weight: 1 },
  // An ogre's everyday blow: the club comes down on one hero so hard that whoever stands beside them is battered too.
  club_smash: { id: "club_smash", name: "Club Smash", damage: 13, potency: 3, splash: true, weight: 1 },
  // An ogre's favourite: it stamps the ground and the whole crew round it is thrown about and left slow on their feet.
  // It needs a few turns to gather itself for another.
  slam: { id: "slam", name: "Slam", damage: 10, potency: 3, shape: "burst", saveOr: { effect: "slowed", turns: 2 }, cooldown: 4, weight: 2 },
  rake: { id: "rake", name: "Rake", damage: 7, potency: 4, saveOr: { effect: "bleeding" }, weight: 2 },
  hurl_rock: { id: "hurl_rock", name: "Hurl Rock", damage: 6, potency: 3, range: 5, saveOr: { effect: "stunned", turns: 1 }, weight: 1 },
  dark_bolt: { id: "dark_bolt", name: "Dark Bolt", damage: 7, potency: 4, range: 5, weight: 2 },
  immolate: { id: "immolate", name: "Immolate", damage: 7, potency: 2, range: 5, area: 4, saveOr: { effect: "burning" }, surface: { kind: "fire", rounds: 2 }, cooldown: 3, weight: 2 },
  maul: { id: "maul", name: "Maul", damage: 11, potency: 3, saveOr: { effect: "stunned", turns: 1 }, weight: 2 },
  brute_shove: { id: "brute_shove", name: "Shove", damage: 6, potency: 4, push: true, weight: 1 },
  volley: { id: "volley", name: "Volley", damage: 6, potency: 4, range: 6, weight: 2 },
  barbed_arrow: { id: "barbed_arrow", name: "Barbed Arrow", damage: 5, potency: 3, range: 6, saveOr: { effect: "bleeding" }, weight: 2 },
  savage_bite: { id: "savage_bite", name: "Savage Bite", damage: 9, potency: 5, saveOr: { effect: "bleeding" }, weight: 2 },
  pounce: { id: "pounce", name: "Pounce", damage: 8, potency: 4, saveOr: { effect: "stunned", turns: 1 }, weight: 2 },
  rending_howl: { id: "rending_howl", name: "Rending Howl", damage: 5, potency: 3, shape: "burst", weight: 1 },
  crushing_maul: { id: "crushing_maul", name: "Crushing Maul", damage: 13, potency: 5, saveOr: { effect: "bleeding" }, weight: 2 },
  thunderous_roar: { id: "thunderous_roar", name: "Thunderous Roar", damage: 5, potency: 3, shape: "burst", saveOr: { effect: "stunned", turns: 1 }, weight: 2 },
  stone_fist: { id: "stone_fist", name: "Stone Fist", damage: 12, potency: 5, saveOr: { effect: "stunned", turns: 1 }, weight: 2 },
  quake: { id: "quake", name: "Quake", damage: 6, potency: 3, shape: "burst", weight: 2 },
  chill_touch: { id: "chill_touch", name: "Chill Touch", damage: 5, potency: 3, saveOr: { effect: "slowed", turns: 2 }, chills: true, weight: 2 },
  wail: { id: "wail", name: "Wail", damage: 3, potency: 3, shape: "burst", weight: 1 },
  bat_bite: { id: "bat_bite", name: "Bite", damage: 4, potency: 4, saveOr: { effect: "bleeding" }, weight: 2 },
  screech: { id: "screech", name: "Screech", damage: 2, potency: 3, shape: "burst", weight: 1 },
  rusted_cutlass: { id: "rusted_cutlass", name: "Rusted Cutlass", damage: 7, potency: 4, weight: 2 },
  bone_rattle: { id: "bone_rattle", name: "Bone Rattle", damage: 4, potency: 3, saveOr: { effect: "stunned", turns: 1 }, weight: 1 },
  engulf: { id: "engulf", name: "Engulf", damage: 6, potency: 3, saveOr: { effect: "slowed", turns: 2 }, weight: 2 },
  // Acid eats into whoever it hits and is spent: it leaves no pool behind (that is poison's way).
  acid_splash: { id: "acid_splash", name: "Acid Splash", damage: 4, potency: 3, range: 3, saveOr: { effect: "exposed", turns: 2 }, weight: 2 },
  grave_grasp: { id: "grave_grasp", name: "Grave Grasp", damage: 9, potency: 5, saveOr: { effect: "stunned", turns: 1 }, weight: 2 },
  keening: { id: "keening", name: "Keening", damage: 5, potency: 3, shape: "burst", saveOr: { effect: "slowed", turns: 2 }, weight: 2 },
  venomous_bite: { id: "venomous_bite", name: "Venomous Bite", damage: 5, potency: 4, surface: { kind: "poison", rounds: 2 }, weight: 2 },
  spider_web_spit: { id: "spider_web_spit", name: "Web Spit", damage: 3, potency: 3, range: 4, saveOr: { effect: "slowed", turns: 2 }, surface: { kind: "slime", rounds: 2 }, weight: 2 },
  impaling_fang: { id: "impaling_fang", name: "Impaling Fang", damage: 11, potency: 5, saveOr: { effect: "bleeding" }, weight: 2 },
  brood_web_spit: { id: "brood_web_spit", name: "Web Spit", damage: 5, potency: 4, range: 5, saveOr: { effect: "slowed", turns: 2 }, surface: { kind: "slime", rounds: 2 }, weight: 2 },
  brood_swarm: { id: "brood_swarm", name: "Brood Swarm", damage: 5, potency: 3, shape: "burst", saveOr: { effect: "slowed", turns: 1 }, weight: 1 },
  rime_bite: { id: "rime_bite", name: "Rime Bite", damage: 5, potency: 5, saveOr: { effect: "slowed", turns: 2 }, chills: true, weight: 1 },
  searing_bite: { id: "searing_bite", name: "Searing Bite", damage: 5, potency: 5, saveOr: { effect: "burning" }, weight: 1 },
  frost_lance: { id: "frost_lance", name: "Frost Lance", damage: 6, potency: 4, range: 5, saveOr: { effect: "slowed", turns: 2 }, chills: true, weight: 2 },
  thorn_hex: { id: "thorn_hex", name: "Thorn Hex", damage: 6, potency: 4, range: 5, saveOr: { effect: "bleeding" }, weight: 2 },
  evil_eye: { id: "evil_eye", name: "Evil Eye", damage: 4, potency: 3, range: 5, saveOr: { effect: "exposed", turns: 2 }, weight: 2 },
  crushing_strike: { id: "crushing_strike", name: "Crushing Strike", damage: 9, potency: 5, saveOr: { effect: "stunned", turns: 1 }, weight: 2 },
  sweeping_ruin: { id: "sweeping_ruin", name: "Sweeping Ruin", damage: 6, potency: 3, shape: "burst", weight: 2 },
};
