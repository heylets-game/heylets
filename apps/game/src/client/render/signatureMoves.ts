// Enemy abilities with an animation of their own, beyond the ordinary swing, shot or cast (WorldRenderer.attack):
// the figure's moves and the effects thrown off them, step by step. Keyed by the ability's name, as a fight's
// events carry it.
//
// Each is played on a stage that lends it the effects and the clock: the game's map (WorldRenderer), or the
// figure lab (FigureLab.tsx), where each one has a button of its own. A new one added here shows in both.

import * as THREE from "three";
import { FLURRY_BLOWS, SLICES_APART, type Figure } from "./figures";
import type { FxKind } from "./sprites";

/** One effect sprite: flown from `from` to `to` over `life` seconds, growing from one size to the other. */
export interface FxOpts {
  from: THREE.Vector3;
  to: THREE.Vector3;
  life: number;
  size: [number, number];
  /** Total rotation over its life, in radians. */
  spin: number;
  /** Its rotation to begin with, in radians. */
  turn?: number;
  fade: boolean;
  arc?: number;
  onEnd?: () => void;
}

/** A ring lying flat on the ground, spreading out from `at` to `radius` over `life` seconds and fading as it goes. */
export interface WaveOpts {
  at: THREE.Vector3;
  radius: number;
  life: number;
  color: string;
  /** How thick the ring is, as a share of how far out it has spread. */
  width: number;
}

/** How far out a wave has spread, `k` of the way through its life: fast at first, slowing as it goes. */
const waveOut = (k: number, radius: number) => WAVE_START + (radius - WAVE_START) * (1 - (1 - k) * (1 - k));
const WAVE_START = 0.2;

/** Seconds until a wave of `radius` over `life` reaches `far` out (never, past its radius: then as it ends). */
export function waveReaches(far: number, radius: number, life: number): number {
  const out = Math.min(1, Math.max(0, (far - WAVE_START) / (radius - WAVE_START)));
  return (1 - Math.sqrt(1 - out)) * life;
}

/**
 * Lay a wave on the ground in `group` (see WaveOpts). Returns its step: run it every frame with the seconds gone by,
 * and it says whether it is still going; once it is over it has taken itself away.
 */
export function groundWave(group: THREE.Object3D, o: WaveOpts): (dt: number) => boolean {
  const material = new THREE.MeshBasicMaterial({ color: o.color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(1 - o.width, 1, 48), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(o.at);
  mesh.renderOrder = 8;
  group.add(mesh);
  let age = 0;
  return (dt) => {
    age += dt;
    const k = Math.min(1, age / o.life);
    const r = waveOut(k, o.radius);
    mesh.scale.set(r, r, 1);
    material.opacity = 0.85 * (1 - k) * (1 - k * 0.3);
    if (k < 1) return true;
    group.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
    return false;
  };
}

/** What a stage lends a move. */
export interface MoveStage {
  spawnFx(kind: FxKind, color: string, flip: boolean, opts: FxOpts): void;
  /** A wave spreading out over the ground (see groundWave). */
  wave(opts: WaveOpts): void;
  /** Run this so many seconds on, on the stage's clock (slowed and paused with it, in the lab). */
  later(run: () => void, seconds: number): void;
  /** The attack's sound again, for a swing after the first (the stage plays the first itself). */
  sound(): void;
  /** Spring the attacker at the target: for a creature, which has no swing of its own. */
  lunge(): void;
  /**
   * Leap the attacker bodily at the target and home again after (see pounceAt): a crouch, a jump through the air
   * that comes down in the target's face, a moment there, and a hop back; or, for one that leapt in from further
   * off (a Lunge), from where it set off, settling onto the hex it took after. Returns the seconds until it lands.
   */
  pounce(): number;
  /** A blow has landed on the target: jolt it. */
  jolt(): void;
}

export interface MoveCtx {
  figure: Figure;
  /** Where on the target it lands. */
  hitAt: THREE.Vector3;
  /** Which way the target is from the attacker as the viewer sees it: 1 right, -1 left. */
  dir: 1 | -1;
  /** A critical hit: what lands is drawn gold, as any critical blow is. */
  crit: boolean;
  /** When the blow is told: the damage and what it leaves show then. */
  onImpact(): void;
  /**
   * For a move that catches several at once (a Slam), played once for each: this one is not the first, so what it
   * throws out round its user has been drawn already, and only its landing on this target is left to time.
   */
  echo?: boolean;
  /**
   * Played round its user alone, before anyone it catches is known (a fight's burst, ZoneView): nobody is reached
   * by it here, and `onImpact` runs as it lands. Whoever it catches flinches as their own hit is told.
   */
  alone?: boolean;
}

export interface SignatureMove {
  /** Who uses it, by enemy kind, for the lab. */
  who: string;
  /** What it looks like, for the lab's tooltip. */
  blurb: string;
  /**
   * The only kinds it is played for, where another kind has an ability of the same name (a Brute's Maul is not a
   * bear's): any other strikes as usual. None: whoever uses it.
   */
  only?: readonly string[];
  play(stage: MoveStage, ctx: MoveCtx): void;
}

const CHEAP_SHOT_RED = "#e0313f";

/**
 * Two flat side slashes, one each way: a forehand across the front from the right, carried straight on into a
 * backhand from the left (figures.ts SLICES), the sword leaving a red trail as it goes (figures.ts SWOOSH_TINT).
 * Each cut leaves a red swipe lying flat across the target, the second a little below the first and swept the
 * other way, and jolts it. The blow is told when the second lands.
 */
function cheapShot(stage: MoveStage, { figure, hitAt, dir, crit, onImpact }: MoveCtx) {
  const cut = (second: boolean) => {
    // The swipe is drawn as a quarter circle bowed up and to one side; turned an eighth, it lies flat, an arch.
    const flip = second ? dir > 0 : dir < 0;
    const at = hitAt.clone().setY(hitAt.y + (second ? -0.1 : 0.12));
    stage.spawnFx("slash", crit ? "#ffd23f" : CHEAP_SHOT_RED, flip, { from: at, to: at, life: 0.24, size: [1.4, 2.3], turn: flip ? -Math.PI / 4 : Math.PI / 4, spin: (flip ? 1 : -1) * 0.5, fade: true });
    stage.jolt();
  };
  const first = figure.strike("slices");
  // A creature has no swing of its own: it springs at the target, and the two cuts land as it does.
  if (first <= 0) stage.lunge();
  stage.later(() => cut(false), first);
  stage.later(() => {
    stage.sound();
    cut(true);
    onImpact();
  }, first + (first > 0 ? SLICES_APART : 0.2));
}

/**
 * A creature's leap at its target (MoveStage.pounce), in seconds for each part: gathering itself (drawn back by
 * `gather`), in the air (`high` at the top), held where it landed, and the hop home (`homeHop` high). It comes down
 * `short` of the target's middle: in its face, not on top of it. A leap that carries it to a new hex (a Lunge from
 * further off) is longer in the air the further it goes (leapAir), and settles onto its new hex in place of the hop.
 */
export const POUNCE = { crouch: 0.14, air: 0.26, hold: 0.2, back: 0.24, gather: 0.22, high: 0.6, homeHop: 0.12, short: 0.6 };
/** Seconds from a pounce's start to its landing, and to its end, home again (or settled on its new hex). */
export const pounceLands = (air: number = POUNCE.air) => POUNCE.crouch + air;
export const pounceOver = (air: number = POUNCE.air) => pounceLands(air) + POUNCE.hold + POUNCE.back;
export const POUNCE_LANDS = pounceLands();
export const POUNCE_OVER = pounceOver();
/** How long a leap to a new hex, at a target `far` world units off, is in the air: longer the further it goes. */
export const leapAir = (far: number) => Math.min(0.6, POUNCE.air + 0.06 * Math.max(0, far - 1.5));

const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * Where a pounce has its creature `s` seconds in, at a target `far` away, `air` seconds off the ground: how far it is
 * toward the target from where it set off (back from it while gathering itself), how high off the ground, the most
 * it comes toward the target (`reach`), and how far it is on its way home from there, 0 to 1 (`home`).
 */
export function pounceAt(s: number, far: number, air: number = POUNCE.air): { ahead: number; up: number; reach: number; home: number } {
  const reach = Math.max(0, far - POUNCE.short);
  if (s <= 0) return { ahead: 0, up: 0, reach, home: 0 };
  if (s >= pounceOver(air)) return { ahead: 0, up: 0, reach, home: 1 };
  if (s < POUNCE.crouch) return { ahead: -POUNCE.gather * ease(s / POUNCE.crouch), up: 0, reach, home: 0 };
  s -= POUNCE.crouch;
  if (s < air) {
    const k = s / air;
    // A longer leap goes higher, but not as much higher as it goes further.
    const high = POUNCE.high * Math.sqrt(air / POUNCE.air);
    return { ahead: -POUNCE.gather + (reach + POUNCE.gather) * k, up: 4 * high * k * (1 - k), reach, home: 0 };
  }
  s -= air;
  if (s < POUNCE.hold) return { ahead: reach, up: 0, reach, home: 0 };
  const k = (s - POUNCE.hold) / POUNCE.back;
  return { ahead: reach * (1 - ease(k)), up: 4 * POUNCE.homeHop * k * (1 - k), reach, home: ease(k) };
}

const TEETH = "#f4efe2";
const GOLD = "#ffd23f";
/** How long a lunge's jaws take to close: they meet as the wolf lands. A plain bite's are quicker. */
const LUNGE_BITE = 0.1;
const QUICK_BITE = 0.08;
/** Seconds between each set of speed lines thrown off a leaping wolf. */
const STREAK_EVERY = 0.03;
const STREAK_PALE = "#d6e4ff";

/**
 * Jaws closing on the target: two arches (white, or `teeth`), the upper and the lower, `gape` apart, snapping together
 * over `life` seconds. `onShut` runs as they meet.
 */
function jaws(stage: MoveStage, { hitAt, dir, crit }: MoveCtx, life: number, gape: number, onShut: () => void, teeth = TEETH) {
  const color = crit ? GOLD : teeth;
  // The swipe is drawn as a quarter circle; turned an eighth it lies flat as an arch, and half a turn more turns it over.
  const flat = dir < 0 ? -Math.PI / 4 : Math.PI / 4;
  for (const upper of [false, true]) {
    const side = upper ? 1 : -1;
    const from = hitAt.clone().setY(hitAt.y + side * gape);
    const to = hitAt.clone().setY(hitAt.y + side * 0.06);
    stage.spawnFx("slash", color, dir < 0, { from, to, life, size: [1.5, 1.2], turn: upper ? flat : flat + Math.PI, spin: 0, fade: false, onEnd: upper ? onShut : undefined });
  }
}

/** A wolf's plain bite: a snap forward, and its jaws close on the target. */
function wolfBite(stage: MoveStage, ctx: MoveCtx) {
  stage.lunge();
  jaws(stage, ctx, QUICK_BITE, 0.3, () => {
    stage.spawnFx("burst", ctx.crit ? GOLD : TEETH, false, { from: ctx.hitAt, to: ctx.hitAt, life: 0.18, size: [0.5, 1.2], spin: 0.5, fade: true });
    stage.jolt();
    ctx.onImpact();
  });
}

/** A troll's Chomp: a wolf's snap forward, its jaws closing on the target as two red arches. */
function trollChomp(stage: MoveStage, ctx: MoveCtx) {
  const red = ctx.crit ? GOLD : CHEAP_SHOT_RED;
  stage.lunge();
  jaws(stage, ctx, QUICK_BITE, 0.3, () => {
    stage.spawnFx("burst", red, false, { from: ctx.hitAt, to: ctx.hitAt, life: 0.18, size: [0.5, 1.2], spin: 0.5, fade: true });
    stage.jolt();
    ctx.onImpact();
  }, CHEAP_SHOT_RED);
}

/** A troll's Rake: its usual swing with a long clawed arm, leaving a red swoosh across the target. */
function trollRake(stage: MoveStage, { figure, hitAt, dir, crit, onImpact }: MoveCtx) {
  const red = crit ? GOLD : CHEAP_SHOT_RED;
  const wait = figure.strike("light");
  // A creature with no swing of its own springs at the target, and the swoosh lands as it does.
  if (wait <= 0) stage.lunge();
  stage.later(() => {
    stage.spawnFx("slash", red, dir < 0, { from: hitAt, to: hitAt, life: 0.26, size: [1.3, 2.3], spin: -dir * 0.9, fade: true });
    stage.spawnFx("burst", red, dir < 0, { from: hitAt, to: hitAt, life: 0.22, size: [0.6, 1.5], spin: 0.5, fade: true });
    onImpact();
  }, Math.max(0, wait));
}

/**
 * A wolf's lunge: it gathers itself and leaps at the target (from up to 3 hexes off, if it sprang from there), kicking dust back off the ground as it goes and throwing
 * speed lines off itself the whole way through the air. Its jaws close on the target as it comes down, with a flash
 * and lines bursting out round it; the target is jolted and dust is thrown up at its feet. The wolf holds there a
 * moment, then hops back (or settles onto the hex it took). The blow is told when the jaws meet.
 */
function wolfLunge(stage: MoveStage, ctx: MoveCtx) {
  const { figure, hitAt, dir, crit, onImpact } = ctx;
  const flip = dir < 0;
  // Where the wolf's body is just now, wherever the leap has carried it.
  const body = () => {
    const at = figure.root.getWorldPosition(hitAt.clone());
    at.y += 0.5;
    return at;
  };
  // Away from the target, along the ground: the way what it throws off goes.
  const back = body().sub(hitAt).setY(0).normalize();
  const lands = stage.pounce();
  if (lands > 0) {
    // Off the ground: dust kicked back from its feet.
    stage.later(() => {
      const at = body();
      const feet = at.setY(at.y - 0.45);
      for (const lift of [0.15, 0.35]) stage.spawnFx("dust", "#c9b994", !flip, { from: feet, to: feet.clone().addScaledVector(back, 0.7).setY(feet.y + lift), life: 0.4, size: [0.8, 1.4], spin: 0, fade: true });
    }, POUNCE.crouch);
    // Through the air: speed lines streaming off behind it.
    for (let s = POUNCE.crouch; s < lands; s += STREAK_EVERY) {
      stage.later(() => {
        const at = body();
        for (let i = 0; i < 2; i++) {
          const from = at.clone().setY(at.y - 0.3 + Math.random() * 0.65).addScaledVector(back, 0.2 + Math.random() * 0.25);
          stage.spawnFx("streak", crit ? GOLD : STREAK_PALE, flip, { from, to: from.clone().addScaledVector(back, 0.55), life: 0.16, size: [1.1, 0.7], spin: 0, fade: true });
        }
      }, s);
    }
  }
  stage.later(() => {
    jaws(stage, ctx, LUNGE_BITE, 0.4, () => {
      const color = crit ? GOLD : TEETH;
      stage.spawnFx("burst", color, false, { from: hitAt, to: hitAt, life: 0.26, size: [0.9, 2.4], spin: 0.6, fade: true });
      // Lines bursting out from where the jaws met, either side.
      for (const side of [false, true]) for (const turn of [-0.55, -0.15, 0.25, 0.6]) stage.spawnFx("streak", color, side, { from: hitAt, to: hitAt, life: 0.2, size: [0.6, 1.9], turn: side ? -turn : turn, spin: 0, fade: true });
      const feet = hitAt.clone().setY(hitAt.y - 0.45);
      for (const side of [-1, 1]) stage.spawnFx("dust", "#c9b994", side > 0, { from: feet, to: feet.clone().setX(feet.x + side * 0.55).setY(feet.y + 0.3), life: 0.4, size: [0.6, 1.1], spin: 0, fade: true });
      stage.jolt();
      stage.later(() => stage.jolt(), 0.05);
      onImpact();
    });
  }, Math.max(0, lands - LUNGE_BITE));
}

/** How far apart a bear's three claw marks lie across the target, and the seconds between each being torn. */
const CLAW_MARKS = { apart: 0.17, every: 0.025 };

/**
 * Three red claw marks torn across the target one after another, raked the way `dir` says (1: down to the right as
 * the viewer sees it), `at` a little off its middle; `size` scales them.
 */
function clawMarks(stage: MoveStage, at: THREE.Vector3, dir: 1 | -1, color: string, size = 1) {
  const flip = dir < 0;
  [-1, 0, 1].forEach((i, n) =>
    stage.later(() => {
      // Each mark a little further across, and a little lower, than the one before: three parallel rakes.
      const mark = at.clone().setX(at.x + i * CLAW_MARKS.apart * size * dir).setY(at.y - i * CLAW_MARKS.apart * size * 0.5);
      stage.spawnFx("slash", color, flip, { from: mark, to: mark, life: 0.28, size: [1.1 * size, 1.9 * size], turn: (flip ? -1 : 1) * 0.15, spin: (flip ? 1 : -1) * 0.35, fade: true });
    }, n * CLAW_MARKS.every),
  );
}

/** A Maul's claw marks: near black, so they read against any ground. */
const MAUL_BLACK = "#16121c";

/** The bears: what plays a bear's own Maul. */
const BEARS = ["bear", "snow_bear", "great_bear"] as const;

/**
 * A bear's Maul: it rears right up onto its hind legs with both forepaws high, and tears into the target with them by
 * turns, right, left, right, left (figures.ts FLURRY), white swooshes behind its claws and lurching in as it goes.
 * Every blow tears three black claw marks across the target, the way that paw raked, with white slashes flung off
 * round it and a white flash, and jolts it; the last throws black and white lines out all round. The blow is told as
 * the last lands.
 */
function bearMaul(stage: MoveStage, { figure, hitAt, dir, crit, onImpact }: MoveCtx) {
  // Black claw marks and white slashes (all gold on a critical hit).
  const dark = crit ? GOLD : MAUL_BLACK;
  const pale = crit ? GOLD : TEETH;
  const first = figure.strike("flurry");
  // A creature with no flurry of its own springs at the target, and the blows land quick as it does.
  if (first <= 0) stage.lunge();
  const when = FLURRY_BLOWS.map((h) => (first > 0 ? first + h - FLURRY_BLOWS[0] : (h - FLURRY_BLOWS[0]) * 0.6));
  when.forEach((at, n) => {
    const last = n === when.length - 1;
    stage.later(() => {
      if (n > 0) stage.sound();
      // The right paw rakes one way across the target, the left the other.
      const way = (n % 2 === 0 ? dir : -dir) as 1 | -1;
      const middle = hitAt.clone().setY(hitAt.y + 0.12 - n * 0.06);
      clawMarks(stage, middle, way, dark, last ? 1.25 : 1);
      // Slashes flung off round it, every which way.
      for (let k = 0; k < 3; k++) {
        const off = middle.clone().setX(middle.x + (Math.random() - 0.5) * 0.7).setY(middle.y + (Math.random() - 0.5) * 0.6);
        const side = Math.random() < 0.5;
        stage.spawnFx("slash", pale, side, { from: off, to: off, life: 0.2, size: [0.6, 1.2], turn: Math.random() * Math.PI * 2, spin: (side ? 1 : -1) * 0.6, fade: true });
      }
      stage.spawnFx("burst", pale, way < 0, { from: middle, to: middle, life: 0.2, size: [0.5, 1.3], spin: 0.5, fade: true });
      stage.jolt();
      if (!last) return;
      // The last: lines bursting out all round, and the blow told.
      stage.spawnFx("burst", pale, false, { from: hitAt, to: hitAt, life: 0.3, size: [1, 2.6], spin: 0.7, fade: true });
      for (const side of [false, true]) for (const [n, turn] of [-0.6, -0.2, 0.2, 0.6].entries()) stage.spawnFx("streak", n % 2 ? dark : pale, side, { from: hitAt, to: hitAt, life: 0.22, size: [0.6, 2], turn: side ? -turn : turn, spin: 0, fade: true });
      stage.later(() => stage.jolt(), 0.05);
      onImpact();
    }, at);
  });
}

/**
 * A bear's Rending Swipe: it rears back onto its hind legs with a forepaw raised high and out to its side, then
 * comes down on the target, the paw raking down and across its front and leaving a red swoosh behind its claws
 * (figures.ts CLAW). Where they land, three red claw marks are torn across the target one after another, with a
 * spray of red off it; it is jolted, and the blow is told.
 */
function rendingSwipe(stage: MoveStage, { figure, hitAt, dir, crit, onImpact }: MoveCtx) {
  const color = crit ? GOLD : CHEAP_SHOT_RED;
  const wait = figure.strike("claw");
  // A creature with no swipe of its own springs at the target, and the marks land as it does.
  if (wait <= 0) stage.lunge();
  stage.later(() => {
    clawMarks(stage, hitAt, dir, color);
    stage.spawnFx("burst", color, dir < 0, { from: hitAt, to: hitAt, life: 0.22, size: [0.6, 1.5], spin: 0.5, fade: true });
    stage.jolt();
    onImpact();
  }, Math.max(0, wait));
}

const DUST = "#c9b994";
const ROCK = "#8a8070";
const ROCK_PALE = "#a89f8c";
/** A point so far off another. */
const offset = (p: THREE.Vector3, x: number, y: number, z: number) => p.clone().set(p.x + x, p.y + y, p.z + z);

/** A Club Smash's pulse: as far as it spreads (just past the hexes beside the target) and how long it takes. */
const SMASH_PULSE = { radius: 2.3, life: 0.4 };

/**
 * An Ogre's Club Smash: it heaves the club right up over its head and brings it straight down on the target
 * (figures.ts SLAM). Where it lands the ground bursts like a small explosion: a flash, a pulse rolling out over the
 * ground to the hexes all round, a ring of dust thrown out and billowing up, chunks of rock flung out every way in
 * arcs, grit spraying up, and shock lines bursting out. The target is jolted twice, and the blow is told as the club
 * lands. Only the target is smashed: a hero beside it caught by the pulse just flinches (ZoneView, a `splash` hit).
 */
function clubSmash(stage: MoveStage, { figure, hitAt, dir, crit, onImpact }: MoveCtx) {
  const wait = figure.strike("slam");
  // A creature has no slam of its own: it springs at the target, and the ground bursts as it lands.
  if (wait <= 0) stage.lunge();
  stage.later(() => {
    const ground = hitAt.clone().setY(hitAt.y - 0.45);
    const flash = crit ? GOLD : "#fff3d6";
    stage.spawnFx("burst", flash, false, { from: ground, to: ground, life: 0.24, size: [1, 3], spin: 0.6, fade: true });
    // The shock pulsing out over the ground to the hexes all round, where any hero beside the target is caught by it.
    const floor = ground.clone().setY(ground.y + 0.05);
    stage.wave({ at: floor, radius: SMASH_PULSE.radius, life: SMASH_PULSE.life, color: crit ? GOLD : "#f3e7c8", width: 0.1 });
    stage.later(() => stage.wave({ at: floor, radius: SMASH_PULSE.radius * 0.85, life: SMASH_PULSE.life * 1.15, color: DUST, width: 0.3 }), 0.05);
    // Shock lines bursting out from where it landed, all round.
    for (const side of [false, true]) for (const turn of [-0.7, -0.3, 0.1, 0.5]) stage.spawnFx("streak", flash, side, { from: ground, to: ground, life: 0.2, size: [0.7, 2.2], turn: side ? -turn : turn, spin: 0, fade: true });
    // A ring of dust thrown out along the ground and billowing up, then a slower cloud hanging over it.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
      const far = 0.7 + Math.random() * 0.35;
      const to = offset(ground, Math.cos(a) * far, 0.15 + Math.random() * 0.35, Math.sin(a) * far * 0.6);
      stage.spawnFx("dust", DUST, Math.cos(a) < 0, { from: ground, to, life: 0.45 + Math.random() * 0.2, size: [0.7, 1.6], spin: 0, fade: true });
    }
    stage.later(() => {
      for (const x of [-0.35, 0, 0.35]) {
        const at = ground.clone().setX(ground.x + x);
        stage.spawnFx("dust", DUST, x < 0, { from: at, to: at.clone().setY(at.y + 0.7), life: 0.7, size: [1.2, 2.2], spin: 0, fade: true });
      }
    }, 0.08);
    // Chunks of rock flung out every way in arcs, tumbling, and grit sprayed up between them.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
      const far = 0.8 + Math.random() * 0.7;
      const to = offset(ground, Math.cos(a) * far, -0.05, Math.sin(a) * far * 0.6);
      const big = 0.35 + Math.random() * 0.25;
      stage.spawnFx("rock", i % 2 ? ROCK : ROCK_PALE, Math.cos(a) < 0, { from: ground, to, life: 0.4 + Math.random() * 0.2, size: [big, big * 0.8], spin: (Math.random() - 0.5) * 16, fade: false, arc: 0.4 + Math.random() * 0.5 });
    }
    for (let i = 0; i < 8; i++) {
      const to = offset(ground, (Math.random() - 0.5) * 1.4, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4);
      stage.spawnFx("fleck", ROCK_PALE, Math.random() < 0.5, { from: ground, to, life: 0.35, size: [0.4, 0.3], spin: 0, fade: true });
    }
    stage.jolt();
    stage.later(() => stage.jolt(), 0.06);
    onImpact();
  }, Math.max(0, wait));
}

/** An Ogre's Slam wave: as far as it spreads (past every hero two hexes off, ENEMY_BURST) and how long it takes. */
export const SLAM_WAVE = { radius: 3.8, life: 0.6 };

/**
 * An Ogre's Slam: it crouches, springs straight up into the air and comes down flat on its backside (figures.ts
 * SEAT_DROP). As it lands the ground pulses out from under it, a bright wave spreading over the ground with a broad
 * dusty one just behind it, and great clouds of dust rolling out after them and billowing up round it. Each hero is
 * jolted, with dust thrown up at their feet, as the wave reaches them, and the blow on them is told then.
 */
function seatSlam(stage: MoveStage, { figure, hitAt, crit, onImpact, echo, alone }: MoveCtx) {
  const feet = figure.root.getWorldPosition(new THREE.Vector3());
  const ground = feet.clone().setY(feet.y + 0.08);
  const { radius, life } = SLAM_WAVE;
  // Only the first plays the drop: by the time the others are told, it has already landed.
  const lands = echo ? 0 : Math.max(0, figure.strike("drop"));
  if (!echo) stage.later(() => {
    stage.wave({ at: ground, radius, life, color: crit ? GOLD : "#f3e7c8", width: 0.08 });
    stage.later(() => stage.wave({ at: ground, radius: radius * 0.85, life: life * 1.15, color: DUST, width: 0.3 }), 0.06);
    stage.spawnFx("burst", crit ? GOLD : "#fff3d6", false, { from: offset(ground, 0, 0.3, 0), to: offset(ground, 0, 0.3, 0), life: 0.24, size: [1, 3], spin: 0.6, fade: true });
    // Clouds of dust rolling out after the wave, all round, swelling as they go.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.25;
      const far = radius * (0.5 + Math.random() * 0.3);
      const from = offset(ground, Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5);
      const to = offset(ground, Math.cos(a) * far, 0.25 + Math.random() * 0.25, Math.sin(a) * far);
      stage.spawnFx("dust", DUST, Math.cos(a) < 0, { from, to, life: 0.75 + Math.random() * 0.25, size: [0.9, 2.3], spin: 0, fade: true });
    }
    // And a slower cloud billowing up round its feet.
    stage.later(() => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
        const from = offset(ground, Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6);
        stage.spawnFx("dust", DUST, Math.cos(a) < 0, { from, to: offset(from, Math.cos(a) * 0.4, 0.8, Math.sin(a) * 0.4), life: 1, size: [1.4, 2.8], spin: 0, fade: true });
      }
    }, 0.1);
  }, lands);
  if (alone) return stage.later(onImpact, lands);
  // Whoever it reaches is caught as the wave passes under them.
  const far = Math.hypot(hitAt.x - feet.x, hitAt.z - feet.z);
  stage.later(() => {
    const at = hitAt.clone().setY(hitAt.y - 0.45);
    for (const side of [-1, 1]) stage.spawnFx("dust", crit ? GOLD : DUST, side > 0, { from: at, to: offset(at, side * 0.6, 0.4, 0), life: 0.45, size: [0.7, 1.4], spin: 0, fade: true });
    stage.jolt();
    onImpact();
  }, lands + waveReaches(far, radius, life));
}

const FIRE = "#ff7a2a";
const FLAME = "#ffb347";
const FIRE_DEEP = "#d9381e";
const FIRE_FLASH = "#fff1c9";
const SMOKE = "#5a5048";
/** An Immolate's fireball: how long it is in the air, how high it goes over the straight line, and how far its fire spreads. */
export const IMMOLATE = { flight: 0.55, arc: 1.6, spread: 2.0 };

/**
 * A Cultist's Immolate: sparks of fire swirl up round its staff hand as it winds up (the cast), and as it points a
 * fireball leaves the hand with a flare and goes up in a high arc, spinning, embers and wisps of smoke falling off it
 * the whole way. Where it comes down the ground goes up: a white flash and a burst of fire, a ring of flame rolling out
 * over the hexes round it with a deeper red one behind, tongues of flame licking up all over, embers flung out in arcs,
 * and smoke rising after. `hitAt` is over the hex it is thrown at; the blow (on all it catches) is told as it lands.
 */
function immolate(stage: MoveStage, { figure, hitAt, dir, crit, onImpact }: MoveCtx) {
  const hand = () => {
    const held = figure.hands()?.[0];
    if (held) return held.getWorldPosition(new THREE.Vector3());
    const at = figure.root.getWorldPosition(new THREE.Vector3());
    return at.setY(at.y + 1.1);
  };
  const ground = hitAt.clone().setY(hitAt.y - 0.45);
  const wait = Math.max(0, figure.cast());
  // Winding up: sparks of fire swirling in and up round the hand.
  for (let s = 0; s < wait; s += 0.045) {
    stage.later(() => {
      const at = hand();
      const a = Math.random() * Math.PI * 2;
      const from = offset(at, Math.cos(a) * 0.4, -0.25 + Math.random() * 0.2, Math.sin(a) * 0.4);
      stage.spawnFx("spark", Math.random() < 0.5 ? FIRE : FLAME, Math.cos(a) < 0, { from, to: offset(at, Math.cos(a) * 0.1, 0.35, Math.sin(a) * 0.1), life: 0.28, size: [0.55, 0.2], spin: 3, fade: true });
    }, s);
  }
  stage.later(() => {
    const from = hand();
    const { flight, arc, spread } = IMMOLATE;
    stage.spawnFx("burst", FLAME, false, { from, to: from, life: 0.16, size: [0.4, 1], spin: 0.4, fade: true });
    stage.spawnFx("bolt", crit ? GOLD : FIRE, dir < 0, { from, to: ground, life: flight, size: [1.3, 1.5], spin: dir * 7, fade: false, arc, onEnd: () => blast() });
    // Embers and smoke falling off it all the way, along the same arc (WorldRenderer's fx: up by arc·4k(1−k)).
    for (let s = 0.03; s < flight; s += 0.035) {
      stage.later(() => {
        const k = s / flight;
        const at = from.clone().lerp(ground, k);
        at.y += arc * 4 * k * (1 - k);
        stage.spawnFx("fleck", Math.random() < 0.5 ? FIRE : FLAME, Math.random() < 0.5, { from: at, to: offset(at, (Math.random() - 0.5) * 0.35, -0.3, (Math.random() - 0.5) * 0.2), life: 0.32, size: [0.35, 0.2], spin: 0, fade: true });
        if (Math.random() < 0.4) stage.spawnFx("dust", SMOKE, Math.random() < 0.5, { from: at, to: offset(at, 0, 0.25, 0), life: 0.45, size: [0.4, 0.8], spin: 0, fade: true });
      }, s);
    }
    const blast = () => {
      stage.spawnFx("burst", crit ? GOLD : FIRE_FLASH, false, { from: ground, to: ground, life: 0.2, size: [1.2, 3.4], spin: 0.6, fade: true });
      stage.spawnFx("burst", FIRE, true, { from: ground, to: ground.clone().setY(ground.y + 0.3), life: 0.38, size: [1, 2.8], spin: -0.5, fade: true });
      // A ring of flame rolling out over the hexes round it, a deeper red one just behind.
      const floor = ground.clone().setY(ground.y + 0.05);
      stage.wave({ at: floor, radius: spread, life: 0.45, color: FLAME, width: 0.14 });
      stage.later(() => stage.wave({ at: floor, radius: spread * 0.85, life: 0.55, color: FIRE_DEEP, width: 0.32 }), 0.05);
      // Shock lines out from where it struck.
      for (const side of [false, true]) for (const turn of [-0.6, -0.2, 0.2, 0.6]) stage.spawnFx("streak", FLAME, side, { from: ground, to: ground, life: 0.2, size: [0.7, 2], turn: side ? -turn : turn, spin: 0, fade: true });
      // Tongues of flame licking up all over, one after another.
      for (let i = 0; i < 12; i++) {
        stage.later(() => {
          const a = Math.random() * Math.PI * 2;
          const far = Math.sqrt(Math.random()) * spread * 0.6;
          const at = offset(ground, Math.cos(a) * far, 0.05, Math.sin(a) * far * 0.7);
          stage.spawnFx("streak", Math.random() < 0.5 ? FIRE : FLAME, Math.random() < 0.5, { from: at, to: offset(at, 0, 0.6 + Math.random() * 0.5, 0), life: 0.3 + Math.random() * 0.15, size: [0.9, 0.5], turn: Math.PI / 2, spin: 0, fade: true });
          stage.spawnFx("burst", FIRE, Math.random() < 0.5, { from: at, to: offset(at, 0, 0.35, 0), life: 0.3, size: [0.3, 0.9], spin: 0.5, fade: true });
        }, i * 0.03);
      }
      // Embers flung out every way in arcs.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
        const far = 0.7 + Math.random() * 0.9;
        stage.spawnFx("fleck", i % 2 ? FIRE : FLAME, Math.cos(a) < 0, { from: ground, to: offset(ground, Math.cos(a) * far, 0, Math.sin(a) * far * 0.6), life: 0.45 + Math.random() * 0.2, size: [0.4, 0.25], spin: 0, fade: true, arc: 0.5 + Math.random() * 0.5 });
      }
      // And smoke rising after it, slow.
      stage.later(() => {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
          const at = offset(ground, Math.cos(a) * 0.6, 0.2, Math.sin(a) * 0.4);
          stage.spawnFx("dust", SMOKE, Math.cos(a) < 0, { from: at, to: offset(at, Math.cos(a) * 0.3, 1.1, 0), life: 1.1, size: [1, 2.4], spin: 0, fade: true });
        }
      }, 0.15);
      stage.jolt();
      onImpact();
    };
  }, wait);
}

export const SIGNATURE_MOVES: Record<string, SignatureMove> = {
  Immolate: { who: "cultist", blurb: "Sparks swirl round its staff as it winds up, then a fireball goes up in a high arc trailing embers and bursts where it lands: a ring of flame rolling out over the hexes round it, flames licking up, embers flung out and smoke rising.", play: immolate },
  Slam: { who: "ogre", blurb: "Crouches, springs up into the air and lands on its backside: a wave pulses out over the ground from its feet, clouds of dust rolling out after it, and each hero is jolted as it reaches them.", play: seatSlam },
  "Club Smash": { who: "ogre", blurb: "Heaves its club right up over its head and brings it straight down: the ground bursts where it lands, a pulse rolling out to the hexes round it, dust thrown out all round and chunks of rock flung every way.", play: clubSmash },
  Maul: { who: "bear", only: BEARS, blurb: "Rears right up on its hind legs and tears into the target with both forepaws by turns, white swooshes behind its claws, every blow tearing three black claw marks across it with white slashes flung off all round.", play: bearMaul },
  "Rending Swipe": { who: "bear", blurb: "Rears back on its hind legs and rakes a forepaw down across the target, its claws leaving a red swoosh, and three red claw marks torn across it.", play: rendingSwipe },
  Chomp: { who: "troll", blurb: "A snap forward, jaws closing on the target as two red arches.", play: trollChomp },
  Rake: { who: "troll", blurb: "A swing of a long clawed arm, leaving a red swoosh across the target.", play: trollRake },
  Bite: { who: "wolf", blurb: "A snap forward, jaws closing on the target as two white arches.", play: wolfBite },
  "Cheap Shot": { who: "bandit", blurb: "Two quick side slashes, a forehand then a backhand: the sword leaves a red trail, and each cut a flat red swipe across the target.", play: cheapShot },
  Lunge: { who: "wolf", blurb: "A crouch and a leap through the air (from up to 3 hexes off, taking the hex beside its target), dust kicked back and speed lines streaming off it the whole way, jaws snapping shut on the target with a flash as it lands.", play: wolfLunge },
};
