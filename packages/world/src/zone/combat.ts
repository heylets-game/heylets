// What units do: walk (and get struck at as they leave an enemy's reach),
// use an ability, take one of the common actions, throw something, and,
// for an enemy, make one of its attacks. Each has a check, which says in
// words why it cannot be done, and the doing. Costs and turns are the
// reducer's business (zone.ts); nothing here spends AP but walking. A hero's
// blows, blasts and bombs reach crates too (crates.ts).

import { hexDistance, hexNeighbors, hexSegment, posKey, type HexPos } from "@gantt-quest/core";
import { ABILITIES, BARD_AURA, ENEMIES, onlyInFights, type AbilityDef, type EffectKind } from "../content";
import { tileAt, type Poi } from "../map";
import { DEBUFFS, UNTIMED_KEEPS, attackMade, addCondition, addUses, addShield, addStacks, inflict, attackContext, attackRoll, damage, defenceOf, giveAway, has, heal, inWater, removeCondition, saveBonus, saveRoll, shieldOf, shieldUnit, strikeDown, unseen, type Ctx } from "./engine";
import { cratesOn, crateById, hurtCrate, isCrateId } from "./crates";
import { ENEMY_ABILITIES } from "./enemyabilities";
import { bearing, big, caught, close, blast, blockerAt, courseShare, covers, directionToward, gap, gapTo, meet, nearOf, reaches, ringToward, elevOf, fetterBars, flies, heldAgainst, inFight, lineFrom, pathIn, perkOf, pitAt, reachFrom, roomAt, roomFor, sameHex, sees, seesFor, solid, span, stepCost, strikes, unitById, zoneReach, type Course, type Pit } from "./geometry";
import { ACTION_AP, CHART, COMMON_ACTIONS, CORAL_ARMOR, ENEMY_EDGE, RALLY, SHANTY, SUMMON_CALLS, ENEMY_BURST, FLEE_RANGE, JUMP_DOWN, JUMP_UP, blinkRange, jumpRange, POTION_EDGE, SAVE_STAT, SMUGGLED, SPLASH_SHARE, THROWABLES, TORCH_GROUND_ROUNDS, abilityDice, abilityStrikes, enemySave, retortDice, unitStrikes, healDice, reactionStrike, tacticOf, throwRange, type EnemyAttackKit, type EnemyStrike, type Tactic } from "./kit";
import { modsOf } from "./mods";
import { d20, diceFor, hitChance, mod, proficiency, rollDice, rollShown, statOf } from "./rules";
import { seenByHeroes } from "./light";
import { HARMFUL, HINDERING, chill, clearSurfaces, dropTorch, enterSurface, ignite, letGoTorch, placeSurface } from "./surfaces";
import type { Budget, CommonAction, Throwable, Unit, ZoneState } from "./types";
import { clusterHexes, enterWeather, makeQuake, makeWeather, quakeHexes, rainHexes, wallHexes } from "./weather";
import { callKin, summonCall, summonSpots } from "./summon";
import { layCurse, drown } from "./drowning";
import { SHANTIES, joinable, shantyOf, songDamage, songMove, windward } from "./song";
import { constellationHexes, constellationLinks, courseMarks, litFoes } from "./stars";

/** How near a Bard has to be for their tune to help. */
export const BARD_AURA_RANGE = 3;
/** What a thrown bomb's blast is saved against. */
const THROW_SAVE = 12;

export interface Aim {
  target?: string;
  at?: HexPos;
}

// ---------- walking ----------

/**
 * Whether stepping from `from` to `next` (its anchor's, for a big one) takes `walker` out of the reach of `foe`: they
 * could strike it where it is, and cannot where it is going.
 */
export const leavesReach = (state: Pick<ZoneState, "map">, foe: Unit, walker: Unit, from: HexPos, next: HexPos): boolean =>
  reaches(state.map, foe, walker, foe.pos, from) && !reaches(state.map, foe, walker, foe.pos, next);

/**
 * Enemies within reach of `unit` that it is about to step out of reach of strike at it, if they still have
 * their reaction. Disengaged, it slips away untouched.
 */
function provoke(ctx: Ctx, unit: Unit, next: HexPos, budget: Budget | null, flush: () => void): void {
  const enc = ctx.state.encounter;
  // Nobody strikes at what they cannot see.
  // Soft-Sole Sneaks: away without a sound, as if Disengaged.
  if (!enc || !inFight(ctx.state, unit.id) || budget?.disengaged || unseen(unit) || perkOf(unit, "light_step") > 0) return;
  for (const foe of ctx.state.units) {
    if (unit.down) return;
    if (foe.side === unit.side || foe.down || !inFight(ctx.state, foe.id)) continue;
    if (!leavesReach(ctx.state, foe, unit, unit.pos, next)) continue;
    if (enc.reacted.includes(foe.id) || has(foe, "stunned") || has(foe, "prone")) continue;
    const blow = foe.side === "enemy" ? unitStrikes(ctx.state, foe).find((s) => s.range === 1 && !s.burst) : undefined;
    if (foe.side === "enemy" && !blow) continue;
    flush();
    enc.reacted.push(foe.id);
    ctx.events.push({ t: "reaction", id: foe.id, target: unit.id });
    if (blow) enemyAct(ctx, foe, blow, unit);
    else {
      const ability = reactionStrike(foe.abilities);
      strike(ctx, foe, ABILITIES[ability], tacticOf(ability), unit);
      // A blow of opportunity is an attack too: a Rally goes into it, and it spends a use of any spur (SPURS).
      removeCondition(foe, "rallied");
      attackMade(ctx, foe);
    }
  }
}

/**
 * If a unit's hex has no room for it (it was stopped part-way through one full of its own side), it shuffles to the
 * nearest that has: no cliff climbed or dropped to get there, and not by way of a hex the other side holds.
 */
function standClear(ctx: Ctx, unit: Unit): void {
  // A big one only ever stops where all of it has room (geometry.ts stepCost).
  if (big(unit) ? roomFor(ctx.state, unit, unit.pos) : roomAt(ctx.state, unit.pos, unit)) return;
  if (big(unit)) return;
  const seen = new Set([posKey(unit.pos)]);
  const queue = [unit.pos];
  for (let i = 0; i < queue.length && i < 60; i++) {
    for (const n of hexNeighbors(queue[i], ctx.state.map.grid)) {
      if (seen.has(posKey(n))) continue;
      seen.add(posKey(n));
      if (solid(tileAt(ctx.state.map, n)) || blockerAt(ctx.state, n) || heldAgainst(ctx.state, n, unit.side) || Math.abs(elevOf(ctx.state.map, n) - elevOf(ctx.state.map, queue[i])) >= 2) continue;
      if (roomAt(ctx.state, n, unit)) {
        unit.pos = n;
        ctx.events.push({ t: "moved", id: unit.id, path: [n] });
        return;
      }
      queue.push(n);
    }
  }
}

/**
 * The AP `budget` can still put into movement this turn, keeping `back` of them for something else: all the rest
 * of them, or as many of those as it is still allowed (Budget.walk: an enemy's ENEMY_MOVE_AP).
 */
export const walkAp = (budget: Budget, back = 0): number => Math.max(0, Math.min(budget.ap - back, budget.walk ?? Infinity));

/** Movement `budget` can still cover this turn: what is bought, and what its AP would buy. */
export const moveLeft = (budget: Budget): number => budget.move + walkAp(budget) * budget.stride;

/** Spend 1 AP on movement: a stride more, and a course charted's share with it. False if there is nothing to buy it with. */
function buyStride(budget: Budget, course?: Course): boolean {
  if (walkAp(budget) <= 0 || budget.stride <= 0) return false;
  budget.ap -= 1;
  if (budget.walk !== undefined) budget.walk -= 1;
  budget.move += budget.stride;
  if (budget.course !== undefined) {
    budget.course += CHART.speed;
    if (course) course.left = budget.course;
  }
  return true;
}

/** The AP a walk costing `cost` movement would buy, on top of the movement already bought. Infinity if it cannot buy any. */
export const apForMove = (budget: Budget, cost: number): number =>
  cost <= budget.move ? 0 : budget.stride > 0 ? Math.ceil((cost - budget.move) / budget.stride) : Infinity;

/** Take `cost` movement from a budget as a walk would, buying strides with AP as it needs them (for a client foreseeing a walk). */
export function payMove(budget: Budget, cost: number): void {
  while (budget.move < cost && buyStride(budget));
  budget.move = Math.max(0, budget.move - cost);
}

/**
 * Walk a unit along a path, a step at a time. Each step may draw an opportunity attack, costs
 * movement (when there is a budget: bought with AP as it is needed, a stride at a time), and lands
 * the unit on whatever the ground holds. The walk stops when the unit falls, slips, runs out of
 * movement and AP, or walks into a fight.
 */
export function walk(ctx: Ctx, unit: Unit, path: HexPos[], budget: Budget | null): void {
  let taken: HexPos[] = [];
  // A course charted: steps nearer a mark spend its movement first.
  const marks = budget?.course !== undefined ? courseMarks(ctx.state, unit) : [];
  const course: Course | undefined = marks.length > 0 ? { marks, left: budget!.course! } : undefined;
  const flush = () => {
    if (taken.length > 0) ctx.events.push({ t: "moved", id: unit.id, path: taken });
    taken = [];
  };
  for (const next of path) {
    if (unit.down) break;
    const step = stepCost(ctx.state, unit, unit.pos, next);
    if (!Number.isFinite(step.cost)) break;
    const shareOf = () => (course ? courseShare(course, unit.pos, next, step.cost) : 0);
    while (budget && step.cost - shareOf() > budget.move && buyStride(budget, course));
    const share = shareOf();
    if (budget && step.cost - share > budget.move) break;
    provoke(ctx, unit, next, budget, flush);
    if (unit.down) break;
    unit.pos = next;
    if (budget) budget.move -= step.cost - share;
    if (course && share > 0) course.left = budget!.course = course.left - share;
    taken.push(next);
    if (enterSurface(ctx, unit, flush) || unit.down) break;
    enterWeather(ctx, unit);
    if (ctx.onStep?.(unit, flush)) break;
  }
  flush();
  standClear(ctx, unit);
}

/**
 * The course charted for `unit` to walk this turn, if one is: what of its movement is bought and left, and what its AP would
 * buy. For zoneReach, with moveLeft, to say how far the unit can still get (walk spends it).
 */
export function courseFor(state: ZoneState, unit: Unit, budget: Budget | null | undefined): Course | undefined {
  if (!budget || budget.course === undefined) return undefined;
  const left = budget.course + (budget.stride > 0 ? walkAp(budget) * CHART.speed : 0);
  const marks = left > 0 ? courseMarks(state, unit) : [];
  return marks.length > 0 ? { marks, left } : undefined;
}

/**
 * A unit has come down from `from` to where it stands now. A drop of more than `safe` levels hurts: a d4 for each
 * level past that, and it lands flat on the ground. Shoved off a height it was not ready for any of it (`safe` 1);
 * leaping down, the first `JUMP_DOWN` levels are its own doing.
 */
export function tumble(ctx: Ctx, unit: Unit, from: HexPos, by: string | null, safe = 1): void {
  const drop = elevOf(ctx.state.map, from) - elevOf(ctx.state.map, unit.pos);
  if (drop <= safe || unit.down || flies(unit)) return;
  ctx.events.push({ t: "fell", id: unit.id, levels: drop });
  const rolled = rollShown(ctx.rng, { n: drop - safe, d: 4, plus: 0 });
  damage(ctx, unit, rolled.total, { actor: by, what: "fall", dice: rolled });
  addCondition(ctx, unit, "prone", 1);
}

/** What a save to catch the edge is rolled against when nothing says otherwise: a thrown thing, the ground giving way. */
export const EDGE_DC = 12;

/** What whoever `by` shoves must roll to catch the edge of a drop or a pit: harder against the strong, and against a boss's shove. */
export function edgeDc(by: Unit | undefined): number {
  if (!by) return EDGE_DC;
  if (by.side === "hero") return 10 + Math.max(0, mod(statOf(by, "str"))) + Math.floor(proficiency(by.level) / 2);
  return 10 + enemySave(by.kind) + ENEMY_EDGE;
}

/**
 * How a unit made to move a hex fared: it went, it went over an edge and fell, it caught the edge and stayed, something
 * was in the way, it is lost to a pit, or it is too heavy to be moved at all (a big one: geometry.ts span).
 */
export type Shift = "moved" | "fell" | "held" | "blocked" | "lost" | "heavy";

/**
 * Whether `target` is too heavy for anything to move it by force (bigger than a hex). If it is, that is told (`heavy`),
 * so the picture can say why it did not budge.
 */
export function tooHeavy(ctx: Ctx, target: Unit): boolean {
  if (!big(target)) return false;
  ctx.events.push({ t: "heavy", id: target.id });
  return true;
}

/**
 * Where a forced move from `from` onto `to` would put `who`: on open ground (`open`), over a drop of two levels or
 * more (`drop`), into a pit (`pit`: deep water, lava, or off the edge of the land), or nowhere, something being in
 * the way: rock, a wall, a cliff face going up, or a hex with no room on it for them: one their enemies hold, or
 * one full of their own side (`null`).
 */
export function shiftInto(state: ZoneState, from: HexPos, to: HexPos, who?: Unit): { how: "open" | "drop"; levels: number } | { how: "pit"; pit: Pit } | null {
  const pit = pitAt(state.map, to);
  if (pit) return who && flies(who) ? (pit === "void" ? null : { how: "open", levels: 0 }) : { how: "pit", pit };
  if (solid(tileAt(state.map, to)) || blockerAt(state, to) || !roomAt(state, to, who)) return null;
  const levels = elevOf(state.map, from) - elevOf(state.map, to);
  if (levels <= -2) return null;
  return levels >= 2 && !(who && flies(who)) ? { how: "drop", levels } : { how: "open", levels };
}

/**
 * Move `target` one hex onto `dest` by force (a shove, a blast, a wave, a hook). Toward a drop of two levels or
 * more, or a pit, it first rolls to catch the edge (Agility, against `dc`; a boss with advantage): made, it stays
 * where it is. Failed, it goes over: down a drop it falls (tumble), and into a pit it is lost (sink). `by` is
 * whoever is doing it. Says what became of it; the caller says what a blocked way means.
 */
export function shift(ctx: Ctx, target: Unit, dest: HexPos, by: string, dc?: number): Shift {
  const { state } = ctx;
  if (tooHeavy(ctx, target)) return "heavy";
  const into = shiftInto(state, target.pos, dest, target);
  if (!into) return "blocked";
  const was = target.pos;
  if (into.how !== "open") {
    const boss = target.side === "enemy" && !!ENEMIES[target.kind]?.boss;
    const vs = dc ?? edgeDc(unitById(state, by));
    const roll = d20(ctx.rng, { kind: "save", id: target.id, label: "Catch the edge", bonus: saveBonus(target, "agi"), vs, adv: has(target, "prone") || has(target, "stunned") ? (boss ? 0 : -1) : boss ? 1 : 0 });
    ctx.events.push({ t: "roll", roll });
    if (roll.ok) {
      ctx.events.push({ t: "held", id: target.id, at: dest });
      return "held";
    }
  }
  if (into.how === "pit") {
    sink(ctx, target, dest, into.pit, by);
    return "lost";
  }
  target.pos = dest;
  ctx.events.push({ t: "shoved", id: by, target: target.id, from: was, to: dest });
  if (into.how === "drop") {
    tumble(ctx, target, was, by);
    return "fell";
  }
  return "moved";
}

/**
 * Someone goes into a pit: deep water, lava, or over the edge of the land. An enemy is gone for good, with whatever
 * it carried. A hero (or what a hero called) is hauled back to the brink they went over, down, to be got up again
 * like anyone who has fallen.
 */
export function sink(ctx: Ctx, unit: Unit, into: HexPos, pit: Pit, by: string | null): void {
  ctx.events.push({ t: "sunk", id: unit.id, by, from: unit.pos, into, pit });
  if (unit.side === "enemy") unit.lost = pit;
  strikeDown(ctx, unit);
}

/**
 * Where a shove from `from` would send someone standing at `at`: the hex straight away from the shover (who is
 * never on the same hex: the two sides do not share one).
 */
export function shoveDest(from: HexPos, at: HexPos): HexPos {
  const dir = directionToward(from, at);
  return { q: at.q + dir.q, r: at.r + dir.r };
}

/**
 * Knock `target` one hex directly away from `from`. Against a wall, a cliff face, a hex its enemies hold or one full
 * of its own side it takes a knock and falls Prone instead. Toward a drop or a pit it may catch the edge; if it does
 * not, it goes over (shift).
 */
export function push(ctx: Ctx, from: HexPos, target: Unit, by: string): Shift {
  const dest = shoveDest(from, target.pos);
  const went = shift(ctx, target, dest, by);
  if (went === "heavy") return went;
  if (went === "blocked") {
    ctx.events.push({ t: "shoved", id: by, target: target.id, from: target.pos, to: null });
    const rolled = rollShown(ctx.rng, { n: 1, d: 4, plus: 0 });
    damage(ctx, target, rolled.total, { actor: by, what: "shove", dice: rolled });
    addCondition(ctx, target, "prone", 1);
  } else if ((went === "moved" || went === "fell") && !target.down) {
    enterSurface(ctx, target);
    enterWeather(ctx, target);
  }
  return went;
}

/**
 * Overwhelm: an attack with Strength that does no harm (as a Shove). On a hit, it is driven straight back from the user, a hex at a time,
 * up to `hexes`. Driven into what nobody can pass (rock, a wall, a chest, a cliff face) it is Stunned; into somebody (a hex its
 * enemies hold, or one full of its own side), it just stops; over an edge, it falls (unless it catches the edge), and that ends the
 * drive. Returns whether it hit.
 */
function overwhelm(ctx: Ctx, unit: Unit, def: AbilityDef, target: Unit, opts: { hexes: number; stun: number }): boolean {
  const { state } = ctx;
  const roll = attackRoll(ctx, unit, target, { label: def.name, bonus: proficiency(unit.level) + mod(statOf(unit, def.stat)), melee: true });
  if (!roll.ok) {
    ctx.events.push({ t: "miss", actor: unit.id, target: target.id, what: def.id });
    return false;
  }
  const dir = directionToward(unit.pos, target.pos);
  for (let i = 0; i < opts.hexes && !target.down; i++) {
    const dest = { q: target.pos.q + dir.q, r: target.pos.r + dir.r };
    const full = !pitAt(state.map, dest) && !solid(tileAt(state.map, dest)) && !blockerAt(state, dest) && elevOf(state.map, dest) - elevOf(state.map, target.pos) < 2 && !roomAt(state, dest, target);
    const went = shift(ctx, target, dest, unit.id);
    if (went === "heavy") return true;
    if (went === "blocked") {
      if (!full || i === 0) ctx.events.push({ t: "shoved", id: unit.id, target: target.id, from: target.pos, to: null });
      if (!full) addCondition(ctx, target, "stunned", opts.stun);
      return true;
    }
    if (went !== "moved") return true;
    // Ground that trips it (ice) ends the drive there.
    if (enterSurface(ctx, target) || target.down) return true;
    enterWeather(ctx, target);
  }
  return true;
}

/**
 * Drag `target` up to `hexes` straight toward `unit`, stopping beside them or at anything in the way, which a hex
 * the puller's side holds is (Throw Pike). Dragged over an edge, it falls.
 */
function pull(ctx: Ctx, unit: Unit, target: Unit, hexes: number): void {
  if (sameHex(target.pos, unit.pos)) return;
  const dir = directionToward(target.pos, unit.pos);
  for (let i = 0; i < hexes && !target.down; i++) {
    const dest = { q: target.pos.q + dir.q, r: target.pos.r + dir.r };
    if (sameHex(dest, unit.pos)) return;
    const went = shift(ctx, target, dest, unit.id);
    // Each hex of a drag is told with how far along it is, so it is drawn as one haul.
    const told = [...ctx.events].reverse().find((e) => e.t === "shoved" && e.target === target.id);
    if (told && told.t === "shoved" && (went === "moved" || went === "fell")) told.pulled = i + 1;
    if (went !== "moved") return;
    // Ground that trips it (ice) ends the drag there.
    if (enterSurface(ctx, target) || target.down) return;
    enterWeather(ctx, target);
  }
}

/** Carry a unit along `line` from where it stands toward the far end, as far as the way is open: over an edge or into a pit, if that is where the line goes. */
function sweepAlong(ctx: Ctx, target: Unit, line: HexPos[], by: string): void {
  if (tooHeavy(ctx, target)) return;
  const from = line.findIndex((p) => sameHex(p, target.pos));
  // Across open ground it is one sweep, told as one: as far along the line as the way is level and open.
  let dest = target.pos;
  let j = from + 1;
  for (; j < line.length; j++) {
    const into = shiftInto(ctx.state, dest, line[j], target);
    if (!into || into.how !== "open") break;
    dest = line[j];
  }
  if (!sameHex(dest, target.pos)) {
    const was = target.pos;
    target.pos = dest;
    ctx.events.push({ t: "shoved", id: by, target: target.id, from: was, to: dest });
    if (enterSurface(ctx, target) || target.down) return;
    enterWeather(ctx, target);
  }
  // And then, if the line goes on over an edge or into a pit (or ends at the water's edge, or the land's): so does the wave.
  let over: HexPos | null = j < line.length ? line[j] : null;
  const last = line[line.length - 1];
  if (!over && last && sameHex(target.pos, last) && line.length >= 2) {
    const before = line[line.length - 2];
    over = { q: last.q + (last.q - before.q), r: last.r + (last.r - before.r) };
    if (!pitAt(ctx.state.map, over)) over = null;
  }
  if (!over || target.down) return;
  const into = shiftInto(ctx.state, target.pos, over, target);
  if (!into || into.how === "open") return;
  if (shift(ctx, target, over, by) === "fell" && !target.down) {
    enterSurface(ctx, target);
    enterWeather(ctx, target);
  }
}

/** Open ground `who` could be put down on: a floor, nothing built on it, and room for them to stand (roomAt: with nobody named, nobody there at all). */
const standable = (state: ZoneState, pos: HexPos, who?: Unit): boolean => !!tileAt(state.map, pos) && !solid(tileAt(state.map, pos)) && !blockerAt(state, pos) && roomAt(state, pos, who);

/** Why `unit` cannot blink (Smuggler's Route, Tactical Retreat) to `at`, `range` hexes at most, or null if it can. Nothing between counts. */
function blinkWrong(state: ZoneState, unit: Unit, at: HexPos | undefined, range: number): string | null {
  if (!at || sameHex(at, unit.pos) || !tileAt(state.map, at)) return "Pick a hex to go to.";
  if (hexDistance(unit.pos, at) > range) return "Too far.";
  if (fetterBars(unit, unit.pos, at)) return "The chain will not reach.";
  return standable(state, at, unit) ? null : "There is nowhere to stand there.";
}

/**
 * Where an ally beside `unit` arrives when it is taken along to `dest`: beside it, on the same side of it as they
 * stood of `unit` if that is open, else the open hex nearest that. The hexes the two of them are leaving count as
 * open. Null if there is no room beside `dest`.
 */
export function carrySpot(state: ZoneState, unit: Unit, ally: Unit, dest: HexPos): HexPos | null {
  const want = { q: dest.q + ally.pos.q - unit.pos.q, r: dest.r + ally.pos.r - unit.pos.r };
  const leaving = (p: HexPos) => sameHex(p, unit.pos) || sameHex(p, ally.pos);
  const open = hexNeighbors(dest, state.map.grid).filter((p) => leaving(p) ? !solid(tileAt(state.map, p)) : standable(state, p, ally));
  return open.sort((a, b) => hexDistance(a, want) - hexDistance(b, want) || a.q - b.q || a.r - b.r)[0] ?? null;
}

/** Put a unit on another hex at once, crossing nothing: no blows drawn on the way, only the ground where it lands. */
function blinkTo(ctx: Ctx, unit: Unit, to: HexPos, phase = false): void {
  if (sameHex(unit.pos, to)) return;
  const from = unit.pos;
  unit.pos = to;
  ctx.events.push({ t: "blinked", id: unit.id, from, to, ...(phase ? { phase: true as const } : {}) });
  if (!enterSurface(ctx, unit) && !unit.down) enterWeather(ctx, unit);
}

/** Lead by Example: the user's ally nearest the target (not the user) gets a stack of Inspired: advantage on a roll to hit. */
function inspireNearest(ctx: Ctx, unit: Unit, target: Unit): void {
  const ally = ctx.state.units
    .filter((u) => u.side === unit.side && u.id !== unit.id && !u.down)
    .sort((a, b) => hexDistance(a.pos, target.pos) - hexDistance(b.pos, target.pos) || a.id.localeCompare(b.id))[0];
  if (ally) addUses(ctx, ally, "inspired", 1);
}

/** Pickpocket: gold equal to the user's level, from an enemy whose pockets are not picked yet. A stand-in shows it but banks none. */
function pocket(ctx: Ctx, unit: Unit, target: Unit): void {
  if (target.picked || target.side !== "enemy") return;
  target.picked = true;
  const gold = Math.max(1, unit.level);
  if (!unit.controller) ctx.effects.push({ type: "grant", heroId: unit.id, xp: 0, resources: {}, gold });
  ctx.events.push({ t: "spoils", id: unit.id, xp: 0, resources: {}, gold });
}

// ---------- a hero's abilities ----------

/**
 * The hexes an ability covers, for one that takes a shape: what is lit up before it is used, and what it then hits.
 * `target`: the ally an ability that reaches round an ally (North Star) is used on.
 */
export function abilityArea(state: ZoneState, unit: Unit, ability: string, at?: HexPos, target?: string): HexPos[] {
  const tactic = tacticOf(ability);
  if (tactic.constellation) return constellationHexes(state, unit);
  if (tactic.newMoon) return litFoes(state, unit).map((u) => u.pos);
  if (tactic.northStar) {
    const ally = target ? unitById(state, target) : unit;
    return ally ? [ally.pos, ...hexNeighbors(ally.pos, state.map.grid)] : [];
  }
  if (tactic.weather === "rain") return at ? rainHexes(state, unit.pos, at) : [];
  if (tactic.fortify) return at && !sameHex(at, unit.pos) ? wallHexes(state, unit.pos, at) : [];
  if (tactic.splash) return at ? clusterHexes(state, unit.pos, at, tactic.splash.hexes) : [];
  if (tactic.cluster) return at ? clusterHexes(state, unit.pos, at, tactic.cluster) : [];
  if (tactic.shape === "blast") return at ? blast(state.map, at, tactic.radius ?? 1) : [];
  // Round the user, their own hex left out: it is thrown at the enemy, and no enemy ever stands there.
  if (tactic.shape === "burst") return blast(state.map, unit.pos, tactic.radius ?? 1).filter((p) => !sameHex(p, unit.pos));
  if (tactic.shape === "line") return at ? lineFrom(state.map, unit.pos, at, tactic.length ?? 3) : [];
  if (tactic.shape === "adjacent") return hexNeighbors(unit.pos, state.map.grid);
  if (tactic.shape === "arc") return at && !sameHex(at, unit.pos) ? arcHexes(state, unit.pos, at) : [];
  if (tactic.shape === "cone") return at && !sameHex(at, unit.pos) ? coneHexes(state, unit.pos, at, tactic.length ?? 3) : [];
  return [];
}

/** Adds `more` to each AP of a unit's movement for the rest of its turn, if it is in the middle of one in a fight. Says whether it was. */
function moveMore(state: ZoneState, unit: Unit, more: number): boolean {
  const enc = state.encounter;
  const budget = enc && enc.acting.includes(unit.id) && !enc.done.includes(unit.id) ? enc.budgets[unit.id] : undefined;
  if (!budget) return false;
  if (budget.stride > 0) budget.stride += more;
  return true;
}

/**
 * A cone's hexes: 1 hex out from `from`, then 2 beyond it, then 3, as far as `length` rows, each row the hexes of its
 * ring round `from` nearest the straight line through `toward`. So it points whichever way it is aimed, a sixth of the
 * way round wide, and always the same size. What a wall or a corner hides from `from` is left out.
 */
export function coneHexes(state: ZoneState, from: HexPos, toward: HexPos, length: number): HexPos[] {
  const aim = bearing(from, toward);
  const out: HexPos[] = [];
  for (let row = 1; row <= length; row++) {
    for (const p of ringToward(from, row, aim, row)) {
      if (tileAt(state.map, p) && !solid(tileAt(state.map, p)) && sees(state.map, from, p)) out.push(p);
    }
  }
  return out;
}

/** A swing's three hexes: the one beside `from` toward `toward`, and the two beside both it and `from`. */
export function arcHexes(state: ZoneState, from: HexPos, toward: HexPos): HexPos[] {
  const dir = directionToward(from, toward);
  const middle = { q: from.q + dir.q, r: from.r + dir.r };
  return hexNeighbors(from, state.map.grid).filter((p) => hexDistance(p, middle) <= 1);
}

/**
 * A sweep's hexes: `rows` arcs of three, one behind the other, swung from `from` toward `toward`. The first is the
 * arc beside it (arcHexes); each next is the three hexes one further out round the hex straight ahead, as far as it
 * can see.
 */
export function sweepHexes(state: ZoneState, from: HexPos, toward: HexPos, rows: number): HexPos[] {
  const dir = directionToward(from, toward);
  const out = arcHexes(state, from, toward);
  for (let k = 2; k <= rows; k++) {
    const middle = { q: from.q + dir.q * k, r: from.r + dir.r * k };
    const row = [middle, ...hexNeighbors(middle, state.map.grid)].filter((p) => hexDistance(p, from) === k && tileAt(state.map, p) && sees(state.map, from, p));
    out.push(...row);
  }
  return out;
}

/**
 * A dash's way (EnemyAbilityDef `dash`), from `from` toward `toward`: the straight line of up to `length` hexes out
 * (lineFrom: it stops at rock and the map's edge), cut short before anything in the way that cannot be passed (a crate,
 * a chest) or, for one that does not fly, ground too high to spring up onto from the hex before. It comes to rest on the
 * furthest hex of what is left that it can stand on (`land`), and `through` is every hex before that. Null: there is
 * nowhere on the line to come to rest.
 */
export function dashWay(state: ZoneState, unit: Unit, from: HexPos, toward: HexPos, length: number): { through: HexPos[]; land: HexPos } | null {
  const line: HexPos[] = [];
  let level = elevOf(state.map, from);
  for (const p of lineFrom(state.map, from, toward, length)) {
    const tile = tileAt(state.map, p);
    if (!tile || solid(tile) || blockerAt(state, p)) break;
    if (!flies(unit) && elevOf(state.map, p) > level + JUMP_UP) break;
    level = elevOf(state.map, p);
    line.push(p);
  }
  for (let i = line.length - 1; i >= 0; i--) if (standable(state, line[i], unit)) return { through: line.slice(0, i), land: line[i] };
  return null;
}

/**
 * The hexes an enemy ability that lands on several at once (EnemyAbilityDef `area`, `blast`, `sweep`, `cone`, `line`) covers,
 * used from `from` and aimed at `at`: everyone of the other side on them saves for half, with no roll to hit. Null for
 * one of any other shape.
 */
export function spreadHexes(state: ZoneState, kit: EnemyAttackKit, from: HexPos, at: HexPos): HexPos[] | null {
  if (kit.area) return clusterHexes(state, from, at, kit.area);
  if (kit.blast) return blast(state.map, at, kit.blast).filter((p) => !!tileAt(state.map, p));
  if (sameHex(from, at)) return kit.sweep || kit.cone || kit.line ? [] : null;
  if (kit.sweep) return sweepHexes(state, from, at, kit.sweep);
  if (kit.cone) return coneHexes(state, from, at, kit.cone);
  if (kit.line) return lineFrom(state.map, from, at, kit.line);
  return null;
}

/** Whether an enemy ability lands on several hexes at once (spreadHexes), and so is aimed at a hex, not at anyone. */
export const spreads = (kit: EnemyAttackKit): boolean => !!(kit.area || kit.blast || kit.sweep || kit.cone || kit.line);

/** Why `unit` cannot use this ability on this aim, in words, or null if it can. */
export function checkAbility(state: ZoneState, unit: Unit, ability: string, aim: Aim): string | null {
  const def = ABILITIES[ability];
  if (!def || !unit.abilities.includes(ability)) return "You do not have that ability.";
  // Out of a fight, one for fights alone (onlyInFights) can still go to a friend in one, and so join it (zone.ts reachIn).
  if (onlyInFights(def) && !inFight(state, unit.id) && !(aim.target && inFight(state, aim.target))) return FIGHTS_ONLY;
  const tactic = tacticOf(ability);
  // A big one is in reach if any of its hexes is: said for the nearest of them if none is.
  const reachUnit = (target: Unit): string | null => {
    const tries = span(target).sort((a, b) => hexDistance(unit.pos, a) - hexDistance(unit.pos, b)).map(inReach);
    return tries.includes(null) ? null : tries[0];
  };
  const inReach = (pos: HexPos): string | null => {
    const dist = hexDistance(unit.pos, pos);
    if (tactic.reach === "melee") {
      if (dist > 1) return "Too far: you have to be next to it.";
      return strikes(state.map, unit.pos, pos) ? null : elevOf(state.map, pos) > elevOf(state.map, unit.pos) ? "It is out of reach up there: climb up to it, or find a ladder." : "It is out of reach down there: climb down to it, or find a ladder.";
    }
    if (dist > reachFrom(state.map, unit.pos, pos, tactic.range)) return "Out of range.";
    return sees(state.map, unit.pos, pos) ? null : "There is no clear line to it.";
  };
  if (tactic.shape === "single" || tactic.shape === "chain") {
    // A crate: a hero can break it with anything that does damage. It is in plain view, lit or not.
    if (isCrateId(state, aim.target)) {
      const crate = crateById(state, aim.target);
      if (!crate) return "It is broken already.";
      if (unit.side !== "hero") return "Pick an enemy.";
      if (!def.damage) return "That does no harm to a crate.";
      return inReach(crate.pos);
    }
    const target = aim.target ? unitById(state, aim.target) : undefined;
    if (!target || target.down || target.side === unit.side) return "Pick an enemy.";
    if (unit.side === "hero" && !seenByHeroes(state, target)) return "It is too dark to make it out: bring a light, or get beside it.";
    // A blow and then away: where to is checked now, and nothing about the blow can take the hex.
    return reachUnit(target) ?? (tactic.blink && aim.at ? blinkWrong(state, unit, aim.at, tactic.blink.range) : null);
  }
  if (tactic.shape === "arc") {
    if (!aim.at || sameHex(aim.at, unit.pos)) return "Pick which way to swing.";
    const keys = new Set(arcHexes(state, unit.pos, aim.at).map(posKey));
    if (state.units.some((u) => u.side !== unit.side && !u.down && span(u).some((p) => keys.has(posKey(p)) && strikes(state.map, unit.pos, p)))) return null;
    return unit.side === "hero" && def.damage && cratesBeside(state, unit).some((c) => keys.has(posKey(c.pos))) ? null : "No enemy is in that swing.";
  }
  if (tactic.shape === "adjacent") {
    if (state.units.some((u) => u.side !== unit.side && !u.down && reaches(state.map, unit, u))) return null;
    return unit.side === "hero" && def.damage && cratesBeside(state, unit).length > 0 ? null : "No enemy is next to you.";
  }
  // A course is charted by the stars, not by sight: any hex in range will do, seen or not.
  if (tactic.chart) {
    if (!aim.at || !tileAt(state.map, aim.at)) return "Pick a hex to mark.";
    return hexDistance(unit.pos, aim.at) > tactic.range ? "Out of range." : null;
  }
  if (tactic.shape === "blast") {
    if (!aim.at || !tileAt(state.map, aim.at)) return "Pick a hex.";
    // A wall goes up on open ground: the hex aimed at has to be one somebody could stand on.
    if (tactic.fortify && (sameHex(aim.at, unit.pos) || !standable(state, aim.at) || state.units.some((u) => covers(u, aim.at!)))) return "There is no room to raise a wall there.";
    return inReach(aim.at);
  }
  if (tactic.shape === "line" || tactic.shape === "cone") return aim.at && !sameHex(aim.at, unit.pos) ? null : "Pick a direction.";
  if (tactic.shape === "ally") {
    const target = aim.target ? unitById(state, aim.target) : unit;
    if (!target || target.side !== unit.side) return "Pick an ally.";
    return target.id === unit.id ? null : reachUnit(target);
  }
  if (tactic.constellation) return constellationLinks(state, unit).length > 0 ? null : `No ally of yours is within ${tactic.constellation.link} hexes, in clear sight, to link to.`;
  if (tactic.newMoon) return litFoes(state, unit).length > 0 ? null : "No enemy is lit by Guiding Light.";
  if (tactic.taunt) return foesWithin(state, unit, tactic.taunt.range).length > 0 ? null : tactic.taunt.range === 1 ? "No enemy in the fight is beside you." : `No enemy in the fight is within ${tactic.taunt.range} hexes of you.`;
  if (tactic.summon) {
    if (!state.encounter || !inFight(state, unit.id)) return "That is for a fight.";
    if (!aim.at || sameHex(aim.at, unit.pos) || !tileAt(state.map, aim.at)) return "Pick a hex to call it to.";
    const many = SUMMON_CALLS[tactic.summon].length > 1;
    return inReach(aim.at) ?? (summonSpots(state, unit, tactic.summon, aim.at) ? null : many ? "There is no room for them all there." : "There is nowhere for it to stand there.");
  }
  if (tactic.blink) {
    const wrong = blinkWrong(state, unit, aim.at, tactic.blink.range);
    if (wrong || !aim.target || aim.target === unit.id) return wrong;
    const ally = unitById(state, aim.target);
    if (!tactic.blink.carry || !ally || ally.side !== unit.side) return "Pick an ally beside you to take along.";
    if (!close(ally.pos, unit.pos)) return `${ally.name} has to be beside you to come along.`;
    return carrySpot(state, unit, ally, aim.at!) ? null : `There is no room there for ${ally.name} to arrive.`;
  }
  return null;
}

/** How far afield Show the Way looks for a way to walk to the ally, in steps of open ground. */
const WAY_SEARCH = 30;

/**
 * The hexes `unit` would walk to get to `to`, both ends included: the way the walk itself takes, but over the
 * ground as it would be with nothing lying on it (oil and slime slow the walk, so it would steer round the very
 * stuff Show the Way is to clear). With no way on foot (a cliff, say), the straight line between.
 */
export function wayBetween(state: ZoneState, unit: Unit, to: HexPos): HexPos[] {
  // Only the way to `to` is read, so the flood stops at it (zoneReach `enough`).
  const path = pathIn(zoneReach({ ...state, surfaces: {} }, unit, WAY_SEARCH, undefined, undefined, (r) => sameHex(r.pos, to)), to);
  return path ? [unit.pos, ...path] : hexSegment(unit.pos, to);
}

/** What a hero adds to an ability's damage: their stat, their weapon, half their level, and a Bard's tune if one is near. */
function damageBonus(state: ZoneState, unit: Unit, def: AbilityDef): number {
  const tune = state.units.some((u) => u.id !== unit.id && u.side === unit.side && u.kind === "frontend_bard" && !u.down && hexDistance(u.pos, unit.pos) <= BARD_AURA_RANGE) ? BARD_AURA : 0;
  // A torch swung in the hand hits with the torch, not the weapon put away for it.
  return mod(statOf(unit, def.stat)) + (def.id === "torch_swing" ? 0 : unit.power) + Math.floor(unit.level / 2) + tune + songDamage(state, unit) + (has(unit, "rallied") ? RALLY.damage : 0);
}

const saveDc = (unit: Unit, def: AbilityDef): number => 8 + proficiency(unit.level) + mod(statOf(unit, def.stat));

/** Why an ability for fights alone (onlyInFights) cannot be used out of one. */
export const FIGHTS_ONLY = "That is for a fight.";

/** The conditions an ability leaves on a target it has got through to. */
function afflict(ctx: Ctx, unit: Unit, def: AbilityDef, target: Unit, save: boolean): void {
  if (target.down) return;
  if (def.saveOr) {
    const effect = def.saveOr.effect;
    if (!save || !saveRoll(ctx, target, SAVE_STAT[effect], saveDc(unit, def), `Resist ${def.name}`).ok) inflict(ctx, target, def.saveOr);
  }
  if (def.targetEffect && !target.down) inflict(ctx, target, def.targetEffect);
}

/** One attack roll with an ability against one target. Returns whether it landed. */
function strike(ctx: Ctx, unit: Unit, def: AbilityDef, tactic: Tactic, target: Unit): boolean {
  const melee = tactic.reach === "melee";
  const roll = attackRoll(ctx, unit, target, { label: def.name, bonus: proficiency(unit.level) + mod(statOf(unit, def.stat)) + (tactic.toHit ?? 0), melee });
  if (!roll.ok) {
    ctx.events.push({ t: "miss", actor: unit.id, target: target.id, what: def.id });
    return false;
  }
  let more = damageBonus(ctx.state, unit, def);
  if (tactic.vsWet && has(target, "wet")) more += tactic.vsWet;
  if (tactic.edge && roll.adv === 1) more += tactic.edge;
  if (tactic.wading && inWater(ctx.state, unit)) more += tactic.wading;
  if (tactic.bulwark) more += Math.floor(shieldOf(unit) * tactic.bulwark.perShield);
  const rolled = rollShown(ctx.rng, abilityDice(def), more, roll.crit);
  const dealt = damage(ctx, target, rolled.total, { actor: unit.id, what: def.id, crit: roll.crit, dice: rolled });
  if (def.drain && dealt > 0 && !unit.down) heal(ctx, unit, Math.max(1, Math.round(dealt * def.drain)), { actor: unit.id, what: def.id });
  // A Warlock's critical hits drag the target under (Riptide).
  if (roll.crit && unit.kind === "data_warlock") drown(ctx, target, 1);
  afflict(ctx, unit, def, target, true);
  if (tactic.guide && !target.down && (!tactic.guideSave || !saveRoll(ctx, target, SAVE_STAT.guiding_light, saveDc(unit, def), `Resist ${def.name}`).ok)) addCondition(ctx, target, "guiding_light", tactic.guide);
  if (tactic.drowns && !target.down && !saveRoll(ctx, target, SAVE_STAT.drowning, saveDc(unit, def), `Resist ${def.name}`).ok) drown(ctx, target, tactic.drowns);
  if (tactic.goad && !target.down && !saveRoll(ctx, target, SAVE_STAT.taunted, saveDc(unit, def), `Resist ${def.name}`).ok) {
    // Taunted afresh, by whoever did it last.
    removeCondition(target, "taunted");
    addCondition(ctx, target, "taunted", tactic.goad);
    const c = target.conditions.find((x) => x.kind === "taunted");
    if (c) c.by = unit.id;
  }
  if (tactic.kindleLit && !target.down && has(target, "guiding_light")) addStacks(ctx, target, "burning");
  // Water Burst: the drench reaches whoever stands beside the target, no roll to hit.
  if (tactic.spray) {
    for (const foe of ctx.state.units.filter((u) => u.id !== target.id && u.side !== unit.side && !u.down && gap(u, target) <= 1)) {
      const splash = rollShown(ctx.rng, diceFor(Math.max(2, tactic.spray - 2)), damageBonus(ctx.state, unit, def));
      damage(ctx, foe, splash.total, { actor: unit.id, what: def.id, dice: splash });
    }
  }
  if (melee) thorns(ctx, unit, target);
  // On a big one, what it leaves goes on the hex of it nearest the one who struck.
  const struck = nearOf(target, unit.pos);
  if (tactic.ignites) ignite(ctx, struck, unit.id);
  if (tactic.surface) placeSurface(ctx, tactic.surface.self ? [struck, unit.pos] : [struck], tactic.surface.kind, tactic.surface.rounds, unit.id);
  return true;
}

/** Binding Kelp: no blow and no roll to hit, but the enemy saves or is held: Slowed, or Stunned if it stands in water. */
function bind(ctx: Ctx, unit: Unit, def: AbilityDef, target: Unit, turns: { slowed: number; stunned: number }): boolean {
  const effect = inWater(ctx.state, target) ? "stunned" : "slowed";
  if (!saveRoll(ctx, target, SAVE_STAT[effect], saveDc(unit, def), `Resist ${def.name}`).ok) addCondition(ctx, target, effect, turns[effect]);
  return true;
}

/**
 * Coral Armor, Barnacle Mail, and an enemy's own retort (a slime's Acid Armor): whoever lands a blow up close on one
 * wearing it is hurt by it. A retort bites back even from one the blow has just killed.
 */
function thorns(ctx: Ctx, attacker: Unit, target: Unit): void {
  if (attacker.down) return;
  const retort = target.side === "enemy" ? ENEMIES[target.kind]?.retort : undefined;
  if (retort) {
    const rolled = rollShown(ctx.rng, retortDice(retort, target.level, modsOf(ctx.state.options).edge));
    damage(ctx, attacker, rolled.total, { actor: target.id, what: retort.name, dice: rolled });
    if (attacker.down) return;
  }
  if (has(target, "coral_armor")) {
    const rolled = rollShown(ctx.rng, CORAL_ARMOR.thorns);
    damage(ctx, attacker, rolled.total, { actor: target.id, what: "coral_armor", dice: rolled });
  }
  const barbs = perkOf(target, "thorns");
  if (barbs > 0 && !attacker.down) damage(ctx, attacker, barbs, { actor: target.id, what: "thorns" });
}

/** The crates beside a unit. */
const cratesBeside = (state: ZoneState, unit: Unit) => cratesOn(state, hexNeighbors(unit.pos, state.map.grid));

/**
 * A hero's ability at a crate. It cannot dodge, so there is no roll: the damage lands, never as a
 * critical hit. Fire lights what will catch under it, and what an ability leaves on the ground is left there.
 */
function smash(ctx: Ctx, unit: Unit, def: AbilityDef, tactic: Tactic, crate: Poi): void {
  hurtCrate(ctx, crate, rollDice(ctx.rng, abilityDice(def)) + damageBonus(ctx.state, unit, def), { actor: unit.id, what: def.id });
  if (tactic.ignites) ignite(ctx, crate.pos, unit.id);
  if (tactic.surface) placeSurface(ctx, [crate.pos], tactic.surface.kind, tactic.surface.rounds, unit.id);
}

/**
 * What a hero breaks a crate with when it is simply clicked: the first of their abilities that does damage
 * to one target for ACTION_AP, is ready, and reaches it from where they stand, a blow by hand before a shot
 * or a spell. Null if nothing they have reaches it.
 */
export function crateBlow(state: ZoneState, unit: Unit, crateId: string): string | null {
  const fits = unit.abilities.filter((a) => {
    const t = tacticOf(a);
    return ABILITIES[a]?.damage && t.shape === "single" && t.cost === ACTION_AP && !(unit.cooldowns[a] > 0) && !checkAbility(state, unit, a, { target: crateId });
  });
  return fits.find((a) => tacticOf(a).reach === "melee") ?? fits[0] ?? null;
}

/**
 * What an attack with this ability on this target would be rolled with, before it is made: the chance
 * to hit and why. Null for abilities that are saved against, or that land without a roll, rather than rolled to hit.
 */
export function previewAttack(state: ZoneState, unit: Unit, ability: string, target: Unit): { chance: number; bonus: number; vs: number; adv: -1 | 0 | 1; notes: string[] } | null {
  const def = ABILITIES[ability];
  const tactic = tacticOf(ability);
  if (!def || !["single", "chain", "adjacent", "arc"].includes(tactic.shape) || tactic.overwhelm || tactic.sure || tactic.bind) return null;
  const c = attackContext(state, unit, target, { melee: tactic.reach === "melee" });
  const bonus = proficiency(unit.level) + mod(statOf(unit, def.stat)) + (tactic.toHit ?? 0) + c.mods;
  const vs = defenceOf(target, state);
  return { chance: hitChance(bonus, vs, c.adv), bonus, vs, adv: c.adv, notes: c.notes };
}

/** Use an ability that has passed its check. Says what was used, then rolls and applies it. */
export function resolveAbility(ctx: Ctx, unit: Unit, ability: string, aim: Aim): void {
  const def = ABILITIES[ability];
  const tactic = tacticOf(ability);
  const { state } = ctx;
  ctx.events.push({ t: "used", id: unit.id, what: ability, name: def.name, target: aim.target, at: aim.at });
  const foes = () => state.units.filter((u) => u.side !== unit.side && !u.down);
  // Unseen, any ability gives the user away once it is done (bar going Unseen again, or a pocket picked unseen).
  const wasUnseen = unseen(unit);
  // Rallied (Hornpipe): the next ability that does harm gets the bonus, on everything it strikes, and uses it up.
  const rallied = has(unit, "rallied") && !!def.damage;
  let landed = false;
  const crate = tactic.shape === "single" || tactic.shape === "chain" ? crateById(state, aim.target) : undefined;
  if (crate) {
    if (tactic.bulwark) addShield(ctx, unit, tactic.bulwark.shield + unit.level);
    if (tactic.ward) addShield(ctx, unit, tactic.ward.shield + unit.level);
    // Aimed at a crate, a chain goes no further: there is nothing in a crate for it to jump from.
    smash(ctx, unit, def, tactic, crate);
    landed = true;
  } else if (tactic.weather) {
    makeWeather(ctx, tactic.weather, abilityArea(state, unit, ability, aim.at), unit);
    landed = true;
  } else if (tactic.splash) {
    // Healing for the caster's side alone, the fallen got up with it; then the water, which soaks whoever is there.
    const area = abilityArea(state, unit, ability, aim.at);
    const keys = new Set(area.map(posKey));
    const amount = rollDice(ctx.rng, healDice(def)) + Math.max(0, mod(statOf(unit, def.stat))) + Math.floor(unit.level / 2);
    for (const u of state.units.filter((x) => x.side === unit.side && caught(x, keys))) heal(ctx, u, amount, { actor: unit.id, what: def.id });
    placeSurface(ctx, area, "water", tactic.splash.water, unit.id);
    landed = true;
  } else if (tactic.summon) {
    for (const called of summonCall(ctx, unit, tactic.summon, aim.at!)) if (!called.down) ctx.onStep?.(called, () => {});
    landed = true;
  } else if (tactic.chart) {
    // One mark at a time: the new one takes the old one's place.
    removeCondition(unit, "charted");
    addCondition(ctx, unit, "charted", tactic.chart.rounds);
    const mark = unit.conditions.find((c) => c.kind === "charted");
    if (mark) mark.at = { q: aim.at!.q, r: aim.at!.r };
    chartCourse(ctx, unit);
    landed = true;
  } else if (tactic.constellation) {
    // The links pass harmlessly over the user's side; every enemy on one is struck once and lit, however many cross it.
    const keys = new Set(abilityArea(state, unit, ability).map(posKey));
    const rolled = rollShown(ctx.rng, abilityDice(def), damageBonus(state, unit, def));
    for (const victim of foes().filter((u) => caught(u, keys))) {
      damage(ctx, victim, rolled.total, { actor: unit.id, what: def.id, dice: rolled });
      if (!victim.down) addCondition(ctx, victim, "guiding_light", tactic.guide ?? 0);
    }
    landed = true;
  } else if (tactic.newMoon) {
    // Every light put out at once, each for a blow that cannot be dodged.
    const lit = litFoes(state, unit);
    const rolled = rollShown(ctx.rng, abilityDice(def), damageBonus(state, unit, def));
    for (const victim of lit) removeCondition(victim, "guiding_light");
    for (const victim of lit) damage(ctx, victim, rolled.total, { actor: unit.id, what: def.id, dice: rolled });
    landed = true;
  } else if (tactic.redSky) {
    // An omen, not a blow: no roll and no save, and only the other side reads it.
    const keys = new Set(abilityArea(state, unit, ability, aim.at).map(posKey));
    for (const foe of foes().filter((u) => caught(u, keys))) addCondition(ctx, foe, "red_sky", tactic.redSky.rounds);
    landed = true;
  } else if (tactic.unholy) {
    // Water over it all, bar where an enemy stands: that hex comes up burning, whatever water or ice was on it gone first.
    // (Oil or poison under an enemy goes up with it, and takes the rest of its spill along.)
    const area = abilityArea(state, unit, ability, aim.at);
    const held = new Set(foes().map((u) => posKey(u.pos)));
    const burning = area.filter((p) => held.has(posKey(p)));
    placeSurface(ctx, area.filter((p) => !held.has(posKey(p))), "water", tactic.unholy.water, unit.id);
    clearSurfaces(ctx, burning.filter((p) => ["water", "ice"].includes(state.surfaces[posKey(p)]?.kind ?? "")));
    placeSurface(ctx, burning, "fire", tactic.unholy.fire, unit.id);
    landed = true;
  } else if (tactic.shape === "single") {
    const target = unitById(state, aim.target!)!;
    // The shield is set before the swing, and counts toward it.
    if (tactic.bulwark) addShield(ctx, unit, tactic.bulwark.shield + unit.level);
    if (tactic.ward) addShield(ctx, unit, tactic.ward.shield + unit.level);
    // A pocket picked unseen is no blow, just a quick hand.
    if (tactic.steal && wasUnseen) landed = true;
    else if (tactic.overwhelm) landed = overwhelm(ctx, unit, def, target, tactic.overwhelm);
    else if (tactic.bind) landed = bind(ctx, unit, def, target, tactic.bind);
    else if (tactic.sure) {
      if (def.damage) {
        const rolled = rollShown(ctx.rng, abilityDice(def), damageBonus(state, unit, def));
        damage(ctx, target, rolled.total, { actor: unit.id, what: def.id, dice: rolled });
      }
      // It lands without a roll to hit, but what it would leave on the target can still be saved against (Roar of Thunder's Stun).
      afflict(ctx, unit, def, target, true);
      landed = true;
    } else landed = strike(ctx, unit, def, tactic, target);
    // Knocked back unless it saves (Peal), or at once (Roar of Thunder).
    let shoved = landed && !!tactic.knockback && !target.down;
    if (shoved && tactic.knockSave) shoved = !saveRoll(ctx, target, "str", saveDc(unit, def), `Resist ${def.name}`).ok;
    for (let k = 0; shoved && k < (tactic.knockback ?? 0) && !target.down; k++) push(ctx, unit.pos, target, unit.id);
    if (landed && tactic.pull && !target.down) pull(ctx, unit, target, tactic.pull);
    if (tactic.steal && landed) pocket(ctx, unit, target);
    if (tactic.inspire && landed) inspireNearest(ctx, unit, target);
    if (tactic.curse && landed) layCurse(ctx, unit, target, "drowning_curse", tactic.curse.rounds);
    if (tactic.blackSpot && landed) layCurse(ctx, unit, target, "black_spot", tactic.blackSpot.rounds);
    // Then away, hit or miss, if a hex was picked.
    if (tactic.blink && aim.at && !unit.down && standable(state, aim.at, unit)) {
      blinkTo(ctx, unit, aim.at);
      if (!unit.down) ctx.onStep?.(unit, () => {});
    }
  } else if (tactic.sweep) {
    // A wave: the far ones are swept first, so the near ones have somewhere to go.
    const line = abilityArea(state, unit, ability, aim.at);
    const along = (u: Unit) => line.findIndex((p) => covers(u, p));
    const swept = foes().filter((u) => along(u) >= 0).sort((a, b) => along(b) - along(a));
    const dice = rollShown(ctx.rng, abilityDice(def), damageBonus(state, unit, def));
    const rolled = dice.total;
    for (const victim of swept) {
      const saved = saveRoll(ctx, victim, "agi", saveDc(unit, def), def.name).ok;
      let amount = rolled;
      if (tactic.vsWet && has(victim, "wet")) amount += tactic.vsWet;
      damage(ctx, victim, saved ? Math.floor(amount / 2) : amount, { actor: unit.id, what: def.id, dice, halved: saved });
      if (!saved && !victim.down) sweepAlong(ctx, victim, line, unit.id);
    }
    if (unit.side === "hero" && def.damage) for (const box of cratesOn(state, line)) hurtCrate(ctx, box, rolled, { actor: unit.id, what: def.id });
    // It leaves the line awash: whoever ends up on it is soaked.
    if (tactic.surface) placeSurface(ctx, line, tactic.surface.kind, tactic.surface.rounds, unit.id);
    landed = true;
  } else if (tactic.shape === "adjacent") {
    for (const foe of foes().filter((u) => reaches(state.map, unit, u))) landed = strike(ctx, unit, def, tactic, foe) || landed;
    if (unit.side === "hero" && def.damage) {
      for (const box of cratesBeside(state, unit)) {
        smash(ctx, unit, def, tactic, box);
        landed = true;
      }
    }
  } else if (tactic.shape === "arc") {
    const keys = new Set(arcHexes(state, unit.pos, aim.at!).map(posKey));
    for (const foe of foes().filter((u) => span(u).some((p) => keys.has(posKey(p)) && strikes(state.map, unit.pos, p)))) landed = strike(ctx, unit, def, tactic, foe) || landed;
    if (unit.side === "hero" && def.damage) {
      for (const box of cratesBeside(state, unit).filter((c) => keys.has(posKey(c.pos)))) {
        smash(ctx, unit, def, tactic, box);
        landed = true;
      }
    }
  } else if (tactic.shape === "chain") {
    const chain = [unitById(state, aim.target!)!];
    for (let i = 0; i < (tactic.jumps ?? 0); i++) {
      const last = chain[chain.length - 1];
      const next = foes()
        .filter((u) => !chain.includes(u) && gap(u, last) <= 2 && sees(state.map, ...meet(last, u)))
        .sort((a, b) => gap(a, last) - gap(b, last) || a.id.localeCompare(b.id))[0];
      if (!next) break;
      chain.push(next);
    }
    // A miss breaks the chain: the lightning goes no further than the enemy that dodged it.
    for (const foe of chain) {
      if (foe.down) continue;
      if (!strike(ctx, unit, def, tactic, foe)) break;
      landed = true;
    }
  } else if (tactic.shape === "blast" || tactic.shape === "burst" || tactic.shape === "line" || tactic.shape === "cone") {
    const area = abilityArea(state, unit, ability, aim.at);
    const keys = new Set(area.map(posKey));
    // A burst is thrown at the enemy, and so is a chorus; a blast or a line catches whoever is standing in it.
    const inIt = state.units.filter((u) => !u.down && caught(u, keys) && ((tactic.shape !== "burst" && tactic.shape !== "cone" && !tactic.chorus && !tactic.foesOnly) || u.side !== unit.side));
    // A chorus swells with every voice of the user's side caught up in it (the user's own aside).
    const voices = tactic.chorus ? state.units.filter((u) => u.side === unit.side && u.id !== unit.id && !u.down && caught(u, keys)).length : 0;
    const dice = rollShown(ctx.rng, abilityDice(def), damageBonus(state, unit, def) + (tactic.chorus ?? 0) * voices);
    const rolled = dice.total;
    for (const victim of inIt) {
      const saved = saveRoll(ctx, victim, "agi", saveDc(unit, def), def.name).ok;
      let amount = rolled;
      if (tactic.vsWet && has(victim, "wet")) amount += tactic.vsWet;
      damage(ctx, victim, saved ? Math.floor(amount / 2) : amount, { actor: unit.id, what: def.id, dice, halved: saved });
      if (!saved) afflict(ctx, unit, def, victim, false);
      // Moonlight: whoever fails to brace is lit.
      if (!saved && tactic.guide && !victim.down) addCondition(ctx, victim, "guiding_light", tactic.guide);
      // Pull of the Deep: whoever fails to brace is dragged under.
      if (!saved && tactic.drowns) drown(ctx, victim, tactic.drowns);
      // Bellows Blast: whoever fails to brace is blown back, away from the user.
      for (let k = 0; !saved && k < (tactic.knockback ?? 0) && !victim.down; k++) push(ctx, unit.pos, victim, unit.id);
    }
    // A crate in it takes the lot: it cannot get out of the way.
    if (unit.side === "hero" && def.damage) for (const box of cratesOn(state, area)) hurtCrate(ctx, box, rolled, { actor: unit.id, what: def.id });
    landed = true;
    if (tactic.ignites) for (const pos of area) ignite(ctx, pos, unit.id);
    if (tactic.surface) placeSurface(ctx, area, tactic.surface.kind, tactic.surface.rounds, unit.id);
  } else if (tactic.blink) {
    // Smuggler's Route: the ally's place beside the far end is settled before either of them goes.
    const ally = aim.target && aim.target !== unit.id ? unitById(state, aim.target) : undefined;
    const spot = ally ? carrySpot(state, unit, ally, aim.at!) : null;
    blinkTo(ctx, unit, aim.at!);
    if (ally && spot) blinkTo(ctx, ally, spot);
    for (const u of [unit, ...(ally && spot ? [ally] : [])]) if (!u.down) ctx.onStep?.(u, () => {});
    landed = true;
  } else {
    const target = tactic.shape === "ally" && aim.target ? unitById(state, aim.target)! : unit;
    const soaked = tactic.regen && inWater(state, target) ? tactic.regen.water : 0;
    if (def.heal && !tactic.soothe) {
      const bonus = Math.max(0, mod(statOf(unit, def.stat))) + Math.floor(unit.level / 2);
      const mended = rollShown(ctx.rng, healDice(def), bonus + soaked);
      heal(ctx, target, mended.total, { actor: unit.id, what: def.id, dice: mended });
      // The same heal again as their next turn starts (Rejuvenate): the bonus kept on the condition, the dice rolled then.
      if (tactic.echo) addCondition(ctx, target, "rejuvenating", tactic.echo, bonus);
    }
    // A heal that spreads: to every ally beside the one it is aimed at (Clarion Call), or round the user (Soothing Tone).
    const healed = (u: Unit, base: number) => {
      const mended = rollShown(ctx.rng, diceFor(Math.max(2, base - 1)), Math.max(0, mod(statOf(unit, def.stat))) + Math.floor(unit.level / 2));
      return heal(ctx, u, mended.total, { actor: unit.id, what: def.id, dice: mended });
    };
    if (tactic.ripple) for (const u of state.units) if (u.side === unit.side && !u.down && u.id !== target.id && gap(u, target) <= 1) healed(u, tactic.ripple);
    if (tactic.soothe) for (const u of state.units) if (u.side === unit.side && !u.down && gap(u, unit) <= tactic.soothe.range) healed(u, def.heal ?? 0);
    if (tactic.northStar) {
      // The blow round the ally first, then the star: what it strikes now is not set alight by it.
      const rolled = rollShown(ctx.rng, abilityDice(def), damageBonus(state, unit, def));
      for (const foe of foes().filter((u) => gap(u, target) <= 1)) {
        damage(ctx, foe, rolled.total, { actor: unit.id, what: def.id, dice: rolled });
        if (!foe.down) addCondition(ctx, foe, "guiding_light", tactic.guide ?? 0);
      }
      addCondition(ctx, target, "north_star", tactic.northStar.rounds);
    }
    if (tactic.regen) addCondition(ctx, target, "regenerating", tactic.regen.rounds);
    if (tactic.starlit) addCondition(ctx, target, "north_star", tactic.starlit);
    if (tactic.sicken) addCondition(ctx, unit, "poisoned", tactic.sicken);
    if (tactic.standStrong) {
      const { shield, perFoe } = tactic.standStrong;
      addShield(ctx, unit, shield + unit.level + perFoe * foes().filter((u) => gap(u, unit) <= 1).length);
    }
    if (tactic.armor) addCondition(ctx, target, "coral_armor", tactic.armor.rounds);
    if (tactic.shanty) {
      // One shanty at a time: the new one starts afresh, nobody joined yet.
      for (const kind of SHANTIES) removeCondition(unit, kind);
      addCondition(ctx, unit, tactic.shanty, SHANTY.rounds);
      Object.assign(shantyOf(unit)!, { joined: [], joinedOwn: [], surge: 0 });
      retune(ctx);
    }
    if (def.targetEffect) inflict(ctx, target, def.targetEffect);
    if (tactic.aura) addCondition(ctx, unit, tactic.aura.kind, tactic.aura.rounds);
    if (tactic.steady) addUses(ctx, target, "inspired", tactic.steady);
    // Wind's Blessing: more movement for each AP, now for one in the middle of their turn, else on their next.
    if (tactic.tailwind && !moveMore(state, target, tactic.tailwind)) {
      addCondition(ctx, target, "tailwind", 1, tactic.tailwind);
      // An ally done with their turn in this same phase has it ended again as the phase does: it must outlast that.
      const blessing = target.conditions.find((c) => c.kind === "tailwind");
      if (blessing && state.encounter?.acting.includes(target.id)) blessing.fresh = true;
    }
    if (tactic.shield) {
      const { range, shield, water } = tactic.shield;
      for (const u of state.units) if (u.side === unit.side && !u.down && gap(u, unit) <= range) shieldUnit(ctx, u, shield + unit.level + (water && inWater(state, u) ? water : 0));
    }
    if (tactic.cleanse) for (const kind of DEBUFFS) removeCondition(target, kind);
    if (tactic.clearWay) {
      for (const kind of DEBUFFS) removeCondition(target, kind);
      clearSurfaces(ctx, wayBetween(state, unit, target.pos).filter((p) => { const s = state.surfaces[posKey(p)]; return !!s && HINDERING.has(s.kind); }));
    }
    if (tactic.taunt) {
      for (const foe of foesWithin(state, unit, tactic.taunt.range)) {
        // Taunted afresh, by whoever did it last.
        removeCondition(foe, "taunted");
        addCondition(ctx, foe, "taunted", tactic.taunt.rounds);
        const c = foe.conditions.find((x) => x.kind === "taunted");
        if (c) c.by = unit.id;
      }
    }
    if (tactic.rally) {
      const { range, rounds } = tactic.rally;
      for (const u of state.units) if (u.side === unit.side && !u.down && gap(u, unit) <= range) addCondition(ctx, u, "rallied", rounds);
    }
    if (tactic.hide) {
      const { range, rounds } = tactic.hide;
      for (const u of state.units) if (u.side === unit.side && !u.down && gap(u, unit) <= range) addCondition(ctx, u, "invisible", rounds);
    }
    // One each for the user and an ally; used on yourself, both are yours.
    if (tactic.smuggle) {
      if (target.id === unit.id) addCondition(ctx, unit, "contraband", tactic.smuggle.rounds, 2);
      else for (const u of [unit, target]) addCondition(ctx, u, "contraband", tactic.smuggle.rounds, 1);
    }
    landed = true;
  }
  if (landed && def.selfEffect && !unit.down) inflict(ctx, unit, def.selfEffect);
  if (tactic.stride && !unit.down) moveMore(state, unit, tactic.stride);
  if (wasUnseen && !tactic.hide && !tactic.steal) giveAway(ctx, unit);
  if (rallied) removeCondition(unit, "rallied");
  // An ability that does harm is an attack: it spends a use of any spur (SPURS).
  if (def.damage) attackMade(ctx, unit);
}

/**
 * After a course is charted: everyone of the user's side whose turn is underway, and who has had no course this turn,
 * gets it now, for each AP they spend on movement from here on. One who has had theirs gets no more for a mark moved.
 */
export function chartCourse(ctx: Ctx, unit: Unit): void {
  const enc = ctx.state.encounter;
  if (!enc) return;
  for (const u of ctx.state.units) {
    const budget = u.side === unit.side && !u.down && enc.acting.includes(u.id) && !enc.done.includes(u.id) ? enc.budgets[u.id] : undefined;
    if (budget && budget.course === undefined) budget.course = 0;
  }
}

/**
 * After a shanty is struck up or widened: whoever it now reaches is no longer Slowed under a Wind-god's Shanty, and
 * whoever is mid-turn gets whatever movement for each AP it now owes them (Budget.song is what it has given this turn).
 */
export function retune(ctx: Ctx): void {
  const enc = ctx.state.encounter;
  for (const u of ctx.state.units) {
    if (u.down) continue;
    if (has(u, "slowed") && windward(ctx.state, u)) removeCondition(u, "slowed");
    const budget = enc && enc.acting.includes(u.id) && !enc.done.includes(u.id) ? enc.budgets[u.id] : undefined;
    if (!budget) continue;
    const owed = songMove(ctx.state, u) - (budget.song ?? 0);
    if (owed > 0 && budget.stride > 0) {
      budget.stride += owed;
      budget.song = (budget.song ?? 0) + owed;
    }
  }
}

// ---------- an enemy's attacks ----------

/** One of an enemy's attacks: a blow or a shot at `target`, or (an attack on every hero) a burst around itself. */
/** Whether an enemy's attack is a leap at its target (EnemyAbilityDef `leap`): a blow by hand, struck where it lands. */
export const leaps = (attack: EnemyStrike): boolean => !!ENEMY_ABILITIES[attack.id]?.leap;

/**
 * Where a leaping attack (a Dire Wolf's Lunge) of `enemy`'s, made from `from`, lands to strike `target`: `from` itself
 * if the target is in reach of a blow from there already; else the open hex beside them nearest `from` that a blow
 * reaches them from, with a clear line to it, not too high to leap up to, and out of fire and poison if there is one.
 * The target must be within the attack's range and in sight. Null: there is no leaping at them from there.
 */
export function lungeLanding(state: ZoneState, enemy: Unit, from: HexPos, attack: EnemyStrike, target: Unit): HexPos | null {
  if (strikes(state.map, from, target.pos)) return from;
  if (hexDistance(from, target.pos) > attack.range || !seesFor(state, enemy.side, from, target.pos)) return null;
  const rise = elevOf(state.map, from) + JUMP_UP;
  const spots = hexNeighbors(target.pos, state.map.grid).filter(
    (p) => !sameHex(p, from) && !fetterBars(enemy, from, p) && standable(state, p, enemy) && elevOf(state.map, p) <= rise && strikes(state.map, p, target.pos) && sees(state.map, from, p),
  );
  const harmful = (p: HexPos) => { const kind = state.surfaces[posKey(p)]?.kind; return kind && HARMFUL.has(kind) ? 1 : 0; };
  return spots.sort((a, b) => harmful(a) - harmful(b) || hexDistance(from, a) - hexDistance(from, b) || a.q - b.q || a.r - b.r)[0] ?? null;
}

/**
 * A leaping attack's leap, before the blow: from where it stands to beside `target` (lungeLanding), drawing blows
 * from whoever it leaps out of reach of, as a Jump does, and meeting the ground where it lands. False if it does not
 * get there on its feet to strike.
 */
function lungeAt(ctx: Ctx, enemy: Unit, attack: EnemyStrike, target: Unit): boolean {
  const to = lungeLanding(ctx.state, enemy, enemy.pos, attack, target);
  if (!to) return false;
  if (sameHex(to, enemy.pos)) return true;
  const from = enemy.pos;
  provoke(ctx, enemy, to, null, () => {});
  if (enemy.down) return false;
  enemy.pos = to;
  ctx.events.push({ t: "jumped", id: enemy.id, from, to, lunge: target.id });
  tumble(ctx, enemy, from, null, JUMP_DOWN);
  if (enemy.down || enterSurface(ctx, enemy) || enemy.down) return false;
  enterWeather(ctx, enemy);
  ctx.onStep?.(enemy, () => {});
  return !enemy.down && !has(enemy, "prone") && !target.down;
}

/**
 * An enemy uses an ability on `target`. One that lands on more than one hex (`area`, `sweep`) is aimed at `at`, which
 * may be a hex beside the target rather than theirs (ai.ts aims it to catch as many as it can); left out, at the target.
 * Each attack it makes spends one count of a Frenzy, once it is over (so the blood it draws in that attack still
 * bleeds); a call to its own side, or for more of it, is no attack, and spends none.
 */
export function enemyAct(ctx: Ctx, enemy: Unit, attack: EnemyStrike, target: Unit | null, at?: HexPos): void {
  if (attack.kit.rally) return howl(ctx, enemy, attack);
  if (attack.kit.field) return raiseField(ctx, enemy, attack);
  if (attack.kit.summon) return callForKin(ctx, enemy, attack);
  enemyAttack(ctx, enemy, attack, target, at);
  attackMade(ctx, enemy);
}

/**
 * Who an ability for its own side (a Pack Leader's Howl) reaches, used from `pos`: every ally of its user in the
 * fight, standing, bar itself, within its `range`. It is heard round corners: no line is needed.
 */
export const alliesReached = (state: ZoneState, enemy: Unit, pos: HexPos, attack: EnemyStrike): Unit[] =>
  state.units.filter((u) => u.side === enemy.side && u.id !== enemy.id && !u.down && inFight(state, u.id) && gap(enemy, u, pos) <= attack.range);

/** A call to its own side (a Pack Leader's Howl): every ally it reaches (alliesReached) is Frenzied for so many attacks. */
function howl(ctx: Ctx, enemy: Unit, attack: EnemyStrike): void {
  ctx.events.push({ t: "used", id: enemy.id, what: "attack", name: attack.name });
  for (const ally of alliesReached(ctx.state, enemy, enemy.pos, attack)) addCondition(ctx, ally, "frenzied", UNTIMED_KEEPS, attack.kit.rally!.attacks);
}

/** A call for more of its side (a Broodmother's Brood Swarm): so many of a kind come to stand beside it (summon.ts callKin). */
function callForKin(ctx: Ctx, enemy: Unit, attack: EnemyStrike): void {
  ctx.events.push({ t: "used", id: enemy.id, what: "attack", name: attack.name });
  for (const called of callKin(ctx, enemy, attack.kit.summon!)) if (!called.down) ctx.onStep?.(called, () => {});
}

/**
 * A field round its user (a Guardian's Slowing Field): it carries it for so many of its turns, and whoever of the other
 * side is in it now is Slowed for the rest of their turn, if it is theirs (fieldSlows). No attack: no Frenzy is spent.
 */
function raiseField(ctx: Ctx, enemy: Unit, attack: EnemyStrike): void {
  const field = attack.kit.field!;
  ctx.events.push({ t: "used", id: enemy.id, what: "attack", name: attack.name });
  addCondition(ctx, enemy, "slowing_field", field.rounds, field.radius);
  // However long it was up for before, it reaches as far as this one does.
  const held = enemy.conditions.find((c) => c.kind === "slowing_field");
  if (held) held.amount = field.radius;
}

/** Whoever of the other side carries a Slowing Field that reaches `unit` where it stands, if anyone does. */
export const fieldOver = (state: ZoneState, unit: Unit): Unit | undefined =>
  state.units.find((u) => u.side !== unit.side && !u.down && inFight(state, u.id) && gap(u, unit) <= (u.conditions.find((c) => c.kind === "slowing_field")?.amount ?? -1));

/**
 * A unit in the fight is in a Slowing Field of the other side's (as its turn starts, or as it steps in): it is Slowed
 * until its turn is over, and its movement left this turn is halved at once (engine.ts addCondition). Leaving the field
 * does not lift it; out of it, its next turn is its own pace again. Those who fly are caught as well: it is the air.
 */
export function fieldSlows(ctx: Ctx, unit: Unit): void {
  const { state } = ctx;
  if (unit.down || !inFight(state, unit.id) || has(unit, "slowed") || !fieldOver(state, unit)) return;
  addCondition(ctx, unit, "slowed", 1);
  // Only for this turn of theirs: they are Slowed again next turn only if they are still in it then.
  const c = unit.conditions.find((x) => x.kind === "slowed");
  if (c) delete c.fresh;
}

/**
 * Fetter `unit` where it stands (EnemyAbilityDef `tether`, a Haunt's Ghastly Fetter): for so many of its turns it goes
 * no further than `reach` from here by its own doing (geometry.ts fetterBars). Fettered again while it holds, it is
 * chained to where it stands now instead, for as long as the longer of the two.
 */
function fetter(ctx: Ctx, unit: Unit, tether: { reach: number; turns: number }): void {
  addCondition(ctx, unit, "fettered", tether.turns, tether.reach);
  const held = unit.conditions.find((c) => c.kind === "fettered");
  if (held) held.at = { q: unit.pos.q, r: unit.pos.r };
}

function enemyAttack(ctx: Ctx, enemy: Unit, attack: EnemyStrike, target: Unit | null, at?: HexPos): void {
  const { state } = ctx;
  const dc = 8 + attack.potency;
  const aim = at ?? target?.pos;
  ctx.events.push({ t: "used", id: enemy.id, what: "attack", name: attack.name, target: target?.id, ...((spreads(attack.kit) || attack.kit.dash) && aim ? { at: aim } : {}) });
  // What it leaves on whoever it gets through to: `saveOr` unless they save (`save`: they may), and its lesser share
  // (`onSave`) if they do.
  const leave = (victim: Unit, save: boolean) => {
    if (victim.down || !attack.saveOr) return;
    const effect = attack.saveOr.effect;
    if (!save || !saveRoll(ctx, victim, SAVE_STAT[effect], dc, `Resist ${attack.name}`).ok) {
      inflict(ctx, victim, attack.saveOr);
      if (attack.kit.tether) fetter(ctx, victim, attack.kit.tether);
    } else if (attack.kit.onSave) inflict(ctx, victim, attack.kit.onSave);
  };
  // An Earthquake: the ground round it shakes now, and is left cracked to heave again as its next turn begins.
  if (attack.kit.aftershock) {
    makeQuake(ctx, enemy, quakeHexes(state, span(enemy), ENEMY_BURST), attack.name, attack.dice, dc, attack.kit.aftershock);
    return;
  }
  if (attack.burst) {
    // A fight's blows are for those in it: a hero standing near who is not (their player away) is passed over.
    const caught = state.units.filter((u) => u.side !== enemy.side && !u.down && !unseen(u) && inFight(state, u.id) && gap(enemy, u) <= attack.range && seesFor(state, enemy.side, ...meet(enemy, u)));
    // One that does no harm (Memento Mori) is only what it leaves: each saves against that, not for half.
    if (attack.harmless) {
      for (const victim of caught) leave(victim, true);
      return;
    }
    const dice = rollShown(ctx.rng, attack.dice);
    const rolled = dice.total;
    for (const victim of caught) {
      const saved = saveRoll(ctx, victim, "agi", dc, attack.name).ok;
      damage(ctx, victim, saved ? Math.floor(rolled / 2) : rolled, { actor: enemy.id, what: attack.name, dice, halved: saved });
      if (!saved) leave(victim, false);
    }
    return;
  }
  // One that lands on several hexes at once (spreadHexes): thrown onto a clump round its aim or every hex within its
  // blast, swept through rows of hexes, reached out over a cone, or flung down a line. Everyone there (in the fight)
  // saves for half, as from a burst, and whatever it leaves on the ground is left on all of it. One that does no harm
  // (Spin Web) is only what it leaves: they save against its `saveOr`, if it has one, not for half.
  // (Aimed at a hex, it needs nobody on it: the combat sandbox aims these by hand. Anything else needs its target.)
  const spread = aim && spreadHexes(state, attack.kit, enemy.pos, aim);
  if (spread) {
    const dice = attack.harmless ? null : rollShown(ctx.rng, attack.dice);
    for (const victim of state.units.filter((u) => u.side !== enemy.side && !u.down && !unseen(u) && inFight(state, u.id) && spread.some((p) => covers(u, p)))) {
      if (!dice) {
        leave(victim, true);
        continue;
      }
      const saved = saveRoll(ctx, victim, "agi", dc, attack.name).ok;
      damage(ctx, victim, saved ? Math.floor(dice.total / 2) : dice.total, { actor: enemy.id, what: attack.name, dice, halved: saved });
      if (!saved) leave(victim, false);
    }
    if (attack.kit.surface) placeSurface(ctx, spread, attack.kit.surface.kind, attack.kit.surface.rounds, enemy.id);
    return;
  }
  // A dash: straight through everyone in the way, to the far end of the line. Everyone it passes (in the fight) saves
  // for half, as from a sweep; it comes to rest beyond, meeting the ground there as a leap does. Nobody strikes at it on the way.
  if (attack.kit.dash && aim) {
    const way = dashWay(state, enemy, enemy.pos, aim, attack.range);
    if (!way) return;
    // Too quick to be struck at as it goes: it draws no blows from whoever it leaves the reach of.
    const from = enemy.pos;
    enemy.pos = way.land;
    ctx.events.push({ t: "jumped", id: enemy.id, from, to: way.land, dash: { name: attack.name, through: way.through } });
    const dice = rollShown(ctx.rng, attack.dice);
    for (const victim of state.units.filter((u) => u.side !== enemy.side && !u.down && !unseen(u) && inFight(state, u.id) && way.through.some((p) => covers(u, p)))) {
      const saved = saveRoll(ctx, victim, "agi", dc, attack.name).ok;
      damage(ctx, victim, saved ? Math.floor(dice.total / 2) : dice.total, { actor: enemy.id, what: attack.name, dice, halved: saved });
      if (!saved) leave(victim, false);
    }
    tumble(ctx, enemy, from, null, JUMP_DOWN);
    if (enemy.down || enterSurface(ctx, enemy) || enemy.down) return;
    enterWeather(ctx, enemy);
    ctx.onStep?.(enemy, () => {});
    return;
  }
  if (!target) return;
  // A leap: through the air to beside them first, then a blow by hand.
  const leap = leaps(attack);
  if (leap && !lungeAt(ctx, enemy, attack, target)) return;
  const melee = attack.range === 1 || leap;
  // One that is only saved against (`saves`): no roll to hit. They save against what it leaves (Agility, if it leaves
  // nothing), taking half and none of it on a success; on a failure, all of it and what it leaves.
  if (attack.kit.saves) {
    const saved = saveRoll(ctx, target, attack.saveOr ? SAVE_STAT[attack.saveOr.effect] : "agi", dc, attack.name).ok;
    if (!attack.harmless) {
      const dice = rollShown(ctx.rng, attack.dice);
      damage(ctx, target, saved ? Math.floor(dice.total / 2) : dice.total, { actor: enemy.id, what: attack.name, dice, halved: saved });
    }
    if (!saved) leave(target, false);
    else if (attack.kit.onSave && !target.down) inflict(ctx, target, attack.kit.onSave);
    return;
  }
  const roll = attackRoll(ctx, enemy, target, { label: attack.name, bonus: attack.potency, melee });
  if (!roll.ok) {
    ctx.events.push({ t: "miss", actor: enemy.id, target: target.id, what: attack.name });
    return;
  }
  if (!attack.harmless) {
    const rolled = rollShown(ctx.rng, attack.dice, 0, roll.crit);
    const dealt = damage(ctx, target, rolled.total, { actor: enemy.id, what: attack.name, crit: roll.crit, dice: rolled });
    // A drain: its user grows back a share of what it tore off, unless it is on fire.
    if (attack.kit.drain && dealt > 0 && !enemy.down && !has(enemy, "burning")) heal(ctx, enemy, Math.floor(dealt * attack.kit.drain), { actor: enemy.id, what: attack.name });
    if (melee) thorns(ctx, enemy, target);
    // A splash: the shock of the blow pulses out, and every other hero in the fight beside the target is battered by
    // a share of it, or by half that if they get clear (an Agility save).
    if (attack.kit.splash) {
      const share = Math.floor(rolled.total * SPLASH_SHARE);
      for (const near of state.units.filter((u) => u.side !== enemy.side && u.id !== target.id && !u.down && inFight(state, u.id) && gap(u, target) === 1)) {
        const saved = saveRoll(ctx, near, "agi", dc, attack.name).ok;
        damage(ctx, near, saved ? Math.floor(share / 2) : share, { actor: enemy.id, what: attack.name, splash: true });
      }
    }
  }
  leave(target, true);
  const struck = nearOf(target, enemy.pos);
  if (attack.kit.surface) placeSurface(ctx, [struck], attack.kit.surface.kind, attack.kit.surface.rounds, enemy.id);
  if (attack.kit.chills) chill(ctx, struck, enemy.id);
  const hexes = attack.kit.push === true ? 1 : attack.kit.push || 0;
  // Pushed straight away from the hex of a big one nearest them.
  for (let k = 0; k < hexes && !target.down; k++) if (push(ctx, nearOf(enemy, target.pos), target, enemy.id) !== "moved") break;
}

// ---------- common actions ----------

/** The enemies in the fight, still standing, within `range` of `unit`: the dark hides none of them from this. */
export const foesWithin = (state: ZoneState, unit: Unit, range: number): Unit[] =>
  state.units.filter((u) => u.side !== unit.side && !u.down && inFight(state, u.id) && gap(u, unit) <= range);

/** Why `unit` cannot take this common action, in words, or null if it can. `budget` is null out of a fight. */
export function checkCommon(state: ZoneState, unit: Unit, what: CommonAction, aim: Aim, budget: Budget | null): string | null {
  if (!COMMON_ACTIONS[what]) return "No such action.";
  if (what === "disengage") {
    if (!budget) return "That is for a fight.";
    return state.encounter?.disengaged?.includes(unit.id) ? "You have already disengaged this fight." : null;
  }
  if (what === "flee") {
    if (!budget) return "That is for a fight.";
    if (unit.summon) return "It was called to this fight, and stays in it.";
    return foesWithin(state, unit, FLEE_RANGE).length > 0 ? `An enemy is too close to get away: get more than ${FLEE_RANGE} hexes from every one in the fight first.` : null;
  }
  if (what === "join") {
    if (!budget) return "That is for a fight.";
    const songs = joinable(state, unit).filter((s) => !aim.target || s.bard.id === aim.target);
    if (songs.length > 0) return null;
    if (shantyOf(unit) && !aim.target) return "You cannot join your own shanty.";
    return "There is no shanty here you have not joined: stand within one an ally is singing.";
  }
  if (what === "help") {
    const target = aim.target ? unitById(state, aim.target) : undefined;
    if (!target || target.side !== unit.side || !target.down) return "Pick a fallen ally.";
    return reaches(state.map, unit, target) ? null : "You have to be next to them.";
  }
  if (what === "shove") {
    const target = aim.target ? unitById(state, aim.target) : undefined;
    if (!target || target.side === unit.side || target.down) return "Pick an enemy.";
    return reaches(state.map, unit, target) ? null : "You have to be next to it.";
  }
  // Jump: a leap, or in Phase Treads a blink where no leap would get there.
  if (!aim.at || sameHex(aim.at, unit.pos)) return "Pick a hex to jump to.";
  const leap = leapWrong(state, unit, aim.at);
  return leap && !isBlink(state, unit, aim.at) ? leap : null;
}

/** Why `unit` cannot leap to `at` (a Jump made on foot), or null if it can. */
function leapWrong(state: ZoneState, unit: Unit, at: HexPos): string | null {
  if (big(unit)) return "Too heavy to jump.";
  if (hexDistance(unit.pos, at) > jumpRange(unit)) return "Too far to jump.";
  if (fetterBars(unit, unit.pos, at)) return "The chain will not reach.";
  if (solid(tileAt(state.map, at)) || blockerAt(state, at) || !roomAt(state, at, unit)) return "There is nowhere to land.";
  if (elevOf(state.map, at) - elevOf(state.map, unit.pos) > JUMP_UP) return "Too high to jump up to.";
  if (!sees(state.map, unit.pos, at)) return "Something is in the way.";
  return null;
}

/**
 * Whether a Jump to `at` is made as a blink, through Phase Treads: one a leap cannot make (too far, too high, or
 * something in the way) that a blink can, from nothing in between to anywhere within their reach there is room to
 * stand. It costs BLINK_AP in place of the Jump's AP (commonCostFor).
 */
export function isBlink(state: ZoneState, unit: Unit, at: HexPos | undefined): boolean {
  const reach = blinkRange(unit);
  return reach > 0 && !!at && !!leapWrong(state, unit, at) && !blinkWrong(state, unit, at, reach);
}

/**
 * What a Shove adds to its roll to hit: for a hero, as a blow with Strength (proficiency and STR); for an enemy, the best
 * to-hit of its own blows (its abilities that reach a hex and are no burst), ready or not, as the map has them.
 */
export function shoveBonus(state: Pick<ZoneState, "options">, unit: Unit): number {
  if (unit.stats) return proficiency(unit.level) + mod(statOf(unit, "str"));
  const blows = abilityStrikes(unit.abilities, unit.level, modsOf(state.options).edge).filter((s) => s.range === 1 && !s.burst);
  return blows.length > 0 ? Math.max(...blows.map((s) => s.potency)) : 0;
}

/** Take a common action that has passed its check. */
export function doCommon(ctx: Ctx, unit: Unit, what: CommonAction, aim: Aim, budget: Budget | null): void {
  ctx.events.push({ t: "used", id: unit.id, what, name: COMMON_ACTIONS[what].name, target: aim.target, at: aim.at });
  if (what === "join") joinSong(ctx, unit, aim, budget);
  else if (what === "disengage" && budget) {
    budget.disengaged = true;
    const enc = ctx.state.encounter;
    if (enc) enc.disengaged = [...(enc.disengaged ?? []), unit.id];
  }
  else if (what === "help") {
    const target = unitById(ctx.state, aim.target!)!;
    target.down = false;
    target.hp = 0;
    ctx.events.push({ t: "up", id: target.id });
    heal(ctx, target, 1, { actor: unit.id, what: "help" });
  } else if (what === "shove") {
    const target = unitById(ctx.state, aim.target!)!;
    const roll = attackRoll(ctx, unit, target, { label: "Shove", bonus: shoveBonus(ctx.state, unit), melee: true });
    giveAway(ctx, unit);
    if (roll.ok) push(ctx, unit.pos, target, unit.id);
    else ctx.events.push({ t: "miss", actor: unit.id, target: target.id, what: "shove" });
  } else if (what === "jump" && isBlink(ctx.state, unit, aim.at)) {
    // Phase Treads: there at once, crossing nothing, drawing no blow on the way.
    blinkTo(ctx, unit, aim.at!, true);
    if (!unit.down) ctx.onStep?.(unit, () => {});
  } else if (what === "jump") {
    const from = unit.pos;
    provoke(ctx, unit, aim.at!, budget, () => {});
    if (unit.down) return;
    unit.pos = aim.at!;
    ctx.events.push({ t: "jumped", id: unit.id, from, to: unit.pos });
    // A leap down is the leaper's own doing, as far as it goes: past that it is a fall.
    tumble(ctx, unit, from, null, JUMP_DOWN);
    if (!unit.down && !enterSurface(ctx, unit) && !unit.down) {
      enterWeather(ctx, unit);
      ctx.onStep?.(unit, () => {});
    }
  }
}

/** Join a shanty (checked already): it reaches a hex further, and the one joining gets the lift of joining that kind. */
function joinSong(ctx: Ctx, unit: Unit, aim: Aim, budget: Budget | null): void {
  const { song } = joinable(ctx.state, unit).find((s) => !aim.target || s.bard.id === aim.target)!;
  // A creature called into the fight gets the lift of joining, and nothing more: the shanty reaches no further, and gives nobody else any more.
  if (unit.summon) song.joinedOwn = [...(song.joinedOwn ?? []), unit.id];
  else {
    song.joined = [...(song.joined ?? []), unit.id];
    // Everyone in it gets a little more of what it gives, until the Bard's next turn.
    song.surge = (song.surge ?? 0) + 1;
  }
  if (song.kind === "lively_shanty") addUses(ctx, unit, "inspired", 1);
  else if (song.kind === "dour_shanty") addCondition(ctx, unit, "guarded", 1);
  // Wind-god's: away on the wind, drawing no blows for the rest of the turn. That is this fight's Disengage, and there is only one.
  else if (budget) {
    const enc = ctx.state.encounter;
    if (!enc?.disengaged?.includes(unit.id)) {
      budget.disengaged = true;
      if (enc) enc.disengaged = [...(enc.disengaged ?? []), unit.id];
    }
  }
  retune(ctx);
}

// ---------- throwing ----------

const carried = (unit: Unit, item: Throwable): number => unit.items[item] ?? 0;
/** Fire bombs slipped into the pack by Contraband (the condition's `amount`): not the hero's own, thrown before any of theirs, and never written home. */
const smuggled = (unit: Unit, item: Throwable): number => (item === SMUGGLED ? (unit.conditions.find((c) => c.kind === "contraband")?.amount ?? 0) : 0);

/** Why `unit` cannot throw this there, in words, or null if it can. */
export function checkThrow(state: ZoneState, unit: Unit, item: Throwable, at: HexPos): string | null {
  if (!THROWABLES[item]) return "No such thing to throw.";
  // A torch already lit in the hand can be thrown with none left in the pack.
  if (carried(unit, item) + smuggled(unit, item) <= 0 && !(THROWABLES[item].light && (unit.torch ?? 0) > 0)) return `You have no ${THROWABLES[item].name.toLowerCase()} left.`;
  if (!tileAt(state.map, at)) return "Pick a hex.";
  if (hexDistance(unit.pos, at) > throwRange(mod(statOf(unit, "str")))) return "Too far to throw.";
  return sees(state.map, unit.pos, at) ? null : "There is no clear line to it.";
}

/** Why `unit` cannot drink this, in words, or null if it can. */
/** Why `unit` cannot light a torch to hold, or null if it can. */
export function checkLight(unit: Unit): string | null {
  if ((unit.torch ?? 0) > 0) return "You already hold a lit torch.";
  return carried(unit, "torch") > 0 ? null : "You have no torch left.";
}

export function checkDrink(unit: Unit, item: Throwable): string | null {
  const def = THROWABLES[item];
  if (!def) return "No such thing to drink.";
  if (!def.drink) return `A ${def.name.toLowerCase()} is not for drinking.`;
  return carried(unit, item) > 0 ? null : `You have no ${def.name.toLowerCase()} left.`;
}

/** Drink something that has passed its check: all of its healing, for the drinker. */
export function drinkItem(ctx: Ctx, unit: Unit, item: Throwable): void {
  const def = THROWABLES[item];
  unit.items[item] = carried(unit, item) - 1;
  ctx.events.push({ t: "used", id: unit.id, what: `drink:${item}`, name: def.name });
  if (def.heal) {
    const rolled = rollShown(ctx.rng, def.heal);
    heal(ctx, unit, rolled.total, { actor: unit.id, what: `drink:${item}`, dice: rolled });
  }
}

/** Throw something that has passed its check: it lands on `at` and reaches the hexes around it. */
export function throwItem(ctx: Ctx, unit: Unit, item: Throwable, at: HexPos): void {
  const def = THROWABLES[item];
  // Anything thrown gives an Unseen thrower away.
  giveAway(ctx, unit);
  if (def.light) {
    // The torch in the hand if one is lit, burning on for what it has left; else one from the pack, lit as it goes.
    const held = unit.torch ?? 0;
    if (held > 0) letGoTorch(unit);
    else unit.items[item] = carried(unit, item) - 1;
    ctx.events.push({ t: "used", id: unit.id, what: `throw:${item}`, name: def.name, at });
    dropTorch(ctx, at, held > 0 ? held : TORCH_GROUND_ROUNDS, unit.id);
    return;
  }
  const contraband = item === SMUGGLED ? unit.conditions.find((c) => c.kind === "contraband") : undefined;
  if (contraband && (contraband.amount ?? 0) > 0) {
    contraband.amount! -= 1;
    if (contraband.amount! <= 0) removeCondition(unit, "contraband");
  }
  else unit.items[item] = carried(unit, item) - 1;
  ctx.events.push({ t: "used", id: unit.id, what: `throw:${item}`, name: def.name, at });
  const area = blast(ctx.state.map, at, def.radius);
  const keys = new Set(area.map(posKey));
  const inIt = ctx.state.units.filter((u) => caught(u, keys));
  if (def.heal) {
    const dice = rollShown(ctx.rng, def.heal);
    const amount = dice.total;
    // It heals whoever it splashes, most of all whoever it lands on, and gets a fallen hero up. The enemy's dead stay dead.
    for (const u of inIt) {
      if (u.down && u.side !== "hero") continue;
      heal(ctx, u, covers(u, at) ? amount : Math.ceil(amount * POTION_EDGE), { actor: unit.id, what: `throw:${item}`, ...(covers(u, at) ? { dice } : {}) });
    }
  }
  if (def.damage) {
    const dice = rollShown(ctx.rng, def.damage);
    const rolled = dice.total;
    for (const u of inIt.filter((c) => !c.down)) {
      const saved = saveRoll(ctx, u, "agi", THROW_SAVE, def.name).ok;
      damage(ctx, u, saved ? Math.floor(rolled / 2) : rolled, { actor: unit.id, what: `throw:${item}`, dice, halved: saved });
      // What it leaves on them (acid's holes) only sticks to those who did not dodge it.
      if (def.condition && !saved && !u.down) addCondition(ctx, u, def.condition.kind, def.condition.rounds);
    }
    for (const box of cratesOn(ctx.state, area)) hurtCrate(ctx, box, rolled, { actor: unit.id, what: `throw:${item}` });
  }
  if (def.surface) placeSurface(ctx, area, def.surface.kind, def.surface.rounds, unit.id);
}
