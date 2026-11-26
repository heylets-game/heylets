// Enemy abilities with an animation of their own, beyond the ordinary swing, shot or cast (WorldRenderer.attack):
// the figure's moves and the effects thrown off them, step by step. Keyed by the ability's name, as a fight's
// events carry it.
//
// Each is played on a stage that lends it the effects and the clock: the game's map (WorldRenderer), or the
// figure lab (FigureLab.tsx), where each one has a button of its own. A new one added here shows in both.

import type * as THREE from "three";
import { SLICES_APART, type Figure } from "./figures";
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

/** What a stage lends a move. */
export interface MoveStage {
  spawnFx(kind: FxKind, color: string, flip: boolean, opts: FxOpts): void;
  /** Run this so many seconds on, on the stage's clock (slowed and paused with it, in the lab). */
  later(run: () => void, seconds: number): void;
  /** The attack's sound again, for a swing after the first (the stage plays the first itself). */
  sound(): void;
  /** Spring the attacker at the target: for a creature, which has no swing of its own. */
  lunge(): void;
  /**
   * Leap the attacker bodily at the target and home again after (see pounceAt): a crouch, a jump through the air
   * that comes down in the target's face, a moment there, and a hop back. Returns the seconds until it lands.
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
}

export interface SignatureMove {
  /** Who uses it, by enemy kind, for the lab. */
  who: string;
  /** What it looks like, for the lab's tooltip. */
  blurb: string;
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
 * `short` of the target's middle: in its face, not on top of it.
 */
export const POUNCE = { crouch: 0.14, air: 0.26, hold: 0.2, back: 0.24, gather: 0.22, high: 0.6, homeHop: 0.12, short: 0.6 };
/** Seconds from a pounce's start to its landing, and to its end, home again. */
export const POUNCE_LANDS = POUNCE.crouch + POUNCE.air;
export const POUNCE_OVER = POUNCE_LANDS + POUNCE.hold + POUNCE.back;

const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * Where a pounce has its creature `s` seconds in, at a target `far` away: how far it is toward the target from
 * where it stands (back from it while gathering itself), and how high off the ground.
 */
export function pounceAt(s: number, far: number): { ahead: number; up: number } {
  const reach = Math.max(0, far - POUNCE.short);
  if (s <= 0 || s >= POUNCE_OVER) return { ahead: 0, up: 0 };
  if (s < POUNCE.crouch) return { ahead: -POUNCE.gather * ease(s / POUNCE.crouch), up: 0 };
  s -= POUNCE.crouch;
  if (s < POUNCE.air) {
    const k = s / POUNCE.air;
    return { ahead: -POUNCE.gather + (reach + POUNCE.gather) * k, up: 4 * POUNCE.high * k * (1 - k) };
  }
  s -= POUNCE.air;
  if (s < POUNCE.hold) return { ahead: reach, up: 0 };
  const k = (s - POUNCE.hold) / POUNCE.back;
  return { ahead: reach * (1 - ease(k)), up: 4 * POUNCE.homeHop * k * (1 - k) };
}

const LUNGE_TEETH = "#f4efe2";
/** How long the jaws take to close: they meet as the wolf lands. */
const LUNGE_BITE = 0.1;

/**
 * A wolf's lunge: it gathers itself and leaps at the target, and its jaws close on them as it comes down: two white
 * arches, the upper and the lower, snapping together. The target is jolted and dust is thrown up at its feet as it
 * is borne down; the wolf holds there a moment, then hops back. The blow is told when the jaws meet.
 */
function wolfLunge(stage: MoveStage, { hitAt, dir, crit, onImpact }: MoveCtx) {
  const color = crit ? "#ffd23f" : LUNGE_TEETH;
  // The swipe is drawn as a quarter circle; turned an eighth it lies flat as an arch, and half a turn more turns it over.
  const flat = dir < 0 ? -Math.PI / 4 : Math.PI / 4;
  const lands = stage.pounce();
  stage.later(() => {
    const jaw = (upper: boolean, onEnd?: () => void) => {
      const side = upper ? 1 : -1;
      const from = hitAt.clone().setY(hitAt.y + side * 0.4);
      const to = hitAt.clone().setY(hitAt.y + side * 0.06);
      stage.spawnFx("slash", color, dir < 0, { from, to, life: LUNGE_BITE, size: [1.5, 1.2], turn: upper ? flat : flat + Math.PI, spin: 0, fade: false, onEnd });
    };
    jaw(false);
    jaw(true, () => {
      stage.spawnFx("burst", color, false, { from: hitAt, to: hitAt, life: 0.22, size: [0.7, 1.7], spin: 0.5, fade: true });
      const feet = hitAt.clone().setY(hitAt.y - 0.45);
      for (const side of [-1, 1]) stage.spawnFx("dust", "#c9b994", side > 0, { from: feet, to: feet.clone().setX(feet.x + side * 0.55).setY(feet.y + 0.3), life: 0.4, size: [0.6, 1.1], spin: 0, fade: true });
      stage.jolt();
      stage.later(() => stage.jolt(), 0.05);
      onImpact();
    });
  }, Math.max(0, lands - LUNGE_BITE));
}

export const SIGNATURE_MOVES: Record<string, SignatureMove> = {
  "Cheap Shot": { who: "bandit", blurb: "Two quick side slashes, a forehand then a backhand: the sword leaves a red trail, and each cut a flat red swipe across the target.", play: cheapShot },
  Lunge: { who: "wolf", blurb: "A crouch and a leap through the air at the target, jaws snapping shut on it as two white arches as it lands, dust thrown up at its feet, then a hop back home.", play: wolfLunge },
};
