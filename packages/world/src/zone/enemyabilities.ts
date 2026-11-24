// What an enemy can do in a fight: its abilities, a pool of their own, apart from the heroes' (content.ts
// ABILITIES). An enemy kind starts with a list of them (content.ts ENEMIES `abilities`), and each enemy carries its
// own copy (`Unit.abilities`), so one enemy can be given more, or fewer, than the rest of its kind.
//
// An ability's numbers are its own: how hard it hits and how sure it is, before the enemy's level, the edge every
// enemy has (kit.ts ENEMY_EDGE) and the map's modifiers are added (kit.ts enemyStrikes). Nothing about it is tied to a kind, so any enemy can be given any of them.

import type { EffectKind } from "../content";
import type { SurfaceKind } from "./types";

export interface EnemyAbilityDef {
  id: string;
  /** What it is called in the fight's log and on the enemy's card. */
  name: string;
  /** How hard it hits, before level and edge: turned into dice (rules.ts diceFor). */
  damage: number;
  /** Added to its roll to hit, before level and edge. */
  toHit: number;
  /** `single`: one hero, in reach (`range`). `burst`: every hero round the enemy (ENEMY_BURST), each saving for half. */
  shape?: "single" | "burst";
  /** Hexes it reaches: 1 (the default) is a blow by hand; more is a shot, and needs a clear line. */
  range?: number;
  /** Action Points it takes: ACTION_AP (kit.ts) when not said. */
  cost?: number;
  /** Its user's turns it is not ready for after it is used, as a hero's cooldowns are (kit.ts Tactic). None: every turn. */
  cooldown?: number;
  /** Left on a hero it gets through to, unless they save (a burst: on one who fails to brace). */
  perfect?: { effect: EffectKind; turns: number };
  /** Left under the target when it lands. */
  surface?: { kind: SurfaceKind; rounds: number };
  /** Knocks the target back a hex when it lands. */
  push?: boolean;
  /** Freezes water under the target. */
  chills?: boolean;
  /**
   * How an enemy weighs up using it (behaviours.ts): `strike` for one target, `burst` for everyone round. When not
   * said, it follows the shape.
   */
  behaviour?: string;
  /** How much its user favours it, beside its other abilities: the favourite wins a close call. */
  weight: number;
}

export const ENEMY_ABILITIES: Record<string, EnemyAbilityDef> = {
  wobble: { id: "wobble", name: "Wobble", damage: 1, toHit: 0, weight: 1 },
  slash: { id: "slash", name: "Slash", damage: 6, toHit: 3, weight: 3 },
  cheap_shot: { id: "cheap_shot", name: "Cheap Shot", damage: 5, toHit: 3, perfect: { effect: "bleeding", turns: 2 }, weight: 1 },
  wolf_bite: { id: "wolf_bite", name: "Bite", damage: 5, toHit: 5, perfect: { effect: "bleeding", turns: 2 }, weight: 1 },
  mauling_swipe: { id: "mauling_swipe", name: "Mauling Swipe", damage: 12, toHit: 4, perfect: { effect: "bleeding", turns: 2 }, weight: 3 },
  roar: { id: "roar", name: "Roar", damage: 4, toHit: 3, perfect: { effect: "stunned", turns: 1 }, weight: 1 },
  club_smash: { id: "club_smash", name: "Club Smash", damage: 13, toHit: 3, perfect: { effect: "stunned", turns: 1 }, weight: 3 },
  stomp: { id: "stomp", name: "Stomp", damage: 4, toHit: 3, shape: "burst", perfect: { effect: "slowed", turns: 2 }, weight: 1 },
  rake: { id: "rake", name: "Rake", damage: 7, toHit: 4, perfect: { effect: "bleeding", turns: 2 }, weight: 3 },
  hurl_rock: { id: "hurl_rock", name: "Hurl Rock", damage: 6, toHit: 3, range: 5, perfect: { effect: "stunned", turns: 1 }, weight: 1 },
  dark_bolt: { id: "dark_bolt", name: "Dark Bolt", damage: 7, toHit: 4, range: 5, weight: 3 },
  immolate: { id: "immolate", name: "Immolate", damage: 4, toHit: 2, range: 5, perfect: { effect: "burning", turns: 2 }, surface: { kind: "fire", rounds: 2 }, weight: 1 },
  maul: { id: "maul", name: "Maul", damage: 11, toHit: 3, perfect: { effect: "stunned", turns: 1 }, weight: 3 },
  brute_shove: { id: "brute_shove", name: "Shove", damage: 6, toHit: 4, push: true, weight: 1 },
  volley: { id: "volley", name: "Volley", damage: 6, toHit: 4, range: 7, weight: 3 },
  barbed_arrow: { id: "barbed_arrow", name: "Barbed Arrow", damage: 5, toHit: 3, range: 7, perfect: { effect: "bleeding", turns: 3 }, weight: 2 },
  savage_bite: { id: "savage_bite", name: "Savage Bite", damage: 9, toHit: 5, perfect: { effect: "bleeding", turns: 3 }, weight: 3 },
  pounce: { id: "pounce", name: "Pounce", damage: 8, toHit: 4, perfect: { effect: "stunned", turns: 1 }, weight: 2 },
  rending_howl: { id: "rending_howl", name: "Rending Howl", damage: 5, toHit: 3, shape: "burst", weight: 1 },
  crushing_maul: { id: "crushing_maul", name: "Crushing Maul", damage: 13, toHit: 5, perfect: { effect: "bleeding", turns: 3 }, weight: 3 },
  thunderous_roar: { id: "thunderous_roar", name: "Thunderous Roar", damage: 5, toHit: 3, shape: "burst", perfect: { effect: "stunned", turns: 1 }, weight: 2 },
  stone_fist: { id: "stone_fist", name: "Stone Fist", damage: 12, toHit: 5, perfect: { effect: "stunned", turns: 1 }, weight: 3 },
  quake: { id: "quake", name: "Quake", damage: 6, toHit: 3, shape: "burst", weight: 2 },
  chill_touch: { id: "chill_touch", name: "Chill Touch", damage: 5, toHit: 3, perfect: { effect: "slowed", turns: 2 }, chills: true, weight: 3 },
  wail: { id: "wail", name: "Wail", damage: 3, toHit: 3, shape: "burst", weight: 1 },
  bat_bite: { id: "bat_bite", name: "Bite", damage: 4, toHit: 4, perfect: { effect: "bleeding", turns: 2 }, weight: 3 },
  screech: { id: "screech", name: "Screech", damage: 2, toHit: 3, shape: "burst", weight: 1 },
  rusted_cutlass: { id: "rusted_cutlass", name: "Rusted Cutlass", damage: 7, toHit: 4, weight: 3 },
  bone_rattle: { id: "bone_rattle", name: "Bone Rattle", damage: 4, toHit: 3, perfect: { effect: "stunned", turns: 1 }, weight: 1 },
  engulf: { id: "engulf", name: "Engulf", damage: 6, toHit: 3, perfect: { effect: "slowed", turns: 2 }, weight: 3 },
  // Acid eats into whoever it hits and is spent: it leaves no pool behind (that is poison's way).
  acid_splash: { id: "acid_splash", name: "Acid Splash", damage: 4, toHit: 3, range: 3, perfect: { effect: "exposed", turns: 2 }, weight: 2 },
  grave_grasp: { id: "grave_grasp", name: "Grave Grasp", damage: 9, toHit: 5, perfect: { effect: "stunned", turns: 1 }, weight: 3 },
  keening: { id: "keening", name: "Keening", damage: 5, toHit: 3, shape: "burst", perfect: { effect: "slowed", turns: 2 }, weight: 2 },
  venomous_bite: { id: "venomous_bite", name: "Venomous Bite", damage: 5, toHit: 4, surface: { kind: "poison", rounds: 2 }, weight: 3 },
  spider_web_spit: { id: "spider_web_spit", name: "Web Spit", damage: 3, toHit: 3, range: 4, perfect: { effect: "slowed", turns: 2 }, surface: { kind: "slime", rounds: 2 }, weight: 2 },
  impaling_fang: { id: "impaling_fang", name: "Impaling Fang", damage: 11, toHit: 5, perfect: { effect: "bleeding", turns: 3 }, weight: 3 },
  brood_web_spit: { id: "brood_web_spit", name: "Web Spit", damage: 5, toHit: 4, range: 5, perfect: { effect: "slowed", turns: 2 }, surface: { kind: "slime", rounds: 2 }, weight: 2 },
  brood_swarm: { id: "brood_swarm", name: "Brood Swarm", damage: 5, toHit: 3, shape: "burst", perfect: { effect: "slowed", turns: 1 }, weight: 1 },
  rime_bite: { id: "rime_bite", name: "Rime Bite", damage: 5, toHit: 5, perfect: { effect: "slowed", turns: 2 }, chills: true, weight: 1 },
  searing_bite: { id: "searing_bite", name: "Searing Bite", damage: 5, toHit: 5, perfect: { effect: "burning", turns: 2 }, weight: 1 },
  frost_lance: { id: "frost_lance", name: "Frost Lance", damage: 6, toHit: 4, range: 5, perfect: { effect: "slowed", turns: 2 }, chills: true, weight: 3 },
  thorn_hex: { id: "thorn_hex", name: "Thorn Hex", damage: 6, toHit: 4, range: 5, perfect: { effect: "bleeding", turns: 2 }, weight: 3 },
  evil_eye: { id: "evil_eye", name: "Evil Eye", damage: 4, toHit: 3, range: 5, perfect: { effect: "exposed", turns: 2 }, weight: 2 },
  crushing_strike: { id: "crushing_strike", name: "Crushing Strike", damage: 9, toHit: 5, perfect: { effect: "stunned", turns: 1 }, weight: 3 },
  sweeping_ruin: { id: "sweeping_ruin", name: "Sweeping Ruin", damage: 6, toHit: 3, shape: "burst", weight: 2 },
};
