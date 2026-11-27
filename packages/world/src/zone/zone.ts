// The zone reducer. stepZone(state, action) is pure and seeded: it returns
// the next state, what happened (for the client to show) and what the
// server must carry out.
//
// Out of a fight everyone walks freely, at once. A hero who comes within
// sight of an enemy group starts one: the group and every hero near it
// roll initiative, and from then on those in the fight take turns while
// everyone else keeps walking. Walk near the fight and you are in it.
//
// A turn is Action Points (AP): AP_TURN more at its start, on top of any saved
// from the last (AP_MAX at most), spent on anything in any order, movement too.
// And it is one fighter's alone: nobody shares a place in the order (two who
// roll the same initiative roll off for it). Enemy turns are played here,
// at once, so nothing waits on a client. A fight is heard: at the start of
// each round, any band near enough to hear it comes to join it.
//
// Nothing is put in anyone's pack for them. The fallen lie where they
// fell, chests stand open, and a cleared place's spoils are heaped on the
// ground, each to be walked up to and taken from (loot.ts).

import { STARTING_STATS, hexDistance, hexNeighbors, posKey, type HexPos } from "@gantt-quest/core";
import { classAbilitiesOf, poolFor, withClassAbilities } from "../classabilities";
import { ABILITIES, DRUID_REGEN, EFFECT_TICK, ENEMIES, HERO_CLASSES, REELING_AP, WEAPONS, abilitiesFor } from "../content";
import { weaponItem } from "../gear";
import { tileAt } from "../map";
import type { HeroSheet } from "../hero";
import { addStats, maxHpFor } from "../progression";
import { makeRng, seedFromString } from "../rng";
import { enemyTurn } from "./ai";
import { pickBellGoer, placeBell } from "./bell";
import { abilityArea, checkAbility, checkCommon, checkDrink, checkLight, checkThrow, courseFor, doCommon, drinkItem, enemyAct, fieldsCatch, isBlink, moveLeft, resolveAbility, throwItem, walk } from "./combat";
import { checkStrike } from "./strikes";
import { UNTIMED_KEEPS, countDown, has, leaveFight, heal, regrow, removeCondition, tick, tickStacks, unseen, usesLeft, type Ctx } from "./engine";
import { ALERT_RANGE, JOIN_RANGE, freeHexNear, generateZone } from "./gen";
import { generateDelve } from "./delve";
import { checkLoot, checkOpen, leaveBody, look, lootFor, lootGroup, openChest, payBounty, take } from "./loot";
import { PARTY_SIZES, siteOpen, spaced } from "./sites";
import { FREE_WALK, big, blast, blockerAt, caught, covers, gap, inFight, isDead, meet, noWayThere, pathIn, perkOf, roomAt, sameHex, sees, solid, span, unitAt, unitById, zoneReach } from "./geometry";
import { AP_MAX, AP_TURN, SUMMON_AP_TURN, AURAS, ENEMY_MOVE_AP, FLEE_RANGE, ITEM_AP, STROLL_GRACE_MS, STROLL_STEP_MS, SUMMONS, STARTING_ITEMS, THROWABLES, THROWABLE_KINDS, cleanItems, unitStrike, commonCostFor, enemyMove, tacticOf } from "./kit";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { d20, heroMove, mod, rollDice, statOf } from "./rules";
import { hiddenEnemies, sentToClient } from "./light";
import { quakeAtTurn, tickWeather, weatherAtTurn } from "./weather";
import { checkPickup, checkStow, clearSurfaces, lightTorch, pickUpTorch, placeSurface, stowTorch, standInSurface, tickLights, tickSurfaces } from "./surfaces";
import { exploreRound, passTime } from "./clock";
import { checkUnlock, dropKeys, heardBy, workDoor } from "./doors";
import { checkForage, forage } from "./forage";
import { dismiss, enemyMaxHp, enemyUnit } from "./summon";
import { drown, drowningAtStart, drowningOwed, holdBreath } from "./drowning";
import { shantyOf, songMove, windward } from "./song";
import { courseMarks } from "./stars";
import { modsOf } from "./mods";
import type { Budget, Condition, DevOp, Encounter, JoinCause, Throwable, Unit, ZoneAction, ZoneEffect, ZoneEvent, ZoneHero, ZoneOptions, ZoneState, ZoneStep, ZoneView } from "./types";

/** Rounds a surface painted from the dev toolbox lasts. */
const PAINT_ROUNDS = 6;

// ---------- making a zone ----------

/**
 * The most heroes on a map at once, and the most its groups are ever sized for. A hero whose player has gone (`away`)
 * keeps their place but does not count against it: one who comes back finds it as full as it is then.
 */
export const MAX_PARTY = PARTY_SIZES.length;

/** Said when a hero would make the map's heroes more than it takes. */
export const MAP_FULL = `This map is full: ${MAX_PARTY} heroes are on it already.`;

/** What is in `want` and not in `had`, one for one, in `want`'s order. */
function beyond(want: readonly string[], had: readonly string[]): string[] {
  const left = [...had];
  return want.filter((kind) => {
    const i = left.indexOf(kind);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

/**
 * More heroes on the map than its groups were sized for (a crewmate, or their party, has walked on): every group not
 * yet beaten and not in a fight now is made what it would have been on a map made for that many, by adding whoever
 * that band has and this one was not made with, stood round its post. The new enemies' ids, in order.
 */
export function growGroups(state: ZoneState): string[] {
  const from = state.sizedFor ?? state.options.party;
  const to = Math.min(MAX_PARTY, state.units.filter((u) => u.side === "hero" && !u.summon).length);
  if (to <= from) return [];
  state.sizedFor = to;
  const added: string[] = [];
  for (const [id, group] of Object.entries(state.groups)) {
    if (!group.bands) continue;
    const members = state.units.filter((u) => u.side === "enemy" && u.group === id);
    const standing = members.find((u) => !u.down);
    if (!standing || members.some((u) => inFight(state, u.id))) continue;
    const post = standing.home ?? standing.pos;
    for (const kind of beyond(group.bands[to - 1] ?? [], group.bands[from - 1] ?? [])) {
      if (!ENEMIES[kind]) continue;
      // Round its post, spread out from the rest of its band (sites.ts spaced) where there is room, else the nearest free hex.
      const held = (p: HexPos) => !!unitAt(state, p) || blockerAt(state, p);
      const band = state.units.filter((u) => u.side === "enemy" && u.group === id && !u.down).map((u) => u.pos);
      const tile = (p: HexPos) => tileAt(state.map, p);
      const pos = freeHexNear(state.map, post, (p) => held(p) || !spaced(p, band) || hexDistance(p, post) > 3, tile) ?? freeHexNear(state.map, post, held, tile);
      if (!pos) break;
      const enemy = enemyUnit(state, kind, pos, id);
      state.units.push(enemy);
      added.push(enemy.id);
    }
  }
  makeRoom(state);
  return added;
}

/**
 * The nearest place to `near` where `unit` can stand (all of it, for a big one: geometry.ts span), on ground, clear of
 * everyone else and of anything that stands in the way. Null if there is none near.
 */
function placeFor(state: ZoneState, unit: Unit, near: HexPos): HexPos | null {
  const clear = (p: HexPos) => !solid(tileAt(state.map, p)) && !blockerAt(state, p) && !state.units.some((u) => u.id !== unit.id && !isDead(u) && covers(u, p));
  return freeHexNear(state.map, near, (p) => !span(unit, p).every(clear), (p) => tileAt(state.map, p));
}

/**
 * Every big enemy (geometry.ts span) has room for all of itself where it stands: one made where its post leaves no
 * room for the rest of it (the map was laid out with posts of one hex), or saved from before it was big, is moved to
 * the nearest place that has, and keeps that as its post. Out of a fight only. Returns the same state, changed in place.
 */
export function makeRoom(state: ZoneState): ZoneState {
  for (const u of state.units) {
    if (!big(u) || u.down || inFight(state, u.id)) continue;
    const there = placeFor(state, u, u.pos);
    if (!there || sameHex(there, u.pos)) continue;
    u.pos = there;
    u.home = there;
  }
  return state;
}

/**
 * A cave is left by its mouth, and only there (ZoneView). One made without a mouth (open cave floor from before
 * delves, or a dev map) is given one where heroes arrive: its start. Run on every cave made, and on every saved
 * one as it is loaded, so none is ever left with no way out. Returns the same state, changed in place.
 */
export function ensureMouth(state: ZoneState): ZoneState {
  if (state.options.biome !== "caves" || state.map.pois.some((p) => p.kind === "landing")) return state;
  state.map.pois.push({ id: "landing", kind: "landing", pos: { q: state.start.q, r: state.start.r }, hidden: false, cleared: false, usedBy: [], enemies: [] });
  return state;
}

/**
 * A saved enemy is given its kind's abilities as they are now when what it was saved with no longer works: none at all
 * (from before enemies carried their own), or any ability since retired (a kit reworked since, which would otherwise
 * leave it nothing to use, so it stood idle on its turns). One whose abilities all still exist keeps them. Run on
 * every saved zone as it is loaded (loadZone). Returns the same state, changed in place.
 */
export function ensureEnemyAbilities(state: ZoneState): ZoneState {
  for (const u of state.units) {
    const kit = u.side === "enemy" ? ENEMIES[u.kind]?.abilities : undefined;
    if (kit && ((u.abilities?.length ?? 0) === 0 || u.abilities.some((id) => !ENEMY_ABILITIES[id]))) u.abilities = [...kit];
  }
  return state;
}

/** Conditions saved under a name they no longer go by, and the one they go by now. */
const RENAMED: Record<string, Condition> = { glitched: "fumbling" };

/**
 * A zone saved with conditions under an old name (RENAMED) has them under the new one; and one saved from before
 * conditions were things of fights alone has none left on anyone out of a fight but what outlasts fights (shedOutside).
 */
function renameConditions(state: ZoneState): ZoneState {
  for (const u of state.units) for (const c of u.conditions) c.kind = RENAMED[c.kind] ?? c.kind;
  shedOutside(state, state.units);
  return state;
}

/** A saved zone, brought up to date as it is loaded: conditions under their new names (renameConditions), a way out of a cave (ensureMouth), enemies' abilities (ensureEnemyAbilities), and room for the big ones (makeRoom). */
export const loadZone = (state: ZoneState): ZoneState => makeRoom(ensureEnemyAbilities(ensureMouth(renameConditions(state))));

export function createZone(code: string, seed: string, options: ZoneOptions): ZoneState {
  const plan = options.delve ? generateDelve(seed, options) : generateZone(seed, options);
  const state: ZoneState = { v: 1, code, seed, rng: seedFromString(`zone-run|${seed}`), options, map: plan.map, start: plan.start, units: [], groups: {}, surfaces: { ...(plan.surfaces ?? {}) }, encounter: null, seq: 0 };
  if (plan.keys && plan.keys.length > 0) state.keyHolders = [...plan.keys];
  if (plan.scene) state.scene = { ...plan.scene };
  for (const group of plan.groups) {
    const id = group.id ?? `g${++state.seq}`;
    state.groups[id] = { alerted: false, ...(group.bands ? { bands: group.bands.map((b) => [...b]) } : {}) };
    group.kinds.forEach((kind, i) => state.units.push(enemyUnit(state, kind, group.posts[i], id)));
  }
  ensureMouth(state);
  makeRoom(state);
  if (!options.delve && open(state)) placeBell(state);
  return state;
}

/**
 * What a client is sent. `hidden` is who the dark hides (light.ts hiddenEnemies): it is the same whoever is being
 * told, and in a cave it takes going over every tile, so a caller with one state to send to several works it out
 * once and hands it in each time.
 */
export function zoneView(state: ZoneState, you: string, hidden: readonly string[] = hiddenEnemies(state), party: readonly string[] = []): ZoneView {
  const { rng: _rng, seed: _seed, loot: _loot, strolls: _strolls, ...rest } = state;
  // Of what there is to loot: what is everyone's (a body, a chest) as it stands, and of the spoils only the shares of
  // the one being told and of the party they play.
  const loot = lootFor(state, [you, ...party]);
  const mine = { ...(loot ? { loot } : {}), ...(party.length > 0 ? { party: [...party] } : {}) };
  if (hidden.length === 0) return { ...rest, ...mine, you };
  // What the dark hides is not sent at all, unless it is in a fight: then it keeps its place in the order, marked.
  const fighting = hidden.filter((id) => inFight(state, id));
  return { ...rest, ...mine, units: rest.units.filter(sentToClient(state, new Set(hidden))), you, ...(fighting.length > 0 ? { dark: fighting } : {}) };
}

/** Whether a fight's turns go untimed: the dev switch for it, or the combat sandbox. */
export const zoneUntimed = (state: Pick<ZoneState, "timerOff" | "sandbox">): boolean => !!state.timerOff || !!state.sandbox;

/** Whose turn the server is waiting on, as a key that changes when the wait does. Null out of a fight. */
export function zoneAwaiting(state: ZoneState): string | null {
  return state.encounter && state.encounter.acting.length > 0 ? `t:${state.encounter.turnNo}` : null;
}

/** Everything a hero can use in a fight: what their weapon gives, then the class abilities they chose. */
function heroAbilities(hero: ZoneHero): string[] {
  return withClassAbilities(abilitiesFor(hero.weapon), hero.classAbilities);
}

function heroUnit(hero: ZoneHero, pos: HexPos, controller?: string): Unit {
  return {
    id: hero.id,
    side: "hero",
    name: hero.name,
    kind: hero.classId,
    level: hero.level,
    pos,
    hp: hero.maxHp,
    maxHp: hero.maxHp,
    stats: hero.stats,
    armor: hero.armor,
    power: hero.weaponPower,
    abilities: heroAbilities(hero),
    outfit: hero.outfit,
    ...(hero.lantern ? { lantern: true } : {}),
    ...(hero.perks ? { perks: hero.perks } : {}),
    conditions: hero.luck && hero.luck > 0 ? [{ kind: "lucky", rounds: UNTIMED_KEEPS, amount: hero.luck }] : [],
    down: false,
    cooldowns: {},
    items: { ...(hero.items ?? STARTING_ITEMS) },
    controller,
    ...(hero.party ? { party: hero.party } : {}),
  };
}

/** A hero's sheet, as a zone needs it: stats with gear, how much they can take, and (`items`) what their pack holds to drink or throw. */
export function zoneHero(sheet: HeroSheet, items?: Partial<Record<Throwable, number>>, luck = 0): ZoneHero {
  const stats = addStats(sheet.base, sheet.bonus);
  return {
    id: sheet.id, name: sheet.name, classId: sheet.classId, level: sheet.level, stats, weapon: sheet.weapon, weaponPower: sheet.weaponPower ?? 0, armor: sheet.armor ?? 0, outfit: sheet.outfit,
    ...(sheet.lantern ? { lantern: true } : {}),
    ...(sheet.perks ? { perks: sheet.perks } : {}),
    maxHp: maxHpFor(stats, sheet.level),
    classAbilities: classAbilitiesOf(sheet.classId, sheet.level, sheet.abilityLoadout),
    ...(items ? { items: cleanItems(items) } : {}),
    ...(luck > 0 ? { luck: Math.floor(luck) } : {}),
  };
}

/** A stand-in crewmate of a class, as it starts out: for trying fights with a party when alone. */
export function standInHero(classId: string, id: string, level: number): ZoneHero | null {
  const cls = HERO_CLASSES.find((c) => c.id === classId);
  const stats = STARTING_STATS[classId];
  if (!cls || !stats) return null;
  return { id, name: cls.name.split(" ").slice(-1)[0], classId, level, stats, weapon: cls.weapons[0], weaponPower: 0, armor: 0, maxHp: maxHpFor(stats, level) };
}

// ---------- fights ----------

const standing = (state: ZoneState, side: Unit["side"]) => state.units.filter((u) => u.side === side && !u.down);

/**
 * Two who rolled the same initiative do not share a place in the order: they roll off for it, a plain d20 each, and
 * again should those come up the same. `unit` has just rolled; whoever already holds its number and has not yet had
 * to roll off rolls now too. What each rolled is kept (Encounter.tie): the higher goes first.
 */
function rollOff(ctx: Ctx, enc: Encounter, unit: Unit): void {
  // (What a hero called has its caller's number, and no roll of its own: it goes where they go, below.)
  const same = Object.keys(enc.init).filter((id) => id !== unit.id && enc.init[id] === enc.init[unit.id] && !unitById(ctx.state, id)?.summon);
  if (same.length === 0) return;
  const tie = (enc.tie ??= {});
  const roll = (id: string) => {
    for (let tries = 0; tries < 30; tries++) {
      const r = d20(ctx.rng, { kind: "initiative", id, label: "Tie-break", bonus: 0, vs: 0, adv: 0 });
      ctx.events.push({ t: "roll", roll: r });
      // The same again as someone it is tied with: once more.
      if ([...same, unit.id].some((o) => o !== id && tie[o] === r.total)) continue;
      tie[id] = r.total;
      return;
    }
    tie[id] = 0;
  };
  for (const id of same) if (tie[id] === undefined) roll(id);
  roll(unit.id);
  // What a hero called stands just behind them still, whatever they rolled off.
  for (const u of ctx.state.units) {
    const caller = u.summon?.by;
    if (caller && enc.init[u.id] !== undefined && tie[caller] !== undefined) tie[u.id] = tie[caller] - 0.01 * (1 + ctx.state.units.filter((o) => o.summon?.by === caller).indexOf(u));
  }
}

/**
 * Roll a unit's initiative and slot it into the order: highest first, and on a tie whoever wins the roll-off
 * (rollOff). One coming back into a fight they fled has the place they had: no fresh roll, so no fresh turn out
 * of getting away and back.
 */
function enter(ctx: Ctx, enc: Encounter, unit: Unit): void {
  if (enc.order.includes(unit.id)) return;
  if (enc.init[unit.id] === undefined) {
    // A Lookout's Cap: quicker off the mark.
    const bonus = unit.side === "hero" ? mod(statOf(unit, "agi")) + perkOf(unit, "quick") : (ENEMIES[unit.kind]?.init ?? 0);
    const roll = d20(ctx.rng, { kind: "initiative", id: unit.id, label: "Initiative", bonus, vs: 0, adv: 0 });
    ctx.events.push({ t: "roll", roll });
    enc.init[unit.id] = roll.total;
    rollOff(ctx, enc, unit);
  }
  const before = (a: string, b: string) => enc.init[b] - enc.init[a] || (enc.tie?.[b] ?? 0) - (enc.tie?.[a] ?? 0) || a.localeCompare(b);
  const at = enc.order.findIndex((id) => before(unit.id, id) < 0);
  enc.order.splice(at < 0 ? enc.order.length : at, 0, unit.id);
  // One who fled it and is back is simply in it again.
  if (enc.fled?.includes(unit.id)) enc.fled = enc.fled.filter((id) => id !== unit.id);
  // A Warden walks into every fight with their guard up.
  if (unit.kind === "sre_warden" && !has(unit, "guarded")) unit.conditions.push({ kind: "guarded", rounds: 1 });
}

/**
 * Whether a hero out of the fight is near enough to be drawn into it: within JOIN_RANGE of anyone in it.
 * One who fled it has got clear, and only an enemy in it coming within FLEE_RANGE brings them back.
 */
function drawnIn(state: ZoneState, enc: Encounter, hero: Unit): boolean {
  const fled = !!enc.fled?.includes(hero.id);
  return state.units.some((f) => enc.order.includes(f.id) && !f.down && (fled ? f.side !== hero.side && gap(f, hero) <= FLEE_RANGE : gap(f, hero) <= JOIN_RANGE));
}

/** Heroes near anyone in the fight are in it. */
function pullIn(ctx: Ctx): void {
  const enc = ctx.state.encounter;
  if (!enc) return;
  for (const hero of standing(ctx.state, "hero")) {
    // Nobody is dragged into a fight while their player is not there to play it.
    if (hero.away || enc.order.includes(hero.id) || !drawnIn(ctx.state, enc, hero)) continue;
    enter(ctx, enc, hero);
    ctx.events.push({ t: "fight_join", id: hero.id });
  }
}

/**
 * Whatever a hero out of the fight does to someone in it, harm or help, puts them in it: a shot from afar,
 * a bomb, a heal for a friend still fighting. (Walking near it does too: pullIn.) Not one who fled it: see reachBack.
 */
function reachIn(ctx: Ctx, unit: Unit, touched: Unit[]): void {
  const enc = ctx.state.encounter;
  if (!enc || unit.side !== "hero" || unit.down || enc.order.includes(unit.id)) return;
  if (!touched.some((u) => u.id !== unit.id && enc.order.includes(u.id))) return;
  enter(ctx, enc, unit);
  ctx.events.push({ t: "fight_join", id: unit.id });
}

/**
 * Whether what a unit does to these (an ability, a throw, a shove) opens a fight or joins one: it reaches a band
 * (`struck`, the groups it is about to rouse), or someone already in a fight. Then what it leaves takes hold
 * (Ctx.opening) on whoever it touches, though the fight begins only once it is done.
 */
const opens = (state: ZoneState, struck: string[], touched: Unit[]): boolean => struck.length > 0 || touched.some((u) => inFight(state, u.id));

/** After an opening (opens): whoever it touched who is in no fight after all keeps nothing it left them (leaveFight). */
function shedOutside(state: ZoneState, units: Unit[]): void {
  for (const u of units) if (!inFight(state, u.id)) leaveFight(u);
}

/**
 * Why a hero who fled the fight cannot do this, in words, or null. Out of the fight they have no turn to wait for,
 * no Action to spend and no cooldowns running, so nothing they do to anyone in it is allowed until an enemy in it
 * draws them back (drawnIn): else every Flee would buy a free blow, flask or rescue, off the turn order.
 */
function reachBack(state: ZoneState, unit: Unit, touched: Unit[]): string | null {
  const enc = state.encounter;
  if (!enc?.fled?.includes(unit.id) || !touched.some((u) => u.id !== unit.id && enc.order.includes(u.id))) return null;
  return `You got away from that fight: to act on anyone in it, go back until an enemy in it is within ${FLEE_RANGE} hexes of you.`;
}

/**
 * A hero gets away (Flee): out of the order and out of the turn, free to walk. The fight goes on for anyone
 * still in it; once no hero is, it is over (settle). Their initiative is kept for if they come back, and they
 * have had this round's turn.
 */
function flee(ctx: Ctx, unit: Unit): void {
  const enc = ctx.state.encounter!;
  const at = enc.order.indexOf(unit.id);
  enc.order.splice(at, 1);
  delete enc.budgets[unit.id];
  if (enc.banked) delete enc.banked[unit.id];
  const acting = enc.acting.includes(unit.id);
  enc.acting = enc.acting.filter((id) => id !== unit.id);
  enc.done = enc.done.filter((id) => id !== unit.id);
  // The turn was theirs alone: the next goes to whoever came after them.
  if (acting && enc.acting.length === 0) enc.resume = enc.order[at] ?? null;
  enc.fled = [...(enc.fled ?? []), unit.id];
  enc.waits = [...(enc.waits ?? []), unit.id];
  // Out of the fight: what it left on them does not come with them (bar their luck).
  leaveFight(unit);
  endTurn(ctx, unit);
  ctx.events.push({ t: "fled", id: unit.id });
}

/**
 * Enemy groups have noticed someone: they are in a fight. One starts if none is on, and in the open that rouses the
 * rest of the place (rouse). Each band is told once (`alert`), with who of it comes and why (`why`, a cause per
 * band, or one for them all); a hero who set it off and was not in the fight joins it with them.
 */
function engage(ctx: Ctx, groups: string[], why: JoinCause | ((group: string) => JoinCause)): void {
  const { state } = ctx;
  const fresh = groups.filter((g) => state.groups[g] && !state.groups[g].alerted);
  if (fresh.length === 0) return;
  const members = state.units.filter((u) => u.group && fresh.includes(u.group) && !u.down);
  for (const g of fresh) {
    state.groups[g].alerted = true;
    ctx.events.push({ t: "alert", group: g, units: members.filter((u) => u.group === g).map((u) => u.id), why: typeof why === "function" ? why(g) : why });
  }
  if (members.length === 0) return;
  const starting = !state.encounter;
  const enc: Encounter = state.encounter ?? { round: 1, order: [], init: {}, acting: [], done: [], budgets: {}, reacted: [], turnNo: 0, deadline: null };
  state.encounter = enc;
  const cause = typeof why === "function" ? null : why;
  const by = cause && cause.kind !== "heard" ? unitById(state, cause.by) : undefined;
  const joining = [...members, ...(by && by.side === "hero" && !by.down ? [by] : [])];
  if (starting) ctx.events.push({ t: "fight_start", units: joining.map((u) => u.id) });
  for (const u of joining) {
    if (enc.order.includes(u.id)) continue;
    enter(ctx, enc, u);
    // The band was told as one (alert); a hero coming in with it is told on their own.
    if (!starting && u.side === "hero") ctx.events.push({ t: "fight_join", id: u.id });
  }
  pullIn(ctx);
}

/** How far a band will come to a fight it was roused to, in movement: further than any map is across, short of for ever. */
const ROUSE_REACH = 400;

/** Whether a fight here is everyone's business: an open-air place (zone/sites.ts), where a shout carries to all of it. */
const open = (state: ZoneState) => !!state.scene && siteOpen(state.scene.site);

/**
 * The alarm bell (bell.ts), rung by an enemy, rouses the whole place: every band that has noticed nobody is in it from now on, and comes.
 * A band with a boss in it comes too. Only a band with no way to the fight on foot stays where it is (shut in behind
 * a locked door, or on ground nothing joins to it). "A way" is a matter of the ground alone:
 * whoever is standing in a doorway or on a bridge just now does not make it no way. Under a roof, or under ground, nothing is
 * roused: walls keep the noise in, and only those near enough to hear come. Called when the bell is rung, and by nothing else:
 * a fight no longer rouses the place of itself.
 */
function rouse(ctx: Ctx, ringer: Unit): void {
  const { state } = ctx;
  const enc = state.encounter;
  if (!enc || !open(state)) return;
  const fighters = state.units.filter((u) => enc.order.includes(u.id) && !u.down);
  const hero = fighters.find((u) => u.side === "hero");
  if (!hero) return;
  const bands = new Map<string, Unit[]>();
  for (const e of standing(state, "enemy")) {
    if (!e.group || state.groups[e.group]?.alerted) continue;
    bands.set(e.group, [...(bands.get(e.group) ?? []), e]);
  }
  // Where getting to counts as getting to the fight: the hex of anyone in it, or one beside.
  const near = new Set(fighters.flatMap((f) => [f.pos, ...hexNeighbors(f.pos, state.map.grid)]).map(posKey));
  const coming: string[] = [];
  for (const [group, members] of bands) {
    // One of them that can get to anyone in the fight is enough: the rest follow. Over the ground as it lies, with nobody standing on it.
    const ground = { ...state, units: [] };
    const way = members.some((m) => {
      // Whether any such hex is reached is all that is asked, so the flood stops at the first (zoneReach `enough`).
      const reach = zoneReach(ground, m, ROUSE_REACH, undefined, undefined, (r) => near.has(posKey(r.pos)));
      return fighters.some((f) => reach.has(posKey(f.pos)) || hexNeighbors(f.pos, state.map.grid).some((n) => reach.has(posKey(n))));
    });
    if (way) coming.push(group);
  }
  if (coming.length === 0) return;
  ctx.events.push({ t: "roused", groups: coming, units: coming.flatMap((g) => bands.get(g)!.map((u) => u.id)) });
  engage(ctx, coming, { kind: "bell", by: ringer.id });
}

/**
 * A fight is heard. Any band that has noticed nobody, with one of its own within ALERT_RANGE of someone still
 * standing in the fight (either side), turns on the party: it is in the fight from now on. Hearing reaches as far
 * as sight does (noticedBy), by the one value, but needs no line to the fight: walls do not stop it. Called as
 * each new round begins.
 */
function reinforce(ctx: Ctx, only?: readonly string[]): void {
  const { state } = ctx;
  const enc = state.encounter;
  if (!enc) return;
  const fighters = state.units.filter((u) => enc.order.includes(u.id) && !u.down);
  const hero = fighters.find((u) => u.side === "hero");
  if (!hero) return;
  // Each band heard, and the one in the fight nearest any of it (whom it heard).
  const heard = new Map<string, { near: string; gap: number }>();
  for (const e of standing(state, "enemy")) {
    if (!e.group || state.groups[e.group]?.alerted || (only && !only.includes(e.group))) continue;
    for (const f of fighters) {
      const d = gap(f, e);
      if (d <= ALERT_RANGE && d < (heard.get(e.group)?.gap ?? Infinity)) heard.set(e.group, { near: f.id, gap: d });
    }
  }
  if (heard.size > 0) engage(ctx, [...heard.keys()], (g) => ({ kind: "heard", near: heard.get(g)!.near }));
}

/** The groups, not yet alerted, with someone who can see `unit` from close by. */
function noticedBy(state: ZoneState, unit: Unit): string[] {
  const out = new Set<string>();
  // Nobody notices the Unseen creeping past.
  if (unseen(unit)) return [];
  for (const e of standing(state, "enemy")) {
    if (!e.group || state.groups[e.group]?.alerted) continue;
    if (gap(e, unit) <= ALERT_RANGE && sees(state.map, ...meet(e, unit))) out.add(e.group);
  }
  return [...out];
}

/** After each step: has this unit walked into a fight, or brought one to somebody? True stops it where it is. */
function onStep(ctx: Ctx, unit: Unit, flush: () => void): boolean {
  // Into a field of the other side's: a Slowing Field makes the rest of the way slower; a Blizzard Aura bites.
  fieldsCatch(ctx, unit);
  if (unit.down) return true;
  if (unit.side !== "hero") {
    // An enemy closing in draws nearby heroes into the fight; it carries on.
    pullIn(ctx);
    return false;
  }
  const noticed = noticedBy(ctx.state, unit);
  if (noticed.length > 0) {
    flush();
    engage(ctx, noticed, { kind: "seen", by: unit.id });
    return true;
  }
  const enc = ctx.state.encounter;
  if (enc && !inFight(ctx.state, unit.id) && drawnIn(ctx.state, enc, unit)) {
    flush();
    pullIn(ctx);
    return true;
  }
  return false;
}

/** Start a unit's turn: its conditions and the ground act on it, and it gets its budget. False if it has no turn to take. */
function beginTurn(ctx: Ctx, enc: Encounter, unit: Unit): boolean {
  // A new turn of its own: the fields it is in may catch it again.
  delete unit.caughtBy;
  removeCondition(unit, "guarded");
  removeCondition(unit, "taunting");
  // A Lively Shanty's lift from those who joined it lasts until its Bard's turn comes round again.
  const song = shantyOf(unit);
  if (song) song.surge = 0;
  tickStacks(ctx, unit);
  if (unit.down) return false;
  // The ground it cracked on its last turn heaves (an Earthquake), whether or not it is fit to do anything else.
  quakeAtTurn(ctx, unit);
  // A Druid mends a little every turn.
  if (unit.kind === "backend_druid" && unit.hp < unit.maxHp) heal(ctx, unit, DRUID_REGEN, { actor: unit.id, what: "regen" });
  // A Healing Aura mends the bearer and everyone of theirs standing beside them.
  if (has(unit, "mending")) {
    for (const u of ctx.state.units) {
      if (u.side === unit.side && !u.down && u.hp < u.maxHp && hexDistance(u.pos, unit.pos) <= AURAS.range) heal(ctx, u, rollDice(ctx.rng, AURAS.heal), { actor: unit.id, what: "healing_aura" });
    }
  }
  // Aqueous Regeneration comes again.
  regrow(ctx, unit);
  // A troll's wounds close at the start of each of its turns, unless it is on fire.
  const grows = unit.side === "enemy" ? ENEMIES[unit.kind]?.regen : undefined;
  if (grows && unit.hp < unit.maxHp && !has(unit, grows.unless)) heal(ctx, unit, grows.amount, { actor: unit.id, what: grows.name });
  standInSurface(ctx, unit);
  // Drowning takes its toll (the Curse of Drowning first, for a turn started in water).
  drowningAtStart(ctx, unit);
  if (unit.down) return false;
  if (has(unit, "stunned")) {
    removeCondition(unit, "stunned");
    ctx.events.push({ t: "skip", id: unit.id, kind: "stunned" });
    return false;
  }
  // Its turn starting in fields of the other side's: Slowed for it, or bitten.
  fieldsCatch(ctx, unit, true);
  // What 1 AP of movement buys it.
  const base = strideOf(ctx.state, unit);
  // A Wind-god's Shanty: further, and no Slowing.
  const sung = base > 0 ? songMove(ctx.state, unit) : 0;
  // A Tailwind given since its last turn: the wind at its back.
  // Courier's Shoes: further for every AP walked.
  let stride = base > 0 ? base + sung + perkOf(unit, "swift") + (unit.conditions.find((c) => c.kind === "tailwind")?.amount ?? 0) : 0;
  if (has(unit, "slowed") && windward(ctx.state, unit)) removeCondition(unit, "slowed");
  if (has(unit, "slowed") && stride > 0) stride = Math.max(1, Math.floor(stride / 2));
  if (has(unit, "hasted")) stride *= 2;
  // Fresh AP on top of what was saved from its last turn.
  let ap = Math.min(AP_MAX, (enc.banked?.[unit.id] ?? 0) + (unit.summon && unit.side === "hero" ? SUMMON_AP_TURN : AP_TURN));
  if (enc.banked) delete enc.banked[unit.id];
  // Getting up off the ground takes an AP.
  if (has(unit, "prone")) {
    removeCondition(unit, "prone");
    ap -= 1;
    // Said, so the getting up is seen before anything else it does this turn.
    ctx.events.push({ t: "stood", id: unit.id });
  }
  // Still reeling from a heavy blow: this turn comes with less to spend, and so does each after it while it lasts (it
  // runs down with the turns, as any condition does).
  const reel = unit.conditions.find((c) => c.kind === "reeling");
  if (reel) {
    const lost = Math.min(reel.amount ?? REELING_AP, Math.max(0, ap));
    ap -= lost;
    // Said, so the turn is seen to start short before anything else it does.
    ctx.events.push({ t: "reeled", id: unit.id, ap: lost });
  }
  ap = Math.max(0, ap);
  // Windrunner Leggings: a few steps free at the start of every turn (none for one knocked flat).
  enc.budgets[unit.id] = { ap, move: stride > 0 ? perkOf(unit, "fleet") : 0, stride, disengaged: false, ...(sung > 0 ? { song: sung } : {}) };
  // An enemy puts only so much of a turn into getting about.
  if (unit.side === "enemy") enc.budgets[unit.id].walk = ENEMY_MOVE_AP;
  // A course charted by one of its side: further, on the steps that bring it nearer the mark.
  if (courseMarks(ctx.state, unit).length > 0) enc.budgets[unit.id].course = 0;
  // Weather it stands in acts now its turn is underway, with a budget for the winds to change.
  weatherAtTurn(ctx, unit);
  // Drowning: hold its breath, or lose some of its AP.
  holdBreath(ctx, unit, enc.budgets[unit.id]);
  return !unit.down;
}

/**
 * End a unit's turn: each cooldown and each condition has one turn less to run, bar conditions put on during this very turn.
 * Then the stacks of Drowning it is owed for how it ended the turn (drowning.ts), each running its full count.
 */
function endTurn(ctx: Ctx, unit: Unit): void {
  for (const key of Object.keys(unit.cooldowns)) {
    unit.cooldowns[key] -= 1;
    if (unit.cooldowns[key] <= 0) delete unit.cooldowns[key];
  }
  const owed = drowningOwed(ctx.state, unit);
  countDown(unit);
  drown(ctx, unit, owed);
}

/**
 * If the fight is decided, end it. Every hero who was in it is back to full HP, whichever way it went. Won: the
 * fallen heroes get up and the enemy dead are cleared away. Lost: the heroes wake at the start, and the enemy are
 * back at their posts, healed.
 * Fled (every hero still standing got away, and none is left in it): nobody wins. The enemy go back to
 * their posts and bind their wounds, but those of them that fell stay fallen: fleeing gets a party out,
 * and what it killed stays killed, but it is no way to wear a band down. It never costs more than losing:
 * nobody is moved or hurt, and nothing is paid.
 */
function settle(ctx: Ctx): boolean {
  const { state } = ctx;
  const enc = state.encounter;
  if (!enc) return false;
  const fighters = state.units.filter((u) => enc.order.includes(u.id));
  // A creature called into the fight is no hero: it neither holds a lost fight off nor keeps a fled one going.
  const heroes = fighters.filter((u) => u.side === "hero" && !u.summon);
  const foes = fighters.filter((u) => u.side === "enemy");
  const won = foes.every((u) => u.down);
  const lost = !won && heroes.length > 0 && heroes.every((u) => u.down);
  const fled = !won && heroes.length === 0;
  if (!won && !lost && !fled) return false;
  ctx.events.push({ t: "fight_end", outcome: won ? "victory" : lost ? "defeat" : "fled" });
  // What was called into it goes with it.
  for (const u of state.units.filter((x) => x.summon)) dismiss(ctx, u);
  state.encounter = null;
  // Nothing it left on anyone outlasts it (bar luck): it goes from everyone who was in it, those who fled it too.
  for (const u of state.units) if (fighters.includes(u) || enc.fled?.includes(u.id)) leaveFight(u);
  // However it ended, every hero who was in it is whole again: the fallen get up, and nobody carries a wound out.
  for (const h of heroes) {
    if (h.down) {
      h.down = false;
      ctx.events.push({ t: "up", id: h.id });
    }
    h.hp = h.maxHp;
    h.cooldowns = {};
  }
  // Those who got away took part too: what they were waiting on in it is over with it, and they are whole again too.
  for (const id of enc.fled ?? []) {
    const h = unitById(state, id);
    if (!h || h.side !== "hero") continue;
    h.cooldowns = {};
    if (!h.down) h.hp = h.maxHp;
  }
  if (won) {
    // Every hero who fought takes the whole XP. A stand-in takes nothing. What the fallen had on them stays on
    // them: they lie where they fell, to be searched (loot.ts).
    // On a map the atlas made, the fallen are worth more the higher their level, as they took more killing.
    const worth = (f: Unit) => (ENEMIES[f.kind]?.xp ?? 0) * (state.options.tier ? 1 + 0.15 * Math.max(0, f.level - 1) : 1);
    // What an enemy called into the fight (a Broodmother's brood) is worth nothing of its own.
    const xp = Math.round(foes.filter((f) => !f.summon).reduce((sum, f) => sum + worth(f), 0));
    for (const h of heroes) {
      if (h.controller) continue;
      ctx.effects.push({ type: "grant", heroId: h.id, xp, resources: {} });
      ctx.events.push({ t: "spoils", id: h.id, xp, resources: {} });
    }
  } else if (fled) {
    // Nobody left to fight: back to their posts, whole again, ready to turn on whoever they see next. The dead stay dead.
    const groups = new Set(foes.map((f) => f.group));
    for (const g of groups) if (g && state.groups[g]) state.groups[g].alerted = false;
    const back = state.units.filter((u) => u.side === "enemy" && !u.down && groups.has(u.group));
    const was = new Map(back.map((f) => [f.id, f.pos]));
    // Off the board for a moment, so each finds its own post, or the nearest free hex if a hero stands on it.
    for (const f of back) {
      f.hp = f.maxHp;
      leaveFight(f);
      f.pos = { q: -99, r: -99 };
    }
    for (const f of back) {
      const post = f.home ?? was.get(f.id)!;
      f.pos = placeFor(state, f, post) ?? was.get(f.id)!;
    }
  } else {
    const groups = new Set(foes.map((f) => f.group));
    for (const g of groups) if (g && state.groups[g]) state.groups[g].alerted = false;
    // (Not one lost to a pit: it is gone for good, win or lose.)
    const band = state.units.filter((u) => u.side === "enemy" && groups.has(u.group) && !u.lost);
    const was = new Map(band.map((f) => [f.id, f.pos]));
    // Off the board for a moment: the enemy, so each finds its own post, or the nearest free hex if someone
    // not in the fight stands on it (a body takes up no room, so its post may have been walked onto); and
    // the heroes, so each finds its own free hex by the start.
    for (const f of band) {
      f.down = false;
      f.hp = f.maxHp;
      leaveFight(f);
      f.pos = { q: -99, r: -99 };
    }
    for (const h of heroes) h.pos = { q: -99, r: -99 };
    for (const f of band) {
      const post = f.home ?? was.get(f.id)!;
      f.pos = placeFor(state, f, post) ?? post;
    }
    for (const h of heroes) h.pos = freeHexNear(state.map, state.start, (p) => !!unitAt(state, p) || blockerAt(state, p), (p) => tileAt(state.map, p)) ?? state.start;
  }
  sweep(state);
  if (won && !state.units.some((u) => u.side === "enemy")) {
    ctx.events.push({ t: "cleared" });
    payBounty(ctx, heroes.find((h) => !h.controller && !h.down) ?? heroes[0]);
  }
  return true;
}

/**
 * Clear away enemies that have fallen and are in no fight, and the groups with nobody left. Each lies where it
 * fell from then on, as a body to be searched (loot.ts leaveBody).
 */
function sweep(state: ZoneState): void {
  const stays = (u: Unit) => u.side === "hero" || !u.down || inFight(state, u.id);
  for (const u of state.units) if (!stays(u)) leaveBody(state, u);
  state.units = state.units.filter(stays);
  for (const g of Object.keys(state.groups)) if (!state.units.some((u) => u.group === g)) delete state.groups[g];
}

/** Where in the order the turn just taken ends: at its last actor, or, if the one taking it fled, just before whoever came after them. */
function turnEnd(enc: Encounter): number {
  if (enc.acting.length > 0) return Math.max(...enc.acting.map((id) => enc.order.indexOf(id)));
  if (enc.resume === undefined) return -1;
  return enc.resume === null ? enc.order.length - 1 : Math.max(-1, enc.order.indexOf(enc.resume) - 1);
}

/** Move the fight on to whoever is next, playing enemy turns as they come, until a hero's turn or the end. */
function advance(ctx: Ctx): void {
  const { state } = ctx;
  for (let guard = 0; guard < 400; guard++) {
    const enc = state.encounter;
    if (!enc || settle(ctx)) return;
    for (const id of enc.acting) {
      const u = unitById(state, id);
      if (u) endTurn(ctx, u);
      // What AP it has not spent it keeps for its next turn (the movement it bought and did not walk is lost).
      const left = enc.budgets[id]?.ap ?? 0;
      if (left > 0 && u && !u.down) enc.banked = { ...enc.banked, [id]: Math.min(AP_MAX, left) };
    }
    let i = turnEnd(enc);
    delete enc.resume;
    enc.acting = [];
    enc.done = [];
    enc.budgets = {};
    const next: Unit[] = [];
    for (let looked = 0; next.length === 0 && looked <= enc.order.length; looked++) {
      i += 1;
      if (i >= enc.order.length) {
        i = 0;
        enc.round += 1;
        enc.reacted = [];
        delete enc.waits;
        ctx.events.push({ t: "round", n: enc.round });
        // Everyone not in the fight lives through the round as well (the clock stands still while one is on):
        // a hero who got away still burns and bleeds, and what is on them still runs down.
        for (const out of state.units.filter((u) => !enc.order.includes(u.id))) exploreRound(ctx, out);
        tickSurfaces(ctx);
        tickWeather(ctx);
        tickLights(ctx);
        // The noise carries: whoever is near enough to hear the fight comes to it.
        reinforce(ctx);
        // Perhaps one of them is sent to ring the alarm bell.
        pickBellGoer(ctx);
      }
      // One back in after fleeing on their turn this round waits for the next.
      const waiting = (u: Unit | undefined) => !u || u.down || !!enc.waits?.includes(u.id);
      const u = unitById(state, enc.order[i]);
      if (waiting(u)) continue;
      // A turn is one fighter's alone.
      next.push(u!);
      // (Unless the tests' switch is on: then heroes one after another in the order take their turns together.)
      while (state.shareTurns && u!.side === "hero" && i + 1 < enc.order.length && unitById(state, enc.order[i + 1])?.side !== "enemy") {
        i += 1;
        const also = unitById(state, enc.order[i]);
        if (!waiting(also)) next.push(also!);
      }
    }
    if (next.length === 0) {
      settle(ctx);
      return;
    }
    enc.turnNo += 1;
    enc.acting = next.map((u) => u.id);
    const ready = next.filter((u) => beginTurn(ctx, enc, u));
    enc.done = next.filter((u) => !ready.includes(u)).map((u) => u.id);
    if (settle(ctx)) return;
    if (ready.length === 0) continue;
    // In the sandbox an enemy's turn waits on the dev, as a hero's does.
    if (next[0].side === "enemy" && !state.sandbox) {
      // The bell, rung: the whole place is roused.
      if (enemyTurn(ctx, next[0], enc.budgets[next[0].id])) rouse(ctx, next[0]);
      enc.done = [next[0].id];
      continue;
    }
    ctx.events.push({ t: "turn", ids: ready.map((u) => u.id) });
    return;
  }
}

// ---------- actions ----------

/** The unit a player is acting as: their own hero, or a stand-in they control. In the combat sandbox, anyone in its fight. */
function mine(state: ZoneState, by: string, id: string): Unit | string {
  const unit = unitById(state, id);
  const sandboxed = !!unit && sandboxing(state, unit);
  if (!unit || (!sandboxed && (unit.side !== "hero" || (unit.id !== by && unit.controller !== by)))) return "That is not yours to move.";
  if (unit.down) return `${unit.name} is down.`;
  return unit;
}

/** In the combat sandbox, and in its fight: the dev may act as this unit whenever they like, for nothing. */
const sandboxing = (state: ZoneState, unit: Unit): boolean => !!state.sandbox && !!state.encounter?.order.includes(unit.id);

/**
 * In the combat sandbox, what everyone in the fight has to spend, every time: as much AP as a turn can hold, movement
 * bought as it would be at the start of a turn (stride, with nothing to hold an enemy to its usual walk), and every
 * ability ready. Put right after every action, so nothing is ever spent.
 */
function topUp(ctx: Ctx): void {
  const { state } = ctx;
  const enc = state.encounter;
  if (!state.sandbox || !enc) return;
  for (const u of state.units) {
    if (!enc.order.includes(u.id) || u.down) continue;
    const b = (enc.budgets[u.id] ??= { ap: AP_MAX, move: 0, stride: strideOf(state, u), disengaged: false });
    b.ap = AP_MAX;
    delete b.walk;
    u.cooldowns = {};
  }
}

/** What 1 AP of movement buys a unit, before anything that hastens or slows it. */
function strideOf(state: ZoneState, unit: Unit): number {
  return unit.summon && unit.side === "hero" ? (SUMMONS[unit.kind]?.move ?? 1) : unit.side === "hero" && unit.stats ? heroMove(unit.stats) : enemyMove(unit.kind, modsOf(state.options).move);
}

/** What `unit` has left this turn, if it is in a fight: an error if it is not its turn, null if it is in no fight. */
function budgetOf(state: ZoneState, unit: Unit): Budget | null | string {
  const enc = state.encounter;
  if (!enc || !enc.order.includes(unit.id)) return null;
  if (sandboxing(state, unit)) return enc.budgets[unit.id] ?? "It has nothing to spend.";
  if (!enc.acting.includes(unit.id) || enc.done.includes(unit.id)) return "It is not your turn.";
  return enc.budgets[unit.id] ?? "It is not your turn.";
}

/**
 * Spent out: no AP left, and no movement bought with it still to walk. A unit's turn ends on its own once it is, after
 * whatever it did has played out in full (stepZone), so nobody has to press End turn with nothing left to do.
 */
export const spentOut = (budget: Budget): boolean => budget.ap <= 0 && budget.move < 1 && (budget.course ?? 0) < 1;

/** Take `cost` AP from the budget, if there is one (out of a fight everything is free), or say why not. */
function spend(budget: Budget | null, cost: number): string | null {
  if (!budget) return null;
  if (budget.ap < cost) return `That takes ${cost} AP, and you have ${budget.ap} left.`;
  budget.ap -= cost;
  return null;
}

/** The highest level the dev tools put an enemy at (DevOp "spawn", "set_level"). */
export const ENEMY_DEV_MAX_LEVEL = 60;
const devLevel = (n: unknown, max = ENEMY_DEV_MAX_LEVEL): number => Math.max(1, Math.min(max, Math.floor(Number(n)) || 1));

/** The highest level a dev kit (DevOp "kit") will make a hero. */
export const KIT_MAX_LEVEL = 20;

function dev(ctx: Ctx, by: string, op: DevOp): string | null {
  const { state } = ctx;
  const free = (near: HexPos) => freeHexNear(state.map, near, (p) => !!unitAt(state, p) || blockerAt(state, p), (p) => tileAt(state.map, p));
  if (op.op === "spawn") {
    const kinds = op.kinds.filter((k) => ENEMIES[k]).slice(0, 6);
    if (kinds.length === 0 || solid(tileAt(state.map, op.at))) return "Nothing to put there.";
    const group = `g${++state.seq}`;
    state.groups[group] = { alerted: false };
    // The first goes on the hex clicked if the rules let it stand there (beside up to HEX_ROOM - 1 of its own side,
    // never with a hero); the rest spread out, each on a hex of its own.
    const first = roomAt(state, op.at, { id: "", side: "enemy" }) && !blockerAt(state, op.at) ? op.at : null;
    kinds.forEach((kind, i) => {
      const pos = (i === 0 && first) || free(op.at);
      if (!pos) return;
      const enemy = enemyUnit(state, kind, pos, group, op.level === undefined ? undefined : devLevel(op.level));
      // A big one goes where all of it has room, as near as there is.
      if (big(enemy)) {
        const room = placeFor(state, enemy, pos);
        if (!room) return;
        enemy.pos = enemy.home = room;
      }
      state.units.push(enemy);
    });
    // Put down where it can see a hero (by the rule a hero's step is noticed by): it is on them at once, starting a
    // fight if none is on, as if they had walked into its sight.
    const spotted = standing(state, "hero").find((h) => noticedBy(state, h).includes(group));
    if (spotted) engage(ctx, [group], { kind: "seen", by: spotted.id });
    // Put down near enough to a fight to hear it: it is in it at once, as it would be at the end of the round.
    reinforce(ctx, [group]);
  } else if (op.op === "paint") {
    const hexes = op.hexes.filter((p) => tileAt(state.map, p)).slice(0, 60);
    if (op.kind) placeSurface(ctx, hexes, op.kind, PAINT_ROUNDS, null);
    else clearSurfaces(ctx, hexes);
  } else if (op.op === "standin") {
    const owner = unitById(state, by);
    const hero = standInHero(op.classId, `s${++state.seq}`, owner?.level ?? state.options.level);
    const pos = free(owner?.pos ?? state.start);
    if (!hero || !pos) return "No room for a stand-in.";
    state.units.push(heroUnit(hero, pos, by));
    ctx.events.push({ t: "joined", id: hero.id });
  } else if (op.op === "heal") {
    for (const h of state.units.filter((u) => u.side === "hero")) {
      h.down = false;
      h.hp = h.maxHp;
      // Restocked: brought up to the starting kit, with anything more they carry left alone.
      for (const kind of THROWABLE_KINDS) if ((STARTING_ITEMS[kind] ?? 0) > (h.items[kind] ?? 0)) h.items[kind] = STARTING_ITEMS[kind];
      h.conditions = [];
      h.cooldowns = {};
    }
  } else if (op.op === "end_fight") {
    for (const f of state.units.filter((u) => u.side === "enemy" && inFight(state, u.id))) {
      f.hp = 0;
      f.down = true;
    }
  } else if (op.op === "start_fight") {
    const owner = unitById(state, by);
    const nearest = state.units
      .filter((u) => u.side === "enemy" && !u.down && u.group && !state.groups[u.group]?.alerted)
      .sort((a, b) => hexDistance(a.pos, owner?.pos ?? state.start) - hexDistance(b.pos, owner?.pos ?? state.start))[0];
    if (!owner || !nearest) return "There is nobody to fight.";
    engage(ctx, [nearest.group!], { kind: "seen", by: owner.id });
  } else if (op.op === "kit") {
    const u = unitById(state, op.unit);
    if (!u || u.side !== "hero" || u.summon || (u.id !== by && u.controller !== by)) return "That is not one of your heroes.";
    const weapon = WEAPONS[op.weapon];
    if (!weapon || (weapon.classId && weapon.classId !== op.classId)) return "That is not a weapon of that class.";
    const level = Math.max(1, Math.min(KIT_MAX_LEVEL, Math.floor(Number(op.level)) || 1));
    const sheet = standInHero(op.classId, u.id, level);
    if (!sheet) return "There is no such class.";
    const pool = new Set(poolFor(op.classId).map((e) => e.id));
    const abilities = withClassAbilities(weapon.abilities, op.abilities.filter((a) => pool.has(a)));
    const item = weaponItem(weapon.id);
    Object.assign(u, { kind: op.classId, level, stats: sheet.stats, maxHp: sheet.maxHp, hp: sheet.maxHp, cooldowns: {}, devKit: true });
    u.outfit = { ...u.outfit, main_hand: { icon: item.icon, ref: item.ref, rarity: item.rarity } };
    // A torch swung in the main hand stays there: the new weapon is what is taken up when it goes.
    if (u.torchHand === "main") u.stowed = abilities;
    else u.abilities = abilities;
  } else if (op.op === "ai") {
    state.aiOff = op.off;
  } else if (op.op === "heroes_idle") {
    if (op.on) state.heroesIdle = true;
    else delete state.heroesIdle;
  } else if (op.op === "sandbox") {
    if (op.on) {
      state.sandbox = true;
      return null;
    }
    delete state.sandbox;
    // Back to the fight's own flow: nobody carries the sandbox's AP on, and an enemy whose turn it was plays it now.
    const enc = state.encounter;
    if (enc) {
      delete enc.banked;
      for (const [id, b] of Object.entries(enc.budgets)) if (!enc.acting.includes(id)) delete enc.budgets[id];
    }
    const foe = enc?.acting.map((id) => unitById(state, id)).find((u) => u?.side === "enemy" && !u.down && !enc.done.includes(u.id));
    if (enc && foe && enc.budgets[foe.id]) {
      if (enemyTurn(ctx, foe, enc.budgets[foe.id])) rouse(ctx, foe);
      enc.done.push(foe.id);
    }
  } else if (op.op === "strike") {
    const foe = unitById(state, op.unit);
    if (!foe || foe.side !== "enemy" || foe.down || !sandboxing(state, foe)) return "Pick an enemy in the fight, in the sandbox.";
    const attack = unitStrike(state, foe, op.ability);
    if (!attack) return `${foe.name} has no such ability.`;
    const target = op.target ? unitById(state, op.target) : undefined;
    const why = checkStrike(state, foe, attack, { target, at: op.at }, op.anywhere);
    if (why) return why;
    enemyAct(ctx, foe, attack, target ?? null, op.at);
  } else if (op.op === "place") {
    const u = unitById(state, op.unit);
    if (!u || u.down) return "There is nobody standing to put there.";
    // All of a big one (geometry.ts span) has to have room.
    if (span(u, op.at).some((p) => solid(tileAt(state.map, p)) || blockerAt(state, p) || !roomAt(state, p, u))) return "There is no room there.";
    const from = u.pos;
    u.pos = { q: op.at.q, r: op.at.r };
    ctx.events.push({ t: "blinked", id: u.id, from, to: u.pos });
  } else if (op.op === "set_level") {
    const u = unitById(state, op.unit);
    if (!u || u.side !== "enemy" || u.summon || !sandboxing(state, u)) return "Pick an enemy in the fight, in the sandbox.";
    // As hurt as it was, as a share of its health: what it can do is worked out from its level as it is used (kit.ts).
    const level = devLevel(op.level);
    const maxHp = enemyMaxHp(state, u.kind, level);
    if (!u.down) u.hp = Math.max(1, Math.min(maxHp, Math.round((u.hp / Math.max(1, u.maxHp)) * maxHp)));
    Object.assign(u, { level, maxHp });
  } else if (op.op === "hero_levels") {
    // Every hero on the map at this level, their class, weapon and abilities as they are; whole. As a dev kit, it holds
    // through a reload and leaves the characters themselves as they are.
    const level = devLevel(op.level, KIT_MAX_LEVEL);
    for (const u of state.units) {
      if (u.side !== "hero" || u.summon) continue;
      const sheet = standInHero(u.kind, u.id, level);
      if (!sheet) continue;
      Object.assign(u, { level, stats: sheet.stats, maxHp: sheet.maxHp, devKit: true });
      if (!u.down) u.hp = sheet.maxHp;
    }
  } else if (op.op === "set_turn") {
    const enc = state.encounter;
    const u = unitById(state, op.unit);
    if (!enc || !state.sandbox || !u || !enc.order.includes(u.id)) return "Pick someone in the fight, in the sandbox.";
    if (u.down) return `${u.name} is down.`;
    if (enc.acting.includes(u.id)) return null;
    // Their turns over, and the fight moved on from just before this one (Encounter.resume), so theirs is the next.
    for (const id of enc.acting) {
      const was = unitById(state, id);
      if (was) endTurn(ctx, was);
    }
    enc.acting = [];
    enc.done = [];
    enc.budgets = {};
    enc.resume = u.id;
    advance(ctx);
  } else if (op.op === "next_turn") {
    const enc = state.encounter;
    if (!enc) return "There is no fight on.";
    // A round: on until the turn comes back round to whoever has it now (or, theirs passed over, to whoever is next after them).
    const round = enc.round;
    const from = enc.order.indexOf(enc.acting[0]);
    for (let turns = 0; state.encounter === enc && turns < (op.round ? enc.order.length * 2 : 1); turns++) {
      enc.done = [...enc.acting];
      advance(ctx);
      if (op.round && enc.round > round && (enc.round > round + 1 || enc.order.indexOf(enc.acting[0]) >= from)) break;
    }
  } else if (op.op === "undying") {
    if (op.on) state.undying = true;
    else delete state.undying;
  } else if (op.op === "timer") {
    if (op.off) state.timerOff = true;
    else delete state.timerOff;
  } else if (op.op === "clear_enemies") {
    // Gone, not killed: no bodies, nothing to loot, no XP. A fight they were in is won with nobody left in it (settle).
    state.units = state.units.filter((u) => u.side !== "enemy");
    for (const g of Object.keys(state.groups)) if (!state.units.some((u) => u.group === g)) delete state.groups[g];
  } else if (op.op === "clear_surfaces") {
    clearSurfaces(ctx, Object.keys(state.surfaces).map((key) => ({ q: Number(key.split(",")[0]), r: Number(key.split(",")[1]) })));
    // And everything there is to loot: the bodies of the fallen, open chests' contents, the spoils. (One who falls in a
    // fight still on lies where they fell until it is over, and is a body then.)
    delete state.loot;
  }
  return null;
}

/**
 * Where a hero's last walk is called off, for a new walk clicked while it is still being played on screen: `from`, the
 * hex the client says they have got to. Only out of a fight, only for a walk that nothing came of and that is the last
 * thing they did, only to a hex on it, and only while it could still be playing. Null leaves them where they are.
 */
function cutShort(state: ZoneState, unit: Unit, from: HexPos | undefined, now: number | undefined): HexPos | null {
  const last = state.strolls?.[unit.id];
  if (!from || !last || last.path.length === 0 || inFight(state, unit.id)) return null;
  if (!sameHex(unit.pos, last.path[last.path.length - 1])) return null;
  if (now !== undefined && now > last.at + last.path.length * STROLL_STEP_MS + STROLL_GRACE_MS) return null;
  const on = sameHex(from, last.from) || last.path.some((p) => sameHex(p, from));
  if (!on || blockerAt(state, from) || state.units.some((u) => u.id !== unit.id && !isDead(u) && sameHex(u.pos, from))) return null;
  return { q: from.q, r: from.r };
}

/**
 * Keep a hero's walk, for the next to call off part of the way (cutShort), if nothing came of it but the walk: no
 * notice taken, no fight, nothing underfoot. Anything else they do forgets it.
 */
function keepStroll(state: ZoneState, action: ZoneAction, events: readonly ZoneEvent[], was: HexPos | undefined): void {
  if (!("unit" in action)) return;
  const id = action.unit;
  const plain = action.type === "move" && events.length > 0 && events.every((ev) => ev.t === "moved" && ev.id === id);
  const unit = unitById(state, id);
  if (state.strolls) delete state.strolls[id];
  if (!plain || !unit || !was || inFight(state, id)) {
    if (state.strolls && Object.keys(state.strolls).length === 0) delete state.strolls;
    return;
  }
  const moved = events as Extract<ZoneEvent, { t: "moved" }>[];
  const from = moved[0].cut ?? was;
  const path = moved.flatMap((ev) => ev.path).filter((p) => !sameHex(p, from));
  if (path.length === 0) return;
  (state.strolls ??= {})[id] = { from, path, at: action.type === "move" ? (action.now ?? 0) : 0 };
}

function act(ctx: Ctx, action: ZoneAction): string | null {
  const { state } = ctx;
  if (action.type === "away") {
    for (const u of state.units) {
      if (u.side !== "hero" || (u.id !== action.player && u.controller !== action.player)) continue;
      if (action.away) u.away = true;
      else delete u.away;
    }
    return null;
  }
  if (action.type === "join") {
    const hero = action.hero;
    // No more than the map takes at once: a hero who is here already (their gear read again) is not arriving.
    const was = unitById(state, hero.id);
    const present = (u: Unit) => u.side === "hero" && !u.summon && !u.away;
    if ((!was || was.away) && state.units.filter(present).length >= MAX_PARTY) return MAP_FULL;
    // Back on the map: their hero, and the stand-ins they play, are here again.
    for (const u of state.units) if (u.id === hero.id || u.controller === hero.id) delete u.away;
    const here = unitById(state, hero.id);
    if (here) {
      // What their pack holds is what they carry, fight or no fight.
      if (hero.items) here.items = { ...hero.items };
      // Come back in a party, or on their own.
      if (hero.party !== undefined) {
        if (hero.party) here.party = hero.party;
        else delete here.party;
      }
      // Luck brought back from the well is added to whatever they still had.
      if (hero.luck && hero.luck > 0 && !here.down) {
        const held = here.conditions.find((c) => c.kind === "lucky");
        if (held) Object.assign(held, { rounds: UNTIMED_KEEPS, amount: usesLeft(held) + hero.luck });
        else here.conditions.push({ kind: "lucky", rounds: UNTIMED_KEEPS, amount: hero.luck });
      }
      // Back again, perhaps with different gear: the sheet is refreshed, and where they stand and how hurt they are is kept.
      // Not in a fight, though: that is fought in the gear it was started in. Nor a hero given a dev kit.
      if (inFight(state, here.id) || here.devKit) return null;
      Object.assign(here, { name: hero.name, kind: hero.classId, level: hero.level, stats: hero.stats, armor: hero.armor, power: hero.weaponPower, outfit: hero.outfit, lantern: hero.lantern, perks: hero.perks, maxHp: hero.maxHp });
      // A torch swung in the main hand stays there: the new weapon is what is taken up when it goes.
      if (here.torchHand === "main") here.stowed = heroAbilities(hero);
      else here.abilities = heroAbilities(hero);
      here.hp = Math.min(here.hp, here.maxHp);
      return null;
    }
    // Teleported to a crewmate: beside them, unless they have since got into a fight.
    const friend = action.near ? unitById(state, action.near) : undefined;
    const beside = friend && friend.side === "hero" && !inFight(state, friend.id) ? friend.pos : state.start;
    const pos = freeHexNear(state.map, beside, (p) => !!unitAt(state, p) || blockerAt(state, p), (p) => tileAt(state.map, p));
    if (!pos) return "There is no room to arrive.";
    state.units.push(heroUnit(hero, pos));
    ctx.events.push({ t: "joined", id: hero.id });
    // A bigger party than the map was made for: the groups not yet beaten grow to meet it.
    growGroups(state);
    return null;
  }
  if (action.type === "timeout") {
    if (state.encounter) state.encounter.done = [...state.encounter.acting];
    return null;
  }
  if (action.type === "time") {
    passTime(ctx, action.now);
    return null;
  }
  if (action.type === "stock") {
    const hero = unitById(state, action.unit);
    if (hero?.side === "hero") hero.items = cleanItems(action.items);
    return null;
  }
  if (action.type === "dev") return dev(ctx, action.by, action.dev);

  const unit = mine(state, action.by, action.unit);
  if (typeof unit === "string") return unit;
  const budget = budgetOf(state, unit);
  if (typeof budget === "string") return budget;

  if (action.type === "end_turn") {
    if (!budget) return "There is no turn to end.";
    state.encounter!.done.push(unit.id);
    return null;
  }
  if (action.type === "move") {
    // Clicked again while the last walk is still being played: it stops where it had got to, and this one sets off from there.
    const cut = budget ? null : cutShort(state, unit, action.from, action.now);
    const mark = ctx.events.length;
    if (cut) unit.pos = cut;
    if (sameHex(action.to, unit.pos)) {
      // Called off on the very hex asked for: the walk ends there, and everyone is told so.
      if (cut) ctx.events.push({ t: "moved", id: unit.id, path: [cut], cut });
      return null;
    }
    // Only the hex asked for and the way to it are read, so the flood stops at it (zoneReach `enough`).
    const reach = zoneReach(state, unit, budget ? moveLeft(budget) : FREE_WALK, undefined, courseFor(state, unit, budget), (r) => sameHex(r.pos, action.to));
    const end = reach.get(posKey(action.to));
    if (!end) return noWayThere(state, unit, action.to) ?? (budget ? "You cannot get there with the AP you have left." : "You cannot get there.");
    if (!end.stop) return "Someone is standing there.";
    walk(ctx, unit, pathIn(reach, action.to) ?? [], budget);
    if (cut) {
      const first = ctx.events.slice(mark).find((ev) => ev.t === "moved" && ev.id === unit.id);
      if (first?.t === "moved") first.cut = cut;
      else ctx.events.splice(mark, 0, { t: "moved", id: unit.id, path: [cut], cut });
    }
    return null;
  }
  if (action.type === "use") {
    const def = ABILITIES[action.ability];
    const tactic = tacticOf(action.ability);
    const aim = { target: action.target, at: action.at, lean: action.lean };
    const wrong = checkAbility(state, unit, action.ability, aim);
    if (wrong) return wrong;
    // Something that takes a shape can catch a group that had not noticed anyone: it has now. A mark on the map touches nobody.
    const area = new Set(tactic.chart ? [] : abilityArea(state, unit, action.ability, action.at, action.target, action.lean).map(posKey));
    const touched = state.units.filter((u) => u.id === action.target || caught(u, area));
    const back = reachBack(state, unit, touched);
    if (back) return back;
    // Out of a fight too: there its cooldown runs down a round at a time on the clock (clock.ts).
    if ((unit.cooldowns[action.ability] ?? 0) > 0) return `${def.name} is not ready yet.`;
    const cost = spend(budget, tactic.cost);
    if (cost) return cost;
    if (tactic.cooldown) unit.cooldowns[action.ability] = tactic.cooldown;
    // A heal splashed among enemies is a kindness, as a healing potion thrown is: it starts nothing.
    const struck = tactic.splash ? [] : touched.filter((u) => u.side === "enemy" && !u.down).map((u) => u.group!);
    ctx.opening = opens(state, struck, touched);
    resolveAbility(ctx, unit, action.ability, aim);
    ctx.opening = false;
    engage(ctx, struck, { kind: "struck", by: unit.id });
    reachIn(ctx, unit, touched);
    shedOutside(state, [unit, ...touched]);
    return null;
  }
  if (action.type === "common") {
    const aim = { target: action.target, at: action.at };
    const wrong = checkCommon(state, unit, action.what, aim, budget);
    if (wrong) return wrong;
    const target = action.what === "shove" || action.what === "help" ? unitById(state, action.target!) : undefined;
    const back = reachBack(state, unit, target ? [target] : []);
    if (back) return back;
    const cost = spend(budget, commonCostFor(unit, action.what, action.what === "jump" && isBlink(state, unit, aim.at)));
    if (cost) return cost;
    const struck = action.what === "shove" && target?.group ? [target.group] : [];
    ctx.opening = !!target && opens(state, struck, [target]);
    doCommon(ctx, unit, action.what, aim, budget);
    ctx.opening = false;
    engage(ctx, struck, { kind: "struck", by: unit.id });
    if (target) reachIn(ctx, unit, [target]);
    shedOutside(state, [unit, ...(target ? [target] : [])]);
    if (action.what === "flee") flee(ctx, unit);
    return null;
  }
  if (action.type === "drink") {
    const wrong = checkDrink(unit, action.item);
    if (wrong) return wrong;
    const cost = spend(budget, ITEM_AP.drink);
    if (cost) return cost;
    drinkItem(ctx, unit, action.item);
    return null;
  }
  if (action.type === "pickup") {
    const wrong = checkPickup(state, unit, action.at);
    if (wrong) return wrong;
    // Out of a fight it is free; in one, it takes AP, like lighting one.
    const cost = spend(budget, ITEM_AP.pickup);
    if (cost) return cost;
    pickUpTorch(ctx, unit, action.at);
    return null;
  }
  if (action.type === "open") {
    const chest = state.map.pois.find((p) => p.id === action.poi && p.kind === "cache");
    const wrong = checkOpen(state, unit, chest);
    if (wrong) return wrong;
    const cost = spend(budget, ITEM_AP.open);
    if (cost) return cost;
    openChest(ctx, unit, chest!);
    // Out of a fight, whoever opened it is looking into it.
    const spot = state.loot?.find((s) => s.id === chest!.id);
    if (spot && !checkLoot(state, unit, spot)) {
      look(ctx, unit, spot);
      ctx.events.push({ t: "looked", id: unit.id, spot: spot.id });
    }
    return null;
  }
  if (action.type === "loot" || action.type === "take") {
    const spot = state.loot?.find((s) => s.id === action.spot);
    const wrong = checkLoot(state, unit, spot);
    if (wrong) return wrong;
    if (action.type === "take") return take(ctx, unit, spot!, { index: action.index, uid: action.uid });
    // A body: the others beside it are gone through with it (lootGroup), all in the one window.
    for (const s of lootGroup(state, spot!)) if (!checkLoot(state, unit, s)) look(ctx, unit, s);
    ctx.events.push({ t: "looked", id: unit.id, spot: spot!.id });
    return null;
  }
  if (action.type === "forage") {
    const patch = state.map.pois.find((p) => p.id === action.poi && p.kind === "glowcap");
    const wrong = checkForage(state, unit, patch);
    if (wrong) return wrong;
    const cost = spend(budget, ITEM_AP.forage);
    if (cost) return cost;
    forage(ctx, unit, patch!);
    return null;
  }
  if (action.type === "unlock") {
    const door = state.map.pois.find((p) => p.id === action.poi && p.kind === "gate");
    const wrong = checkUnlock(state, unit, door);
    if (wrong) return wrong;
    const cost = spend(budget, ITEM_AP.unlock);
    if (cost) return cost;
    // A key is quiet. Forcing it is heard, whether the door gives or not: the nearest band that has not noticed anyone comes.
    const { forced } = workDoor(ctx, unit, door!);
    const heard = forced ? heardBy(state, door!.pos) : undefined;
    if (heard) engage(ctx, [heard], { kind: "noise", by: unit.id });
    return null;
  }
  if (action.type === "light") {
    const wrong = checkLight(unit);
    if (wrong) return wrong;
    const cost = spend(budget, ITEM_AP.light);
    if (cost) return cost;
    lightTorch(ctx, unit, action.hand);
    return null;
  }
  if (action.type === "stow") {
    const wrong = checkStow(unit);
    if (wrong) return wrong;
    // Like lighting one: free out of a fight, AP in one.
    const cost = spend(budget, ITEM_AP.stow);
    if (cost) return cost;
    stowTorch(ctx, unit);
    return null;
  }
  // Throw.
  const wrong = checkThrow(state, unit, action.item, action.at);
  if (wrong) return wrong;
  const def = THROWABLES[action.item];
  const area = new Set(blast(state.map, action.at, def.radius).map(posKey));
  const touched = state.units.filter((u) => caught(u, area));
  const back = reachBack(state, unit, touched);
  if (back) return back;
  const cost = spend(budget, ITEM_AP.throw);
  if (cost) return cost;
  // A healing potion among enemies is a kindness; anything else is a declaration.
  const struck = def.heal ? [] : touched.filter((u) => u.side === "enemy" && !u.down).map((u) => u.group!);
  ctx.opening = opens(state, struck, touched);
  throwItem(ctx, unit, action.item, action.at);
  ctx.opening = false;
  engage(ctx, struck, { kind: "struck", by: unit.id });
  reachIn(ctx, unit, touched);
  shedOutside(state, [unit, ...touched]);
  return null;
}

export function stepZone(prev: ZoneState, action: ZoneAction): ZoneStep {
  // Everything is copied but the map's tiles, which are most of a state's weight: no step changes a tile where it
  // lies (a door that opens is given a new array with a new tile in it: doors.ts), so the next state can share them,
  // and what is reckoned once from them (map.ts tilesByKey, geometry.ts sightBlockers) is kept from step to step.
  const state: ZoneState = structuredClone({ ...prev, map: { ...prev.map, tiles: [] } });
  state.map.tiles = prev.map.tiles;
  const ctx: Ctx = { state, rng: makeRng(state.rng), events: [] as ZoneEvent[], effects: [] as ZoneEffect[] };
  ctx.onStep = (unit, flush) => onStep(ctx, unit, flush);
  const was = "unit" in action ? unitById(state, action.unit)?.pos : undefined;
  topUp(ctx);
  const error = act(ctx, action);
  if (error) return { ok: false, error };
  pullIn(ctx);
  // Out of a fight nobody stays down: a hero who falls to the ground alone gets back up on 1 HP.
  for (const h of state.units.filter((u) => u.side === "hero" && u.down && !inFight(state, u.id))) {
    h.down = false;
    h.hp = 1;
    h.conditions = [];
    ctx.events.push({ t: "up", id: h.id });
  }
  const enc = state.encounter;
  if (enc && !settle(ctx)) {
    // Its last AP spent, the unit that acted has had its turn.
    const id = "unit" in action ? action.unit : undefined;
    const left = id ? enc.budgets[id] : undefined;
    if (id && left && enc.acting.includes(id) && !enc.done.includes(id) && spentOut(left) && !state.sandbox) enc.done.push(id);
    const waiting = enc.acting.some((id) => !enc.done.includes(id) && !unitById(state, id)?.down);
    if (!waiting) advance(ctx);
  }
  // A called creature that has fallen is gone.
  for (const u of state.units.filter((x) => x.summon && x.down)) dismiss(ctx, u);
  topUp(ctx);
  // A band beaten that carried a key: it goes on the ring.
  dropKeys(ctx);
  sweep(state);
  keepStroll(state, action, ctx.events, was);
  state.rng = ctx.rng.state();
  return { ok: true, state, events: ctx.events, effects: ctx.effects };
}
