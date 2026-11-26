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

export const SIGNATURE_MOVES: Record<string, SignatureMove> = {
  "Cheap Shot": { who: "bandit", blurb: "Two quick side slashes, a forehand then a backhand, the sword leaving a red trail.", play: cheapShot },
};
