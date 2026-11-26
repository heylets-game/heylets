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
  /** A blow has landed on the target: jolt it. */
  jolt(): void;
}

export interface MoveCtx {
  figure: Figure;
  /** Where on the target it lands. */
  hitAt: THREE.Vector3;
  /** Which way the target is from the attacker as the viewer sees it: 1 right, -1 left. */
  dir: 1 | -1;
  /** A perfect hit: what lands is drawn gold, as any perfect blow is. */
  perfect: boolean;
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

/**
 * Two flat side slashes, one each way: a forehand across the front from the right, carried straight on into a
 * backhand from the left (figures.ts SLICES). The sword leaves a red trail as it goes (figures.ts SWOOSH_TINT); the
 * target is jolted by each cut, and the blow is told when the second lands.
 */
function cheapShot(stage: MoveStage, { figure, onImpact }: MoveCtx) {
  const first = figure.strike("slices");
  // A creature has no swing of its own: it springs at the target, and the two cuts land as it does.
  if (first <= 0) stage.lunge();
  stage.later(() => stage.jolt(), first);
  stage.later(() => {
    stage.sound();
    stage.jolt();
    onImpact();
  }, first + (first > 0 ? SLICES_APART : 0.2));
}

const LUNGE_TEETH = "#f4efe2";
/** Seconds into the spring that the wolf is driven on in, still airborne, and that its jaws close. */
const LUNGE_DRIVE = 0.07;
const LUNGE_SNAP = 0.1;

/**
 * A wolf's lunge: it springs at the target and is driven on in, its whole weight behind it, and its jaws close on
 * them: two white arches, the upper and the lower, snapping together. The target is jolted and dust is thrown up
 * at its feet as it is borne down. The blow is told when the jaws meet.
 */
function wolfLunge(stage: MoveStage, { hitAt, dir, perfect, onImpact }: MoveCtx) {
  const color = perfect ? "#ffd23f" : LUNGE_TEETH;
  // The swipe is drawn as a quarter circle; turned an eighth it lies flat as an arch, and half a turn more turns it over.
  const flat = dir < 0 ? -Math.PI / 4 : Math.PI / 4;
  stage.lunge();
  stage.later(() => stage.lunge(), LUNGE_DRIVE);
  stage.later(() => {
    const jaw = (upper: boolean, onEnd?: () => void) => {
      const side = upper ? 1 : -1;
      const from = hitAt.clone().setY(hitAt.y + side * 0.4);
      const to = hitAt.clone().setY(hitAt.y + side * 0.06);
      stage.spawnFx("slash", color, dir < 0, { from, to, life: 0.1, size: [1.5, 1.2], turn: upper ? flat : flat + Math.PI, spin: 0, fade: false, onEnd });
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
  }, LUNGE_SNAP);
}

export const SIGNATURE_MOVES: Record<string, SignatureMove> = {
  "Cheap Shot": { who: "bandit", blurb: "Two quick side slashes, a forehand then a backhand, the sword leaving a red trail.", play: cheapShot },
  Lunge: { who: "wolf", blurb: "A spring driven right in, jaws snapping shut on the target as two white arches, and dust thrown up at its feet.", play: wolfLunge },
};
