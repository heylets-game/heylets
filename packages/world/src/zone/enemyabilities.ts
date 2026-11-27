// What an enemy can do in a fight: its abilities, a pool of their own, apart from the heroes' (content.ts
// ABILITIES). An enemy kind starts with a list of them (content.ts ENEMIES `abilities`), and each enemy carries its
// own copy (`Unit.abilities`), so one enemy can be given more, or fewer, than the rest of its kind.
//
// An ability's numbers are its own: how hard it hits and its potency at level 1, how its numbers grow with level
// (`scales`), before the edge every enemy has (kit.ts ENEMY_EDGE) and the map's modifiers are added (kit.ts
// enemyStrikes). Nothing about it is tied to a kind, so any enemy can be given any of them.

import type { Inflict } from "../content";
import type { ScaleRate } from "./rules";
import type { Drain } from "./unless";
import type { FieldKind, SurfaceKind } from "./types";

/**
 * How each of an ability's numbers grows with its user's level, by name (rules.ts SCALE_RATES: a share more for
 * every level past the first). A number not named grows at rules.ts DEFAULT_SCALE.
 */
export interface AbilityScales {
  damage?: ScaleRate;
  heal?: ScaleRate;
}

/**
 * A call for more of its side (EnemyAbilityDef `summon`): how many of what kind, the most it has out at once (none: no
 * limit), and how many of that kind may already stand on a hex it calls one onto (none: it must be empty), so long as
 * there is room on it (geometry.ts HEX_ROOM). Empty hexes are used first.
 */
export interface KinCall {
  kind: string;
  count: number;
  most?: number;
  share?: number;
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
  /**
   * `single`: one hero, in reach (`range`). `burst`: every hero round the enemy, within `range` (ENEMY_BURST when not
   * said), each saving for half; one that does no harm (`damage` 0) has them save against its `saveOr` instead.
   */
  shape?: "single" | "burst";
  /** Hexes it reaches: 1 (the default) is a blow by hand; more is a shot, and needs a clear line. For a burst, how far round it reaches. */
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
  /**
   * Aimed at one hero but never rolled to hit (a Haunt's Ghastly Fetter): they save against `saveOr` (with the stat
   * that shrugs it off; Agility if it leaves nothing), taking half and none of it on a success, and all of it with
   * `saveOr` (and any `tether`) on a failure.
   */
  saves?: boolean;
  /** Left on a hero it gets through to who does save against `saveOr`: a lesser share of it (Savage Bite). */
  onSave?: Inflict;
  /**
   * A call to its own side, not an attack on the other (a Pack Leader's Howl): every ally of its user in the fight (not
   * itself) within `range` hexes of it is Frenzied for this many attacks. It does no harm, and is aimed at nobody.
   */
  rally?: { attacks: number };
  /**
   * A field round its user, not an attack (a Guardian's Slowing Field, a Snow Bear's Blizzard Aura): for `rounds` of its
   * turns it carries the condition `kind`, and every one of the other side within `radius` hexes of it (of any of its
   * hexes, for a big one) is caught by it as their turn starts there or as they step in (combat.ts fieldsCatch). It goes
   * with its user, and is aimed at nobody. One that `slows` leaves them Slowed for that turn. One that does harm (its
   * `damage`, its `saveOr`) deals it to each, no roll to hit, once in each of their turns: its damage, then a save
   * against its `saveOr`.
   */
  field?: { rounds: number; radius: number; kind: FieldKind; slows?: boolean };
  /**
   * Thrown at a hex up to `range` off, it lands on every hex within this many of it (2: that hex and the two rings round
   * it), as `area` does on its clump: everyone there saves for half, and its `surface` is left on all of it. One that
   * does no harm only leaves its surface (and its `saveOr`, saved against).
   */
  blast?: number;
  /**
   * Calls more of its own side into the fight (a Broodmother's Brood Swarm): `count` enemies of `kind`, each on an open
   * hex beside it (summon.ts callKin), never so many that it has more than `most` of them it called standing at once.
   * It does no harm, and is aimed at nobody.
   */
  summon?: KinCall;
  /**
   * A mending for its own side, not an attack (a Hedge Witch's Witches' Brew): HP at level 1 (grown by `scales.heal`,
   * then turned into dice), healed to every one of its side in the fight, itself as well, standing on the hexes it
   * lands on. Thrown at a hex up to `range` off, it lands on the hexes its `area` or `blast` covers round it (neither:
   * that hex alone). It needs a clear line, as a shot does, and does no harm (`damage` 0). Weighed up by behaviour `mend`.
   */
  heal?: number;
  /** Left under the target when it lands. */
  surface?: { kind: SurfaceKind; rounds: number };
  /** Knocks the target back when it lands: `true` for a hex, or a number of hexes (it stops early at anything in the way). */
  push?: boolean | number;
  /**
   * When it lands, its shock pulses out: every other hero beside the target takes half the blow too (SPLASH_SHARE),
   * or a quarter if they save (Agility).
   */
  splash?: boolean;
  /**
   * Thrown at the target's hex, it lands on this many hexes together round it (weather.ts clusterHexes), not on the
   * target alone (7: that hex and the whole ring round it): no roll to hit, but everyone on them makes an Agility save, taking half on a success and suffering
   * `saveOr` on a failure. Its `surface` is left on all of them.
   */
  area?: number;
  /**
   * A wide swing at the hero beside it that carries on through this many rows of three hexes, each an arc one hex
   * further out (combat.ts sweepHexes): no roll to hit, but everyone in them makes an Agility save, taking half on
   * a success and suffering `saveOr` on a failure.
   */
  sweep?: number;
  /**
   * A cone this many rows long, reaching out from its user toward the hex it is aimed at (combat.ts coneHexes: one hex,
   * then two beyond it, then three): no roll to hit, but everyone in it makes an Agility save, taking half on a success
   * and suffering `saveOr` on a failure.
   */
  cone?: number;
  /**
   * A straight line this many hexes long, from its user toward the hex it is aimed at (geometry.ts lineFrom: it stops at
   * rock and the map's edge, and goes on through whoever is on it): no roll to hit, but everyone on it makes an Agility
   * save, taking half on a success and suffering `saveOr` on a failure.
   */
  line?: number;
  /**
   * Not something it does but something it is (a Haunt's Terror Aura): every one of the other side within `radius` hexes
   * of it, while it stands in a fight, makes every save with disadvantage (engine.ts saveRoll). It is never used, takes no
   * turn and no AP, and nothing else of the ability counts.
   */
  aura?: { radius: number; saves: "disadvantage" };
  /**
   * Fetters whoever fails to save against it (a Haunt's Ghastly Fetter): for `turns` of their turns they cannot go further
   * than `reach` hexes, by their own doing, from where they stood when it first took hold of them (geometry.ts
   * fetterBars). Fettered again while it holds, it is chained where it stands now, and it lasts the longer.
   */
  tether?: { reach: number; turns: number };
  /**
   * A dash: its user throws itself straight at the hex it is aimed at, up to `range` hexes (combat.ts dashWay), on
   * through whoever is in the way, and comes to rest on the furthest hex of that line it can stand on. Nobody is
   * singled out, so there is no roll to hit: every one of the other side it passes through makes an Agility save,
   * taking half and nothing of `saveOr` on a success. It is too quick to draw blows from whoever it leaves the reach of.
   */
  dash?: boolean;
  /**
   * Laid on the ground round its user: every hex within ENEMY_BURST of where it stands (not rock) shakes now, for
   * `damage`, and is left cracked (weather.ts, a `quake`). As its user's next turn begins, the same hexes heave again
   * for this `damage`, leaving `saveOr` on a failure. Whoever is on them each time (not flying) makes an Agility save
   * for half. Its user's own sight does not come into it: the ground shakes behind cover as much as before it.
   */
  aftershock?: { damage: number; saveOr?: Inflict };
  /** Freezes water under the target. */
  chills?: boolean;
  /** When it lands, its user heals a share of the damage it dealt (a troll's Chomp), unless something stops it (unless.ts). */
  drain?: Drain;
  /**
   * How an enemy weighs up using it (behaviours.ts): `strike` for one target, `burst` for everyone round, `shove` for
   * one beside it with a drop or a pit at their back, `rally` for a call to its own side, `summon` for calling more of it, `mend` for healing its own side. When not said, it follows the shape.
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
  bear_maul: { id: "bear_maul", name: "Maul", damage: 12, potency: 4, saveOr: { effect: "reeling", turns: 1, amount: 2 }, cost: 3, cooldown: 3, weight: 2 },
  // A Snow Bear's blizzard: for three of its turns a storm of snow whirls round it, a hex deep. Whoever starts a turn in
  // it, or first steps into it in a turn, is cut by the ice in it, and must save or be left reeling (an AP short).
  blizzard_aura: { id: "blizzard_aura", name: "Blizzard Aura", damage: 2, potency: 3, field: { rounds: 3, radius: 1, kind: "blizzard_aura" }, saveOr: { effect: "reeling", turns: 1, amount: 1 }, cooldown: 4, behaviour: "field", weight: 2 },
  // An ogre's everyday blow: the club comes down on one hero so hard that whoever stands beside them is battered too.
  club_smash: { id: "club_smash", name: "Club Smash", damage: 13, potency: 3, splash: true, weight: 1 },
  // An ogre's favourite: it stamps the ground and the whole crew round it is thrown about and left slow on their feet.
  // It needs a few turns to gather itself for another.
  slam: { id: "slam", name: "Slam", damage: 10, potency: 3, shape: "burst", saveOr: { effect: "slowed", turns: 2 }, cooldown: 4, weight: 2 },
  rake: { id: "rake", name: "Rake", damage: 7, potency: 4, saveOr: { effect: "bleeding" }, weight: 1 },
  // A troll's throw at whoever keeps away: a rock heavy enough to leave them reeling. It has to find another first.
  hurl_rock: { id: "hurl_rock", name: "Hurl Rock", damage: 6, potency: 3, range: 5, saveOr: { effect: "reeling", turns: 1, amount: 2 }, cooldown: 2, weight: 1 },
  // A troll's quick bite, its teeth in whoever is beside it: what it tears off, it grows back half of.
  chomp: { id: "chomp", name: "Chomp", damage: 6, potency: 3, drain: { share: 0.5, unless: [{ has: "burning" }] }, cost: 1, cooldown: 2, weight: 1 },
  dark_bolt: { id: "dark_bolt", name: "Dark Bolt", damage: 7, potency: 4, range: 5, weight: 2 },
  immolate: { id: "immolate", name: "Immolate", damage: 7, potency: 2, range: 5, area: 4, saveOr: { effect: "burning" }, surface: { kind: "fire", rounds: 2 }, cooldown: 3, weight: 2 },
  beatdown: { id: "beatdown", name: "Beatdown", damage: 11, potency: 3, saveOr: { effect: "prone", turns: 1 }, weight: 1 },
  great_cleave: { id: "great_cleave", name: "Great Cleave", damage: 9, potency: 3, sweep: 2, cooldown: 4, weight: 2 },
  battering_ram: { id: "battering_ram", name: "Battering Ram", damage: 6, potency: 4, push: 3, cooldown: 2, weight: 2 },
  volley: { id: "volley", name: "Volley", damage: 6, potency: 4, range: 6, weight: 1 },
  // An archer's favourite: a sheaf of arrows loosed high, to come down on a hex and every hex round it. Nobody is
  // aimed at, so there is no roll to hit: everyone under it makes an Agility save for half. It takes all a turn's
  // AP, and a few turns to ready again.
  rain_of_arrows: { id: "rain_of_arrows", name: "Rain of Arrows", damage: 5, potency: 3, range: 6, area: 7, cost: 4, cooldown: 3, weight: 2 },
  // A Pack Leader's bite tears deep: two stacks of Bleeding, or one for whoever pulls clear in time.
  savage_bite: { id: "savage_bite", name: "Savage Bite", damage: 9, potency: 5, saveOr: { effect: "bleeding", stacks: 2 }, onSave: { effect: "bleeding" }, weight: 2 },
  // A Pack Leader's leap: a Dire Wolf's Lunge with more weight behind it, that leaves whoever it lands on stunned.
  great_lunge: { id: "great_lunge", name: "Great Lunge", damage: 8, potency: 4, range: 3, leap: true, saveOr: { effect: "stunned", turns: 1 }, cooldown: 2, weight: 2 },
  // A Pack Leader's favourite, quick to give: it howls its pack on. Every ally within 3 hexes is Frenzied for two attacks
  // (advantage, and each that draws blood leaves Bleeding). It does no harm itself, and has to get its wind back after.
  howl: { id: "howl", name: "Howl", damage: 0, potency: 0, range: 3, cost: 1, cooldown: 3, rally: { attacks: 2 }, behaviour: "rally", weight: 3 },
  // A Great Bear's everyday blow: one great rake of a forepaw across the three hexes in front of it. Nobody is singled
  // out, so there is no roll to hit: everyone in its path makes an Agility save, taking half and no wound on a success.
  rending_cleave: { id: "rending_cleave", name: "Rending Cleave", damage: 10, potency: 5, sweep: 1, saveOr: { effect: "bleeding" }, weight: 2 },
  // A Great Bear's roar: everyone round it is shaken, and slow to act on their next turn unless they save (and then
  // take half). It needs a few turns to get its breath back for another.
  thunderous_roar: { id: "thunderous_roar", name: "Thunderous Roar", damage: 8, potency: 3, shape: "burst", saveOr: { effect: "reeling", turns: 1, amount: 2 }, cooldown: 3, weight: 2 },
  // A guardian's fist of stone: whoever it lands on is knocked back a hex, and off their feet unless they stand firm.
  stone_fist: { id: "stone_fist", name: "Stone Fist", damage: 15, potency: 5, push: 1, saveOr: { effect: "prone", turns: 1 }, weight: 2 },
  // A guardian pounds the ground and it starts to shake all round it: small tremors now, and the ground cracking,
  // then on its next turn the whole of it heaves, throwing whoever is still on it off their feet. Most of its turn,
  // and it needs a few to gather itself for another.
  earthquake: { id: "earthquake", name: "Earthquake", damage: 7, potency: 3, shape: "burst", cost: 4, cooldown: 4, aftershock: { damage: 15, saveOr: { effect: "prone", turns: 1 } }, weight: 2 },
  // A guardian's hum: the air round it thickens, and whoever comes near wades through it, too slow to get away from
  // what it does next. It moves with it.
  slowing_field: { id: "slowing_field", name: "Slowing Field", damage: 0, potency: 0, cost: 2, cooldown: 4, field: { rounds: 3, radius: 2, kind: "slowing_field", slows: true }, behaviour: "field", weight: 2 },
  chill_touch: { id: "chill_touch", name: "Chill Touch", damage: 5, potency: 3, saveOr: { effect: "slowed", turns: 2 }, chills: true, weight: 2 },
  // A scream all round it: anyone it gets through to fumbles their next attack.
  wail: { id: "wail", name: "Wail", damage: 3, potency: 3, shape: "burst", saveOr: { effect: "fumbling", stacks: 1 }, cooldown: 3, weight: 3 },
  bat_bite: { id: "bat_bite", name: "Bite", damage: 6, potency: 4, weight: 2 },
  // A cave bat's dive: it drops on the crew and tears straight through them in a line, raking everyone it passes, and
  // comes to rest beyond. Whoever twists aside takes half and is not cut.
  fell_swoop: { id: "fell_swoop", name: "Fell Swoop", damage: 4, potency: 3, range: 4, dash: true, saveOr: { effect: "bleeding" }, cooldown: 2, weight: 3.5 },
  rusted_cutlass: { id: "rusted_cutlass", name: "Rusted Cutlass", damage: 7, potency: 4, weight: 2 },
  // A skeleton's reminder that all must die, to everyone beside it: whoever it gets to is shaken by every wound after
  // (Memento Mori, engine.ts ON_HURT). No harm of its own: those beside it save against the condition, not for half.
  memento_mori: { id: "memento_mori", name: "Memento Mori", damage: 0, potency: 3, shape: "burst", range: 1, saveOr: { effect: "memento_mori", turns: 4 }, cooldown: 4, weight: 3 },
  engulf: { id: "engulf", name: "Engulf", damage: 6, potency: 3, saveOr: { effect: "slowed", turns: 2 }, weight: 2 },
  // A slime's gob of acid, spat onto a clump of 3 hexes: it eats into the armor of whoever fails to get clear (2 less
  // Defence), and is spent: it leaves no pool behind (that is poison's way).
  acid_splash: { id: "acid_splash", name: "Acid Splash", damage: 4, potency: 3, range: 3, area: 3, saveOr: { effect: "sundered", turns: 2 }, cooldown: 3, weight: 2 },
  // A Haunt's everyday blow: an icy hand reaches out of it across the three rows in front of it and drags at everyone
  // there. Nobody is singled out: each makes an Agility save, taking half and keeping their pace on a success.
  grave_grasp: { id: "grave_grasp", name: "Grave Grasp", damage: 10, potency: 5, cone: 3, saveOr: { effect: "slowed", turns: 2 }, weight: 2 },
  // A Haunt's spear of ice, flung straight through five hexes and everyone on them, each saving for half. It has to
  // freeze another before it can throw again.
  ice_spear: { id: "ice_spear", name: "Ice Spear", damage: 13, potency: 4, line: 5, cooldown: 2, weight: 2 },
  // A Haunt's chain of grave-iron, flung at one hero from afar, with no missing them: whoever fails to shake it off is left reeling (an AP short
  // on each of their next three turns) and held within a hex of where it caught them while it holds. Quick to throw.
  ghastly_fetter: { id: "ghastly_fetter", name: "Ghastly Fetter", damage: 5, potency: 4, range: 5, cost: 1, cooldown: 3, saves: true, saveOr: { effect: "reeling", turns: 3, amount: 1 }, tether: { reach: 1, turns: 3 }, weight: 2 },
  // The dread round a Haunt: every hero within 2 hexes of it makes every save with disadvantage. Always on, never used.
  terror_aura: { id: "terror_aura", name: "Terror Aura", damage: 0, potency: 0, aura: { radius: 2, saves: "disadvantage" }, weight: 0 },
  venomous_bite: { id: "venomous_bite", name: "Venomous Bite", damage: 7, potency: 4, surface: { kind: "poison", rounds: 2 }, weight: 2 },
  spider_web_spit: { id: "spider_web_spit", name: "Web Spit", damage: 6, potency: 3, range: 4, area: 3, saveOr: { effect: "slowed", turns: 2 }, surface: { kind: "slime", rounds: 2 }, cooldown: 3, weight: 3 },
  impaling_fang: { id: "impaling_fang", name: "Impaling Fang", damage: 11, potency: 5, saveOr: { effect: "sundered", turns: 2 }, weight: 2 },
  // Silk thrown over a wide patch of ground, hurting nobody: the web it leaves slows whoever is not a spider and speeds
  // whoever is (surfaces.ts).
  spin_web: { id: "spin_web", name: "Spin Web", damage: 0, potency: 4, range: 3, blast: 2, surface: { kind: "web", rounds: 4 }, cooldown: 4, weight: 2 },
  // Its young, called out of the nest to its side.
  brood_swarm: { id: "brood_swarm", name: "Brood Swarm", damage: 0, potency: 0, cost: 1, cooldown: 2, summon: { kind: "spiderling", count: 2, most: 14, share: 1 }, weight: 2 },
  spiderling_bite: { id: "spiderling_bite", name: "Bite", damage: 5, potency: 2, weight: 1 },
  rime_bite: { id: "rime_bite", name: "Rime Bite", damage: 5, potency: 5, saveOr: { effect: "slowed", turns: 2 }, chills: true, weight: 1 },
  // A Frost Wolf's breath: a cold blast over the three rows of a cone in front of it. Nobody is singled out, so there is
  // no roll to hit: everyone in it makes an Agility save, taking half and no Slowing on a success. It needs a few turns
  // to draw the cold back up.
  frost_breath: { id: "frost_breath", name: "Frost Breath", damage: 7, potency: 4, cone: 3, saveOr: { effect: "slowed", turns: 2 }, cooldown: 3, weight: 2.5 },
  // An Ember Hound's pulse of fire round it: every hero beside it makes an Agility save, taking half on
  // a success, and the lot and a stack of Burning on a failure.
  ember_burst: { id: "ember_burst", name: "Ember Burst", damage: 7, potency: 4, shape: "burst", range: 1, saveOr: { effect: "burning" }, cooldown: 3, weight: 2 },
  searing_bite: { id: "searing_bite", name: "Searing Bite", damage: 5, potency: 5, saveOr: { effect: "burning" }, weight: 1 },
  // A Rime Wraith's everyday shot: a mote of frost sent drifting at its target from afar, slowing whoever it gets to.
  frost_mote: { id: "frost_mote", name: "Frost Mote", damage: 6, potency: 4, range: 5, saveOr: { effect: "slowed", turns: 2 }, chills: true, weight: 2 },
  // A Rime Wraith's bomb of ice, thrown onto a clump of 3 hexes: everyone there saves for half, and the ground is
  // left iced over whether they get clear or not.
  icy_bomb: { id: "icy_bomb", name: "Icy Bomb", damage: 8, potency: 4, range: 5, area: 3, surface: { kind: "ice", rounds: 3 }, cooldown: 3, weight: 2 },
  // A Hedge Witch's everyday hex, from across the clearing: whoever it lands on is the worse at shaking off whatever
  // comes next (2 less on every save) until their next turn is over, unless they shake this off first.
  weakening_hex: { id: "weakening_hex", name: "Weakening Hex", damage: 6, potency: 4, range: 5, saveOr: { effect: "weakened", turns: 1, amount: 2 }, weight: 2 },
  // A Hedge Witch's brew, flung over its own up to 5 hexes off: it splashes over a clump of 3 hexes there, and every
  // one of its side on them (itself too) is mended. It has to brew another before it can throw again.
  witches_brew: { id: "witches_brew", name: "Witches' Brew", damage: 0, potency: 0, range: 5, area: 3, heal: 6, cooldown: 3, behaviour: "mend", weight: 2 },
};
