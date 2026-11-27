// The small moves every rule is built from: a condition put on or taken
// off, damage dealt, someone healed, an attack or a save rolled. Each one
// changes the state in the context and adds what happened to its events.

import { hexDistance, posKey, type HexPos, type StatKey } from "@gantt-quest/core";
import { tileAt } from "../map";
import type { Rng } from "../rng";
import { elevOf, gap, gapTo, inFight, meet, nearOf, perkOf, span } from "./geometry";
import { ABILITIES, EFFECT_TICK, STACK_TURNS, SUNDERED_DEFENCE, WEAKENED_SAVES, isSpent, isStacking, type Inflict, type SpentEffect, type StackingEffect } from "../content";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { AQUEOUS, AURAS, CONDITION_INFO, CORAL_ARMOR, ENEMY_KIT, FORTIFY, SHIELD_SET_ASIDE, enemyDefence, enemySave, healDice } from "./kit";
import { inDark } from "./light";
import { d20, heroDefence, mod, netAdvantage, rollShown, statOf } from "./rules";
import { songDefence, songHit, windward } from "./song";
import type { Condition, Roll, Rolled, Unit, UnitCondition, ZoneEffect, ZoneEvent, ZoneState } from "./types";

export interface Ctx {
  state: ZoneState;
  rng: Rng;
  events: ZoneEvent[];
  effects: ZoneEffect[];
  /**
   * Called after each step a unit takes, by the reducer: has it walked into a fight? Returns true to
   * stop it there. `flush` writes out the steps taken so far, so what follows is told in order.
   */
  onStep?: (unit: Unit, flush: () => void) => boolean;
  /**
   * Set while an action that starts a fight, or joins one, is done (zone.ts opening): what it leaves takes hold on
   * whoever it touches, as the fight it opens begins, though nobody is in it yet (takesHold).
   */
  opening?: boolean;
}

export const has = (unit: Unit, kind: Condition): boolean => unit.conditions.some((c) => c.kind === kind);

export function removeCondition(unit: Unit, kind: Condition): void {
  unit.conditions = unit.conditions.filter((c) => c.kind !== kind);
}

/**
 * Put a condition on a unit, or lengthen the one it has. Something soaked cannot be set burning.
 * `amount`: a shield's points (Bolstered), or the AP a Reeling takes; a bigger one replaces a smaller.
 */
export function addCondition(ctx: Ctx, unit: Unit, kind: Condition, rounds: number, amount?: number, at?: HexPos): void {
  // Bleeding and Burning come in stacks that last as long as they always do, whatever asked for them.
  if (isStacking(kind)) return addStacks(ctx, unit, kind, amount ?? 1);
  if (unit.down || rounds <= 0 || !takesHold(ctx, unit, kind)) return;
  // What gear keeps off: a Storm Crown Stunning, a Stoker's Apron Burning, Sea-Legs Slops a fall, Windrunner Leggings Slowing.
  if (gearWards(unit, kind)) return;
  // A Wind-god's Shanty keeps everyone in it light on their feet.
  if (kind === "slowed" && windward(ctx.state, unit)) return;
  if (kind === "wet") removeCondition(unit, "burning");
  const enc = ctx.state.encounter;
  const mine = !!enc && enc.acting.includes(unit.id) && !enc.done.includes(unit.id);
  const held = unit.conditions.find((c) => c.kind === kind);
  if (held) held.rounds = Math.max(held.rounds, rounds);
  else {
    unit.conditions.push(mine ? { kind, rounds, fresh: true } : { kind, rounds });
    // On its own turn, what changes how far it can go is felt at once.
    const budget = mine ? enc!.budgets[unit.id] : undefined;
    // Movement goes by the AP: hastened or slowed, each AP buys more or less from here on. Knocked flat, no more this turn.
    if (budget && kind === "hasted") budget.stride *= 2;
    if (budget && kind === "slowed") {
      budget.stride = Math.min(budget.stride, Math.max(1, Math.floor(budget.stride / 2)));
      budget.move = Math.floor(budget.move / 2);
    }
    if (budget && kind === "prone") {
      budget.move = 0;
      budget.stride = 0;
    }
  }
  const now = unit.conditions.find((c) => c.kind === kind)!;
  if (amount !== undefined) now.amount = Math.max(now.amount ?? 0, amount);
  // A hex it is tied to (Fettered's spot): the latest one given.
  if (at) now.at = { q: at.q, r: at.r };
  ctx.events.push({ t: "condition", target: unit.id, kind, rounds, ...(now.amount !== undefined ? { amount: now.amount } : {}), ...(now.at ? { at: now.at } : {}) });
}

/** Each stack of a Burning: one count of turns apiece (a Burning from before stacks had their own is read as that many of its `rounds`). */
const burnStacks = (c: UnitCondition): { rounds: number; fresh?: boolean }[] => (c.stacks ??= Array.from({ length: c.amount ?? 1 }, () => ({ rounds: c.rounds })));

/** Whether a power of a hero's gear keeps this condition off them. */
export function gearWards(unit: Unit, kind: Condition): boolean {
  if (kind === "stunned") return perkOf(unit, "clear_head") > 0;
  if (kind === "burning") return perkOf(unit, "fireproof") > 0;
  if (kind === "prone") return perkOf(unit, "steady") > 0;
  if (kind === "slowed") return perkOf(unit, "fleet") > 0;
  return false;
}

/**
 * Add `n` stacks of Bleeding or Burning, each lasting STACK_TURNS. A new stack of Bleeding starts the count of every
 * stack over; each stack of Burning has its own, and the others burn on as they were. Something soaked cannot be set burning.
 */
export function addStacks(ctx: Ctx, unit: Unit, kind: StackingEffect, n = 1): void {
  if (unit.down || n <= 0 || !takesHold(ctx, unit, kind)) return;
  if (kind === "burning" && has(unit, "wet")) return;
  if (gearWards(unit, kind)) return;
  const enc = ctx.state.encounter;
  // Put on during its own turn, the end of that turn does not count against it.
  const fresh = !!enc && enc.acting.includes(unit.id) && !enc.done.includes(unit.id);
  const turns = STACK_TURNS[kind];
  let now = unit.conditions.find((c) => c.kind === kind);
  if (!now) unit.conditions.push((now = { kind, rounds: 0, amount: 0 }));
  if (kind === "bleeding") {
    now.amount = (now.amount ?? 1) + n;
    now.rounds = turns;
    if (fresh) now.fresh = true;
    else delete now.fresh;
  } else {
    const stacks = burnStacks(now);
    for (let i = 0; i < n; i++) stacks.push(fresh ? { rounds: turns, fresh: true } : { rounds: turns });
    now.amount = stacks.length;
    now.rounds = Math.max(...stacks.map((s) => s.rounds));
  }
  ctx.events.push({ t: "condition", target: unit.id, kind, rounds: now.rounds, amount: now.amount });
}

/** One stack of Bleeding closes (any healing does it): the rest bleed on, and the last gone, it stops. */
export function staunch(unit: Unit): void {
  const bleed = unit.conditions.find((c) => c.kind === "bleeding");
  if (!bleed) return;
  bleed.amount = (bleed.amount ?? 1) - 1;
  if (bleed.amount <= 0) removeCondition(unit, "bleeding");
}

/** What a stacking effect takes off a unit at the start of its turn: the tick for each of its stacks. */
export const dotOf = (unit: Unit, kind: StackingEffect): number => EFFECT_TICK[kind] * (unit.conditions.find((c) => c.kind === kind)?.amount ?? 1);

/** What Burning takes off a unit at the start of its turn. */
export const burnOf = (unit: Unit): number => dotOf(unit, "burning");

/** The start of a unit's turn (or a round out of a fight): each of its Bleeding and Burning stacks hurts it. */
export function tickStacks(ctx: Ctx, unit: Unit): void {
  for (const kind of ["bleeding", "burning"] as const) if (has(unit, kind)) tick(ctx, unit, kind, dotOf(unit, kind));
}

/**
 * The end of a unit's turn (or a round out of a fight): each condition has a turn less to run, bar those put on during
 * that very turn; each stack of Burning counts down on its own.
 */
export function countDown(unit: Unit): void {
  for (const c of unit.conditions) {
    if (UNTIMED.has(c.kind)) continue;
    if (c.kind === "burning") {
      const stacks = burnStacks(c).filter((s) => {
        if (s.fresh) delete s.fresh;
        else s.rounds -= 1;
        return s.rounds > 0;
      });
      c.stacks = stacks;
      c.amount = stacks.length;
      c.rounds = stacks.length > 0 ? Math.max(...stacks.map((s) => s.rounds)) : 0;
      continue;
    }
    if (c.fresh) c.fresh = false;
    else c.rounds -= 1;
  }
  unit.conditions = unit.conditions.filter((c) => c.rounds > 0);
}

/** Leave an ability's effect on a unit: stacks of a stacking one or a spent one (SPENT), or any other for the turns it says. */
export function inflict(ctx: Ctx, unit: Unit, what: Inflict): void {
  const stacks = "stacks" in what ? (what.stacks ?? 1) : 1;
  if (isStacking(what.effect)) addStacks(ctx, unit, what.effect, stacks);
  else if (isSpent(what.effect)) addUses(ctx, unit, what.effect, stacks);
  else if ("turns" in what) addCondition(ctx, unit, what.effect, what.turns, what.amount);
}

/**
 * Give a unit `uses` more of an untimed condition (UNTIMED) that piles up: added to whatever it has left (usesLeft),
 * not the bigger of the two. Fumbling and Inspired.
 */
export function addUses(ctx: Ctx, unit: Unit, kind: Condition, uses: number): void {
  if (uses <= 0) return;
  const held = unit.conditions.find((c) => c.kind === kind);
  addCondition(ctx, unit, kind, UNTIMED_KEEPS, (held ? usesLeft(held) : 0) + uses);
}

/** Whether a unit is Unseen (Sneak): no enemy can attack it, or pick it out to. */
export const unseen = (unit: Unit): boolean => has(unit, "invisible");

/** A unit Unseen gives itself away (it has used an ability, thrown something, shoved): it can be seen again. */
export function giveAway(ctx: Ctx, unit: Unit): void {
  if (!unseen(unit)) return;
  removeCondition(unit, "invisible");
  ctx.events.push({ t: "seen", id: unit.id });
}

/**
 * The name of a passive aura (EnemyAbilityDef `aura`) that gives `unit` disadvantage on its saves where it stands (a
 * Haunt's Terror Aura): one had by any of the other side in the fight, standing, within its radius. Null: none reaches it.
 */
export function dreadOver(state: ZoneState, unit: Unit): string | null {
  for (const u of state.units) {
    if (u.side === unit.side || u.down || !inFight(state, u.id)) continue;
    for (const id of u.abilities) {
      const def = ENEMY_ABILITIES[id];
      if (def?.aura?.saves === "disadvantage" && gap(u, unit) <= def.aura.radius) return def.name;
    }
  }
  return null;
}

/** The conditions that count as wounds, for abilities that grow with them. */
export const DEBUFFS: readonly Condition[] = ["bleeding", "burning", "stunned", "slowed", "fumbling", "exposed", "poisoned", "prone", "sundered", "reeling", "memento_mori", "fettered", "weakened"];

/** Fortify: one of the side that raised a wall, standing beside it, is the steadier for it. */
export const wallDefence = (state: Pick<ZoneState, "weather">, unit: Unit): number =>
  (state.weather ?? []).some((w) => w.kind === "wall" && w.side === unit.side && w.hexes.some((p) => gapTo(unit, p) === 1)) ? FORTIFY.defence : 0;

/** A unit's Defence. With the board (`state`), a Dour Shanty it stands in, and a wall of its side's it stands beside, count too. */
export const defenceOf = (unit: Unit, state?: Pick<ZoneState, "units" | "weather">): number =>
  (state ? songDefence(state, unit) + wallDefence(state, unit) : 0) +
  (unit.side === "hero" && unit.stats ? heroDefence(unit.stats, unit.armor) - ((unit.torch ?? 0) > 0 && unit.torchHand !== "main" && unit.outfit?.off_hand ? SHIELD_SET_ASIDE : 0) : enemyDefence(unit.kind)) +
  (has(unit, "coral_armor") ? CORAL_ARMOR.defence : 0) -
  (has(unit, "sundered") ? SUNDERED_DEFENCE : 0);

/** Whether a unit stands in water (Aqueous Regeneration heals more there). */
export const inWater = (state: ZoneState, unit: Unit): boolean => span(unit).some((p) => state.surfaces[posKey(p)]?.kind === "water");

/**
 * Heals that come again as a unit's turn starts (or a round passes out of a fight): Aqueous Regeneration, more for one
 * standing in water, and Rejuvenate's second heal, its dice rolled again with the bonus the first one had.
 */
export function regrow(ctx: Ctx, unit: Unit): void {
  if (unit.down) return;
  if (has(unit, "regenerating") && unit.hp < unit.maxHp) {
    const rolled = rollShown(ctx.rng, AQUEOUS.tick, inWater(ctx.state, unit) ? AQUEOUS.water : 0);
    heal(ctx, unit, rolled.total, { actor: null, what: "aqueous_regeneration", dice: rolled });
  }
  const again = unit.conditions.find((c) => c.kind === "rejuvenating");
  if (again && unit.hp < unit.maxHp) {
    const rolled = rollShown(ctx.rng, healDice(ABILITIES.rejuvenate), again.amount ?? 0);
    heal(ctx, unit, rolled.total, { actor: null, what: "rejuvenate", dice: rolled });
  }
}

/** What a unit adds to a save with `stat`: its own bonus, less what Weakened takes off every save (its `amount`). */
export const saveBonus = (unit: Unit, stat: StatKey): number =>
  (unit.side === "hero" ? mod(statOf(unit, stat)) : enemySave(unit.kind)) - weakenedBy(unit);

/** What Weakened takes off every save `unit` makes: its `amount` (WEAKENED_SAVES unless said), or 0 if it is not Weakened. */
export const weakenedBy = (unit: Unit): number => {
  const c = unit.conditions.find((x) => x.kind === "weakened");
  return c ? (c.amount ?? WEAKENED_SAVES) : 0;
};

/** A unit goes down: no HP left, nothing on it any more. */
export function strikeDown(ctx: Ctx, unit: Unit): void {
  if (unit.down) return;
  fall(ctx, unit);
}

/** Dev switch (DevOp "undying"): a hero who cannot go down. Blows on them still count in full; their HP stops at 0. */
const undying = (ctx: Ctx, unit: Unit): boolean => !!ctx.state.undying && unit.side === "hero" && !unit.summon;

/** Take `dealt` off a unit's HP, never below 0, and say how much of it counts: no more than they had, unless they cannot go down. */
function wound(ctx: Ctx, unit: Unit, dealt: number): number {
  const counts = undying(ctx, unit) ? dealt : Math.min(dealt, unit.hp);
  unit.hp = Math.max(0, unit.hp - counts);
  if (counts > 0) hurtBy(ctx, unit);
  return counts;
}

/**
 * Conditions that leave something more on their bearer each time they lose HP, by any means (a blow, a burn, the
 * ground): `gives` stacks of a spent effect (content.ts SPENT), as long as they have fewer than `upTo` of it. A new one
 * of the kind is a new entry here.
 * - Memento Mori: a stack of Fumbling, unless they are Fumbling already.
 */
export const ON_HURT: Partial<Record<Condition, { gives: SpentEffect; upTo: number }>> = {
  memento_mori: { gives: "fumbling", upTo: 1 },
};

/** A unit lost HP: what its conditions leave on it for that (ON_HURT). */
function hurtBy(ctx: Ctx, unit: Unit): void {
  for (const c of [...unit.conditions]) {
    const hurt = ON_HURT[c.kind];
    if (!hurt) continue;
    const held = unit.conditions.find((h) => h.kind === hurt.gives);
    const have = held ? usesLeft(held) : 0;
    if (have < hurt.upTo) addUses(ctx, unit, hurt.gives, Math.min(1, hurt.upTo - have));
  }
}

function fall(ctx: Ctx, unit: Unit): void {
  if (undying(ctx, unit)) return;
  const spot = unit.conditions.find((c) => c.kind === "black_spot");
  unit.hp = 0;
  unit.down = true;
  unit.conditions = [];
  ctx.events.push({ t: "down", id: unit.id });
  if (spot) passSpot(ctx, unit, spot);
}

/**
 * The Black Spot on one who has fallen before it ran out goes to the nearest of their side still standing (in the fight,
 * if one is on), for what it had left, still laid by whoever laid it.
 */
function passSpot(ctx: Ctx, from: Unit, spot: UnitCondition): void {
  const { state } = ctx;
  const next = state.units
    .filter((u) => u.side === from.side && u.id !== from.id && !u.down && (!state.encounter || inFight(state, u.id)))
    .sort((a, b) => gap(a, from) - gap(b, from) || a.id.localeCompare(b.id))[0];
  if (!next) return;
  addCondition(ctx, next, "black_spot", spot.rounds);
  const laid = next.conditions.find((c) => c.kind === "black_spot");
  if (laid) laid.by = spot.by;
}

/**
 * What an untimed condition (UNTIMED: a shield, Lucky, Frenzied, Fumbling, Inspired) keeps in its `rounds`: it does not wear off with
 * turns, so that is only kept above 0, so it is not taken for spent. What it has left is its `amount` (usesLeft).
 */
export const UNTIMED_KEEPS = 1;
const SHIELD_KEEPS = UNTIMED_KEEPS;

/** A shield is a thing of fights: only one in a fight can be given one. */
const shieldable = (ctx: Ctx, unit: Unit): boolean => inFight(ctx.state, unit.id);

/** Put a shield of `amount` points on a unit in a fight (Bolstered), to last the fight. A bigger one replaces a smaller. */
export function shieldUnit(ctx: Ctx, unit: Unit, amount: number): void {
  if (amount > 0 && shieldable(ctx, unit)) addCondition(ctx, unit, "bolstered", SHIELD_KEEPS, amount);
}

/** Add `amount` points to whatever shield a unit in a fight already has (Bulwark Strike), to last the fight. */
export function addShield(ctx: Ctx, unit: Unit, amount: number): void {
  if (amount > 0 && shieldable(ctx, unit)) addCondition(ctx, unit, "bolstered", SHIELD_KEEPS, shieldOf(unit) + amount);
}

/**
 * The only conditions a unit can have out of a fight: Lucky, a coin's worth of luck from the town well. Every other
 * one is a thing of fights: it takes hold only on someone in one (takesHold), and goes when they leave it (leaveFight).
 */
export const OUTLASTS_FIGHT: ReadonlySet<Condition> = new Set(["lucky"]);

/**
 * Whether what fights do reaches a unit now: it is in one, or touched by what opens one (Ctx.opening). Out of a fight
 * nothing takes hold on it (takesHold) and the ground and the weather do it no harm (surfaces.ts, weather.ts).
 */
export const inPlay = (ctx: Ctx, unit: Unit): boolean => !!ctx.opening || inFight(ctx.state, unit.id);

/** Whether a condition can be put on a unit now: on one in play (inPlay), and on any other only what outlasts fights. */
const takesHold = (ctx: Ctx, unit: Unit, kind: Condition): boolean => inPlay(ctx, unit) || OUTLASTS_FIGHT.has(kind);

/** The fight is over for this unit (it ended, or they got away from it): every condition on it goes, bar OUTLASTS_FIGHT. */
export function leaveFight(unit: Unit): void {
  unit.conditions = unit.conditions.filter((c) => OUTLASTS_FIGHT.has(c.kind));
}

/** The points of shield a unit has left (Bolstered), 0 for none. */
export const shieldOf = (unit: Pick<Unit, "conditions">): number => unit.conditions.find((c) => c.kind === "bolstered")?.amount ?? 0;

/** Spend a unit's shield on `amount` of damage. Returns how much of it the shield took; a shield used up is gone. */
function soak(unit: Unit, amount: number): number {
  const held = unit.conditions.find((c) => c.kind === "bolstered");
  if (!held) return 0;
  const took = Math.min(held.amount ?? 0, amount);
  held.amount = (held.amount ?? 0) - took;
  if (held.amount <= 0) removeCondition(unit, "bolstered");
  return took;
}

/**
 * Deal damage from a blow or a blast. Guarded halves it (rounding up) unless it goes through a guard;
 * a hit that lands always does at least 1. A shield (Bolstered) takes what it can before HP does.
 * Returns the HP it cost. `dice`: what was rolled for it, told with the hit (`halved`: the target saved for half).
 * `splash`: the shock of a blow on someone beside the target, not a blow at it (see the hit event).
 */
export function damage(ctx: Ctx, target: Unit, amount: number, opts: { actor: string | null; what: string; crit?: boolean; dice?: Rolled; halved?: boolean; splash?: boolean }): number {
  if (target.down) return 0;
  let dealt = Math.max(1, Math.round(amount));
  if (has(target, "guarded")) dealt = Math.ceil(dealt / 2);
  const blocked = soak(target, dealt);
  dealt = wound(ctx, target, dealt - blocked);
  const dice = opts.dice ? { ...opts.dice, ...(opts.halved ? { halved: true } : {}) } : undefined;
  ctx.events.push({ t: "hit", actor: opts.actor, target: target.id, amount: dealt, what: opts.what, crit: !!opts.crit, ...(blocked > 0 ? { blocked } : {}), ...(dice ? { dice } : {}), ...(opts.splash ? { splash: true } : {}) });
  if (target.hp <= 0) fall(ctx, target);
  // North Star: whatever its bearer strikes on the other side catches fire.
  const by = opts.actor ? ctx.state.units.find((u) => u.id === opts.actor) : undefined;
  if (by && by.side !== target.side && has(by, "north_star")) addStacks(ctx, target, "burning");
  // What its bearer's attacks are spurred on with (SPURS: a Frenzy's Bleeding) is left on whoever they draw blood from.
  if (by && by.side !== target.side && dealt > 0) for (const [, spur] of spursOn(by)) if (spur.leaves) addStacks(ctx, target, spur.leaves);
  return dealt;
}

/** Damage from a condition or from the ground: no guard against it. */
export function tick(ctx: Ctx, target: Unit, kind: Condition | "poison" | "fire" | "oil" | "water" | "ice", amount: number): void {
  if (target.down || amount <= 0) return;
  const dealt = wound(ctx, target, amount);
  ctx.events.push({ t: "tick", target: target.id, kind, amount: dealt });
  if (target.hp <= 0) fall(ctx, target);
}

/** Heal a unit. Someone down is back on their feet. Any healing closes one stack of Bleeding. Returns what was healed. */
export function heal(ctx: Ctx, target: Unit, amount: number, opts: { actor: string | null; what: string; dice?: Rolled }): number {
  if (amount > 0) staunch(target);
  if (target.down) {
    target.down = false;
    ctx.events.push({ t: "up", id: target.id });
  }
  const healed = Math.max(0, Math.min(target.maxHp - target.hp, Math.round(amount)));
  target.hp += healed;
  ctx.events.push({ t: "heal", actor: opts.actor, target: target.id, amount: healed, what: opts.what, ...(opts.dice ? { dice: opts.dice } : {}) });
  return healed;
}

export interface AttackContext {
  adv: -1 | 0 | 1;
  /** Added to the roll: high ground, cover. */
  mods: number;
  /** Why, in a few words each, for the tooltip. */
  notes: string[];
}

/**
 * What bears on an attack besides the attacker's skill.
 *
 * Advantage: the target is Exposed or Stunned, or Prone and struck in melee; a pack
 * animal has one of its own beside the target; the attacker is Unseen. Disadvantage: the attacker is Poisoned or Fumbling, carries the Black Spot or a Red Sky, is
 * shooting with an enemy beside them (or on their own hex), or is shooting at something Prone. Shots also get +2 from
 * higher ground, -2 from lower, and -2 at a target standing among trees. A blow by hand down a ladder gets
 * +2, and one struck up it -2.
 */
export function attackContext(state: ZoneState, attacker: Unit, target: Unit, opts: { melee: boolean }): AttackContext {
  const notes: string[] = [];
  let advantage = false;
  let disadvantage = false;
  const adv = (why: string) => { advantage = true; notes.push(`Advantage: ${why}`); };
  const dis = (why: string) => { disadvantage = true; notes.push(`Disadvantage: ${why}`); };
  if (has(target, "exposed")) adv("the target is Exposed");
  if (has(target, "stunned")) adv("the target is Stunned");
  if (has(target, "prone") && opts.melee) adv("the target is Prone");
  if (has(attacker, "invisible")) adv("you are Unseen");
  if (has(attacker, "inspired")) adv("you are Inspired");
  if (has(attacker, "lucky")) adv("you are Lucky");
  for (const [kind, spur] of spursOn(attacker)) if (spur.advantage) adv(`you are ${CONDITION_INFO[kind].name}`);
  if (has(target, "guiding_light") && target.side !== attacker.side) adv("the target is lit by Guiding Light");
  if (attacker.side === "enemy" && ENEMY_KIT[attacker.kind]?.pack && state.units.some((u) => u.id !== attacker.id && u.side === "enemy" && !u.down && gap(u, target) <= 1)) adv("the pack is on the target");
  if (has(attacker, "poisoned")) dis("Poisoned");
  if (has(attacker, "fumbling")) dis("Fumbling");
  if (has(attacker, "black_spot")) dis("the Black Spot is on you");
  if (has(attacker, "red_sky")) dis("Red Sky at Morning");
  // The party strikes blind at what the light does not reach. The things of the caves see in the dark.
  if (attacker.side === "hero" && span(target).every((p) => inDark(state, p))) dis("the target is in the dark");
  if (!opts.melee) {
    if (state.units.some((u) => u.side !== attacker.side && !u.down && inFight(state, u.id) && gap(u, attacker) <= 1)) dis("an enemy is beside you");
    if (has(target, "prone")) dis("the target is Prone");
  }
  let mods = 0;
  // A Beacon on the attacker, or on an ally near enough (AURAS.range): a steady bonus to hit, however many are lit.
  if (state.units.some((u) => u.side === attacker.side && !u.down && has(u, "beacon") && gap(u, attacker) <= AURAS.range)) {
    mods += AURAS.beaconHit;
    notes.push(`+${AURAS.beaconHit} ${has(attacker, "beacon") ? "your Beacon" : "an ally's Beacon"}`);
  }
  const sung = songHit(state, attacker);
  if (sung > 0) { mods += sung; notes.push(`+${sung} Lively Shanty`); }
  const [from, to] = meet(attacker, target);
  const rise = elevOf(state.map, from) - elevOf(state.map, to);
  if (!opts.melee) {
    if (rise > 0) { mods += 2; notes.push("+2 high ground"); }
    if (rise < 0) { mods -= 2; notes.push("-2 shooting uphill"); }
    if (tileAt(state.map, nearOf(target, attacker.pos))?.biome === "forest") { mods -= 2; notes.push("-2 the target is among trees"); }
  } else if (Math.abs(rise) >= 2) {
    // Only a ladder joins two that far apart: whoever holds the top of it has the better of it.
    if (rise > 0) { mods += 2; notes.push("+2 striking down a ladder"); }
    else { mods -= 2; notes.push("-2 striking up a ladder"); }
  }
  return { adv: netAdvantage(advantage, disadvantage), mods, notes };
}

/** Roll an attack and say so. A stack each of Fumbling, Inspired and Lucky is spent on it (spendUse). */
export function attackRoll(ctx: Ctx, attacker: Unit, target: Unit, opts: { label: string; bonus: number; melee: boolean }): Roll {
  const c = attackContext(ctx.state, attacker, target, opts);
  const roll = d20(ctx.rng, { kind: "attack", id: attacker.id, target: target.id, label: opts.label, bonus: opts.bonus + c.mods, vs: defenceOf(target, ctx.state), adv: c.adv });
  // A Ghostsail Cloak: the first attacks against its wearer each fight pass through them, whatever was rolled.
  const enc = ctx.state.encounter;
  const ghostly = perkOf(target, "ghostly");
  if (enc && ghostly > 0 && (enc.ghosted?.[target.id] ?? 0) < ghostly) {
    (enc.ghosted ??= {})[target.id] = (enc.ghosted[target.id] ?? 0) + 1;
    roll.ok = false;
    roll.crit = false;
    roll.label = `${roll.label} (Ghostly: passes through)`;
  }
  spendUse(ctx, attacker, "fumbling");
  spendUse(ctx, attacker, "inspired");
  spendLuck(ctx, attacker);
  ctx.events.push({ t: "roll", roll });
  return roll;
}

/**
 * What an untimed condition has left to spend (its stacks): the rolls Lucky has, the attacks a Frenzy has. One kept
 * from before they were held as stacks has its count in its `rounds`.
 */
export const usesLeft = (c: Pick<UnitCondition, "rounds" | "amount">): number => c.amount ?? c.rounds;

/**
 * Spend one use of an untimed condition (usesLeft): the last spent, it is gone. Told as it happens (a `spent`
 * condition event, with what is left), so what is shown counts down use by use, not all at once after.
 */
export function spendUse(ctx: Ctx, unit: Unit, kind: Condition): void {
  const held = unit.conditions.find((c) => c.kind === kind);
  if (!held) return;
  held.amount = usesLeft(held) - 1;
  held.rounds = UNTIMED_KEEPS;
  if (held.amount <= 0) removeCondition(unit, kind);
  ctx.events.push({ t: "condition", target: unit.id, kind, rounds: UNTIMED_KEEPS, amount: Math.max(0, held.amount), spent: true });
}

/**
 * Untimed conditions that spur on their bearer's next attacks, one use each (a Frenzy): what each gives every attack,
 * until its uses (usesLeft) are spent, one at the end of each attack made (attackMade). A new one of the kind is a new
 * entry here, and an UNTIMED condition.
 * - `advantage`: its attacks are rolled with advantage.
 * - `leaves`: a stack of this is left on whoever on the other side one of its attacks draws blood from.
 */
export const SPURS: Partial<Record<Condition, { advantage?: boolean; leaves?: StackingEffect }>> = {
  frenzied: { advantage: true, leaves: "bleeding" },
};

/** The spurs (SPURS) a unit has on it, by kind. */
const spursOn = (unit: Unit) => unit.conditions.flatMap((c) => (SPURS[c.kind] ? [[c.kind, SPURS[c.kind]!] as const] : []));

/** An attack of the unit's is over (a blow, a shot, an ability that does harm): one use of each of its spurs is spent. */
export function attackMade(ctx: Ctx, unit: Unit): void {
  for (const [kind] of spursOn(unit)) spendUse(ctx, unit, kind);
}

/** A roll to hit was made: one lucky roll is spent. */
export function spendLuck(ctx: Ctx, unit: Unit): void {
  spendUse(ctx, unit, "lucky");
}

/**
 * Conditions that keep, turn after turn, until something else uses them up: Lucky, Fumbling and Inspired, spent a roll
 * to hit at a time (attackRoll); Frenzied, spent an attack at a time (combat.ts enemyAct); and a shield (Bolstered),
 * spent by blows. What each has left is its `amount`, shown as stacks, never as turns (usesLeft). All but Lucky go when
 * the fight does, as every condition does (leaveFight: zone.ts settle, and flee for one who gets away).
 */
export const UNTIMED: ReadonlySet<string> = new Set(["lucky", "bolstered", "frenzied", "fumbling", "inspired"]);

/** Roll a save against a difficulty and say so. */
export function saveRoll(ctx: Ctx, unit: Unit, stat: StatKey, vs: number, label: string, disadvantage = false): Roll {
  // Within a Terror Aura of the other side's, every save is made with disadvantage.
  const worse = disadvantage || !!dreadOver(ctx.state, unit);
  const roll = d20(ctx.rng, { kind: "save", id: unit.id, label, bonus: saveBonus(unit, stat), vs, adv: worse ? -1 : 0 });
  ctx.events.push({ t: "roll", roll });
  return roll;
}
