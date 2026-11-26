// Enemy abilities with an animation of their own, beyond the ordinary swing, shot or cast (WorldRenderer.attack):
// the figure's moves and the effects thrown off them, step by step. Keyed by the ability's name, as a fight's
// events carry it.
//
// Each is played on a stage that lends it the effects and the clock: the game's map (WorldRenderer), or the
// figure lab (FigureLab.tsx), where each one has a button of its own. A new one added here shows in both.

import type * as THREE from "three";
import type { Figure } from "./figures";
import type { FxKind } from "./sprites";

/** One effect sprite: flown from `from` to `to` over `life` seconds, growing from one size to the other. */
export interface FxOpts {
  from: THREE.Vector3;
  to: THREE.Vector3;
  life: number;
  size: [number, number];
  spin: number;
  fade: boolean;
  arc?: number;
  onEnd?: () => void;
}

/** What a stage lends a move. */
export interface MoveStage {
  spawnFx(kind: FxKind, color: string, flip: boolean, opts: FxOpts): void;
  /** Run this so many seconds on, on the stage's clock (slowed and paused with it, in the lab). */
  later(run: () => void, seconds: number): void;
  /** Where the attacker's blade is just now, a little toward the target: where what it throws off starts. */
  bladeAt(): THREE.Vector3;
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

const CHEAP_SHOT_RED = "#e0313f";
/** Seconds after the first cut lands that the second swing begins. */
const CHEAP_SHOT_GAP = 0.08;

/**
 * Two quick swings. Each throws a red wave off the blade at the target, and it lands there as a slash: the first one
 * way, the second the other, so the two cross. The blow is told when the second lands.
 */
function cheapShot(stage: MoveStage, { figure, hitAt, dir, perfect, onImpact }: MoveCtx) {
  const flip = dir < 0;
  const cut = (second: boolean, after: () => void) => {
    stage.spawnFx("wave", CHEAP_SHOT_RED, flip, { from: stage.bladeAt(), to: hitAt, life: 0.12, size: [0.9, 1.7], spin: (second ? dir : -dir) * 0.35, fade: false, onEnd: () => {
      stage.spawnFx("slash", perfect ? "#ffd23f" : CHEAP_SHOT_RED, second ? !flip : flip, { from: hitAt, to: hitAt, life: 0.26, size: [1.3, 2.3], spin: (second ? dir : -dir) * 0.9, fade: true });
      stage.jolt();
      after();
    } });
  };
  const first = figure.strike("light");
  if (first <= 0) {
    stage.lunge();
    cut(false, () => {});
    stage.later(() => cut(true, onImpact), 0.2);
    return;
  }
  stage.later(() => {
    cut(false, () => {});
    stage.later(() => {
      stage.sound();
      stage.later(() => cut(true, onImpact), figure.strike("light"));
    }, CHEAP_SHOT_GAP);
  }, first);
}

export const SIGNATURE_MOVES: Record<string, SignatureMove> = {
  "Cheap Shot": { who: "bandit", blurb: "A quick double cut: each swing throws a red wave off the blade that lands as a slash, the second crossing the first.", play: cheapShot },
};
