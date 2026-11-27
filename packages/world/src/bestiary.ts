// The bestiary: a page of the log book with every kind of enemy on it. A kind is a dark shape until its player has
// been in a fight with one; after that it is written up with what it is at level 1 (or any level asked for: the
// sparring ring will ask for the level it is set at) and how many of it the player has faced and killed.
//
// Two halves, both pure:
//   - what a kind is, as words and numbers for a page (`bestiaryEntry`), made from the same tables a fight reads
//     (content.ts ENEMIES, zone/enemyabilities.ts), so a new enemy or a new kind of ability is written up with no
//     more work than adding it to those tables;
//   - what one step of a map adds to whose book (`bestiaryMarks`), for the map's room to write down.

import { EFFECT_INFO, ENEMIES, type Inflict } from "./content";
import { ENEMY_ABILITIES, type EnemyAbilityDef } from "./zone/enemyabilities";
import { CONDITION_INFO, abilityStrikes, enemyHp, retortDice, type EnemyStrike } from "./zone/kit";
import { diceText } from "./zone/rules";
import { SURFACE_INFO } from "./zone/surfaces";
import type { Unit, ZoneEvent, ZoneState } from "./zone/types";

/** Every kind in the book, in the order of its pages: the enemy table's own. */
export const BESTIARY_KINDS: readonly string[] = Object.keys(ENEMIES);

/** Kinds every book has from the first day, met or not: the ring's own training dummy. */
export const BESTIARY_ALWAYS: readonly string[] = ["dummy"];

/** One player's record of one kind. */
export interface BestiaryRecord {
  kind: string;
  /** How many of it they have been in a fight with. */
  faced: number;
  /** How many of those went down while they were in the fight. */
  kills: number;
  /** The highest level they have met one at. */
  topLevel: number;
  /** When they first met one (epoch ms). */
  firstAt: number | null;
}

/** Whether a kind is written up in a book holding these records. */
export const bestiaryMet = (records: ReadonlyMap<string, BestiaryRecord>, kind: string): boolean => BESTIARY_ALWAYS.includes(kind) || (records.get(kind)?.faced ?? 0) > 0;

/** How much of the book is filled in. */
export function bestiaryProgress(records: ReadonlyMap<string, BestiaryRecord>): { met: number; of: number; kills: number } {
  return {
    met: BESTIARY_KINDS.filter((kind) => bestiaryMet(records, kind)).length,
    of: BESTIARY_KINDS.length,
    kills: BESTIARY_KINDS.reduce((sum, kind) => sum + (records.get(kind)?.kills ?? 0), 0),
  };
}

// ---------- what a kind is ----------

/** One thing an enemy can do, or always has, as a line on its page. */
export interface BestiaryMove {
  id: string;
  name: string;
  /** What it does, in a sentence's worth of short phrases. */
  text: string;
  /** Not something it uses but something it has: no cost, no turn. */
  passive?: boolean;
}

export interface BestiaryEntry {
  kind: string;
  name: string;
  /** The level these numbers are for. */
  level: number;
  boss: boolean;
  hp: number;
  defence: number;
  /** Hexes of open ground 1 AP of movement buys it; 0 never moves. */
  move: number;
  init: number;
  save: number;
  moves: BestiaryMove[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hexes = (n: number) => plural(n, "hex", "hexes");

/** "Bleeding", "Prone for 1 turn": what an ability leaves on whoever fails to save. */
function inflictText(inflict: Inflict): string {
  const name = EFFECT_INFO[inflict.effect].name;
  if ("turns" in inflict) return `${name} for ${plural(inflict.turns, "turn")}`;
  return inflict.stacks && inflict.stacks > 1 ? `${inflict.stacks} stacks of ${name}` : name;
}

/**
 * What an ability does, read off its own entry: one phrase for each thing it says of itself, so an ability made of
 * parts the table already has needs no words written for it. A new part of EnemyAbilityDef gets its phrase here.
 */
function moveText(def: EnemyAbilityDef, strike: EnemyStrike | undefined): string {
  if (def.aura) return `Always on: everyone against it within ${hexes(def.aura.radius)} makes every save with disadvantage`;
  const parts: string[] = [];
  const range = strike?.range ?? def.range ?? 1;
  // What it is for.
  if (def.summon) parts.push(`Calls ${plural(def.summon.count, ENEMIES[def.summon.kind]?.name ?? def.summon.kind)} to its side${def.summon.most ? `, ${def.summon.most} at most at once` : ""}`);
  else if (def.rally) parts.push(`Its allies within ${hexes(range)} are ${CONDITION_INFO.frenzied.name} for ${plural(def.rally.attacks, "attack")}`);
  else if (strike?.kit.heal) parts.push(`Heals its own side for ${diceText(strike.kit.heal)}`);
  else if (strike && !strike.harmless) parts.push(`${diceText(strike.dice)} damage`);
  // Where it lands.
  if (def.field) parts.push(`a field ${hexes(def.field.radius)} round it for ${plural(def.field.rounds, "turn")}`);
  else if (def.dash) parts.push(`dashes up to ${hexes(range)}, through everyone in the way`);
  else if (def.blast !== undefined) parts.push(`thrown up to ${hexes(range)}, landing ${hexes(def.blast)} round`);
  else if (def.area !== undefined) parts.push(`thrown up to ${hexes(range)}, landing on ${hexes(def.area)}`);
  else if (def.sweep !== undefined) parts.push("a wide swing at everyone in front of it");
  else if (def.cone !== undefined) parts.push(`a cone ${hexes(def.cone)} long`);
  else if (def.line !== undefined) parts.push(`a line ${hexes(def.line)} long`);
  else if (def.aftershock) parts.push(`the ground within ${hexes(range)} of it`);
  else if (strike?.burst) parts.push(`everyone within ${hexes(range)}`);
  else if (def.leap) parts.push(`leaps from up to ${hexes(range)} off`);
  else if (!def.summon && !def.rally) parts.push(range > 1 ? `range ${range}` : "up close");
  // What it leaves.
  if (def.field?.slows) parts.push(`whoever it catches is ${EFFECT_INFO.slowed.name} for that turn`);
  if (def.saveOr) parts.push(`save or ${inflictText(def.saveOr)}`);
  if (def.tether) parts.push(`held within ${hexes(def.tether.reach)} for ${plural(def.tether.turns, "turn")}`);
  if (def.push) parts.push(`knocks back ${hexes(def.push === true ? 1 : def.push)}`);
  if (def.splash) parts.push("batters whoever stands beside the target");
  if (def.surface) parts.push(`leaves ${SURFACE_INFO[def.surface.kind].name.toLowerCase()} on the ground`);
  if (def.chills) parts.push("freezes water");
  if (def.drain) parts.push("heals itself as it hurts");
  if (def.aftershock) parts.push("the ground heaves again on its next turn");
  // What it takes.
  if (strike) parts.push(`${strike.cost} AP`);
  if (strike && strike.cooldown > 0) parts.push(`${plural(strike.cooldown, "turn")} to ready again`);
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A kind as its page writes it up, at this level (1: its base numbers). Undefined for a kind the table does not have. */
export function bestiaryEntry(kind: string, level = 1): BestiaryEntry | undefined {
  const def = ENEMIES[kind];
  if (!def) return undefined;
  const strikes = new Map(abilityStrikes(def.abilities, level).map((s) => [s.id, s]));
  const moves: BestiaryMove[] = def.abilities.flatMap((id) => {
    const ability = ENEMY_ABILITIES[id];
    return ability ? [{ id, name: ability.name, text: moveText(ability, strikes.get(id)), ...(ability.aura ? { passive: true } : {}) }] : [];
  });
  // What it is, besides what it does.
  if (def.regen) moves.push({ id: "regen", name: def.regen.name, text: `Grows back ${def.regen.amount} HP at the start of each of its turns, unless it is ${EFFECT_INFO[def.regen.unless].name}`, passive: true });
  if (def.retort) moves.push({ id: "retort", name: def.retort.name, text: `${def.retort.blurb} (${diceText(retortDice(def.retort, level))})`, passive: true });
  const ground = (kinds: readonly (keyof typeof SURFACE_INFO)[]) => kinds.map((k) => SURFACE_INFO[k].name.toLowerCase()).join(", ");
  if (def.groundImmune?.length) moves.push({ id: "ground_immune", name: "Unharmed by", text: `${ground(def.groundImmune)} on the ground`, passive: true });
  if (def.homeGround?.length) moves.push({ id: "home_ground", name: "At home on", text: `${ground(def.homeGround)}: what slows anyone else there quickens it`, passive: true });
  if ((def.size ?? 1) > 1) moves.push({ id: "heavy", name: "Huge", text: `Stands on ${hexes(def.size ?? 1)}, and is too heavy to be pushed, pulled or knocked about`, passive: true });
  return { kind, name: def.name, level, boss: !!def.boss, hp: enemyHp(kind, level), defence: def.defence, move: def.move, init: def.init, save: def.save, moves };
}

// ---------- what a fight adds to a book ----------

/** One step's addition to one book: `hero` is any one hero of the player whose book it is. */
export interface BestiaryMark {
  hero: string;
  kind: string;
  /** The highest level of this kind among what the step added. */
  level: number;
  /** How many more of this kind they are now in a fight with. */
  faced: number;
  /** How many of this kind went down in their fight. */
  kills: number;
}

/**
 * Whose books a fight is written in: one for each player with a hero of their own in it. A party (several heroes of
 * one account, zone-room.ts) is one player and so one book, under its party key; stand-ins and creatures called into
 * the fight are nobody's. Gives each book's key and a hero to find its owner by.
 */
function books(state: ZoneState, order: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of order) {
    const u = state.units.find((x) => x.id === id);
    if (!u || u.side !== "hero" || u.controller || u.summon) continue;
    const key = u.party || u.id;
    if (!out.has(key)) out.set(key, u.id);
  }
  return out;
}

/** The enemies in a fight that have a page: anything of a kind the table has, called in or not. */
const foes = (state: ZoneState, order: readonly string[]): Unit[] => order.flatMap((id) => state.units.filter((u) => u.id === id && u.side === "enemy" && !!ENEMIES[u.kind]));

/**
 * What one step of a map (zone.ts stepZone: the state before, the state after and what happened) adds to the books
 * of the players in its fight: each enemy on its feet newly in a fight with them is one more faced, and each enemy that went down
 * while they were in the fight is one more killed. Everyone in the fight has the kill, whoever landed the blow.
 * Nothing in the dev's combat sandbox counts, where enemies are set up and knocked down by hand.
 */
export function bestiaryMarks(prev: ZoneState, next: ZoneState, events: readonly ZoneEvent[]): BestiaryMark[] {
  if (prev.sandbox || next.sandbox) return [];
  const before = prev.encounter?.order ?? [];
  // A fight that began and ended in this one step is known only by what it said as it began.
  const begun = events.flatMap((e) => (e.t === "fight_start" ? e.units : []));
  const after = next.encounter?.order ?? (prev.encounter ? [] : begun);
  const marks = new Map<string, BestiaryMark>();
  const mark = (hero: string, book: string, foe: Unit, what: "faced" | "kills") => {
    const key = `${book}|${foe.kind}`;
    const m = marks.get(key) ?? { hero, kind: foe.kind, level: foe.level, faced: 0, kills: 0 };
    m[what] += 1;
    m.level = Math.max(m.level, foe.level);
    marks.set(key, m);
  };
  // Faced: every pairing of a book and an enemy still standing that the fight has now and did not have before. One
  // who fled the fight is out of its order but has faced what is in it already: coming back, they face none of it anew.
  const hadBooks = books(prev, [...before, ...(prev.encounter?.fled ?? [])]);
  const had = new Set([...hadBooks.keys()].flatMap((book) => foes(prev, before).map((foe) => `${book}|${foe.id}`)));
  for (const [book, hero] of books(next, after)) for (const foe of foes(next, after)) if (!foe.down && !had.has(`${book}|${foe.id}`)) mark(hero, book, foe, "faced");
  // Killed: an enemy that went down, for everyone who was in the fight as it did.
  const fight = prev.encounter ? { state: prev, order: before } : { state: next, order: after };
  const there = books(fight.state, fight.order);
  for (const e of events) {
    if (e.t !== "down") continue;
    const foe = next.units.find((u) => u.id === e.id) ?? prev.units.find((u) => u.id === e.id);
    if (!foe || foe.side !== "enemy" || !ENEMIES[foe.kind]) continue;
    for (const [book, hero] of there) mark(hero, book, foe, "kills");
  }
  return [...marks.values()];
}
