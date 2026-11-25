// Low-poly models of the gear, materials and gold: each icon name has a little model built from faceted
// shapes (flat-shaded, like the heroes in render/figures.ts) with its accent parts in the item's rarity
// colour. ui/voxel.ts poses and lights them, frames each one to its picture and inks the outline for the
// item icons; render/figures.ts puts the same weapons and shields in the heroes' hands (see HOLD there), so
// what a hero holds is what is in their bag.
//
// Units are roughly the 16x16 icon's pixels, y up, the item's front toward +z. A model is built upright and
// `lean` tips it in the picture (a long weapon lies on the diagonal), `spin` turns it about its own upright to
// show its depth, `tip` leans the top away to show a little of it.
//
// An icon with no model here, or one an admin has redrawn, is still shown as its pixel art in blocks.

import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C } from "../artKit";
import { parseGarbIcon, type GarbPiece } from "@gantt-quest/world";
import { LOOKS, type Look } from "./looks";

type V3 = [number, number, number];

interface Place {
  at?: V3;
  rot?: V3;
  scale?: V3 | number;
}

/** Paint for one part: a colour, or a colour that glows (crystals, runes, eyes in the dark). */
type Paint = string | { glow: string };

export interface Kit {
  /** The rarity colour, and a darker shade of it. */
  a: string;
  s: string;
  add(geo: THREE.BufferGeometry, paint: Paint | Paint[], place?: Place): THREE.Mesh;
  /** A box with its edges cut off by `bevel`, so it catches the light on every corner. */
  box(w: number, h: number, d: number, paint: Paint, place?: Place, bevel?: number): THREE.Mesh;
  cyl(rTop: number, rBottom: number, h: number, sides: number, paint: Paint | Paint[], place?: Place): THREE.Mesh;
  cone(r: number, h: number, sides: number, paint: Paint, place?: Place): THREE.Mesh;
  ball(r: number, paint: Paint, place?: Place, detail?: number): THREE.Mesh;
  /** A cut crystal: eight faces, `h` tall. */
  gem(r: number, h: number, paint: Paint, place?: Place): THREE.Mesh;
  /** A dome, open at the bottom, `sides` round. */
  dome(r: number, sides: number, paint: Paint, place?: Place): THREE.Mesh;
  /** A shape turned about the upright: [radius, y] from the bottom up. */
  lathe(profile: [number, number][], sides: number, paint: Paint, place?: Place): THREE.Mesh;
  /** A flat outline ([x, y] round it) given `depth`, edges bevelled, centred front to back. */
  plate(outline: [number, number][], depth: number, paint: Paint, place?: Place, bevel?: number): THREE.Mesh;
  /** A round bar bent through `points`. */
  rod(points: V3[], r: number, paint: Paint, place?: Place, sides?: number): THREE.Mesh;
  ring(R: number, r: number, paint: Paint, place?: Place, radial?: number, tubular?: number): THREE.Mesh;
  /** The tightest solid round some points. */
  hull(points: V3[], paint: Paint, place?: Place): THREE.Mesh;
  /** Build some parts together, placed as one (a pair of daggers, a pair of boots). */
  within(place: Place, build: () => void): void;
  /**
   * Build some parts that hang loose from `pivot` (a flail's ball on its chain, a lantern from its hook), in the
   * model's own units as usual: in a hero's hand they swing from there as a pendulum (see figures.ts), weighted
   * at `bob`. In a picture they stay as built.
   */
  dangle(pivot: V3, bob: V3, build: () => void, opts?: Pick<Dangle, "limit" | "clear" | "size" | "mass">): void;
  /**
   * Build some parts that turn freely about the line through `pivot` along `axis` (an armillary sphere's inner
   * rings on its spine): in a hero's hand they turn slowly on their own, or at `speed` (radians a second, a
   * whirlpool's water), and lag behind as the hand turns, then catch up (see figures.ts). In a picture they stay
   * as built.
   */
  spin(pivot: V3, axis: V3, build: () => void, speed?: number): void;
  /**
   * Build one of a set of shapes that flash in turn (a bolt of lightning, each a different fork): in a hero's hand
   * one or none of them shows at a time, changing many times a second (see figures.ts). In a picture only the
   * first is drawn.
   */
  flicker(build: () => void): void;
}

/** What a group made by Kit.spin carries in its userData. */
export interface Spin {
  pivot: V3;
  axis: V3;
  speed?: number;
}

/** What a group made by Kit.dangle carries in its userData. */
export interface Dangle {
  pivot: V3;
  bob: V3;
  /** How far it may swing from where it was built, in radians (a clapper inside its bell). */
  limit?: number;
  /** A haft or pole it cannot swing through: the weight is kept `r` from the line `from` to `to`. */
  clear?: { from: V3; to: V3; r: number };
  /** How big the weight is round `bob`, for keeping it off the body of whoever holds it. */
  size?: number;
  /**
   * How heavy it is at `bob`, against what hangs below it (1 if not given): a length of chain is light beside the
   * ball on its end, so the ball pulls it straight. A dangle built inside another hangs from its end (its `pivot`
   * is the outer one's `bob`), making a chain of joints.
   */
  mass?: number;
}

export interface LowPolyDef {
  build: (k: Kit) => void;
  lean?: number;
  spin?: number;
  tip?: number;
  /** Extra room round the model in its picture, as a share of its size (small things look better smaller). */
  pad?: number;
  /** What one hand holds, when the picture shows more than that (one of a pair of daggers). */
  inHand?: (k: Kit) => void;
}

const DIAG = -Math.PI / 4;

/** Points of a blade `len` long, `w` wide and `t` thick, the last `tip` tapering to a point; diamond in section. */
const bladePoints = (len: number, w: number, t: number, tip: number, from = 0): V3[] => {
  const pts: V3[] = [];
  for (const y of [from, from + len - tip]) pts.push([-w / 2, y, 0], [w / 2, y, 0], [0, y, t / 2], [0, y, -t / 2]);
  pts.push([0, from + len, 0]);
  return pts;
};

/** A box's corners each cut back by `b` along all three edges: the 24 points of a chamfered box. */
const chamferPoints = (w: number, h: number, d: number, b: number): V3[] => {
  const pts: V3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = (sx * w) / 2;
        const y = (sy * h) / 2;
        const z = (sz * d) / 2;
        pts.push([x - sx * b, y, z], [x, y - sy * b, z], [x, y, z - sz * b]);
      }
  return pts;
};

/**
 * The outline of a curved, single-edged blade, for a plate: `len` long from y = 3, its edge toward +x and its
 * point swept back toward -x by `sweep` at the tip. It is `w0` wide at the hilt and `w1` at its broadest, two
 * thirds of the way up, and comes to its point over the last `tip` of its length, the edge rounding in to
 * meet the back.
 */
const curvedBlade = (len: number, sweep: number, w0: number, w1: number, tip: number): [number, number][] => {
  const STEPS = 12;
  const at = (i: number) => {
    const t = i / STEPS;
    const wide = w0 + (w1 - w0) * Math.sin(Math.min(1, t / 0.66) * (Math.PI / 2));
    const taper = t > 1 - tip ? Math.sqrt(Math.max(0, (1 - t) / tip)) : 1;
    return { y: 3 + len * t, x: -sweep * t * t, half: (wide / 2) * taper };
  };
  const edge: [number, number][] = [];
  const back: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const p = at(i);
    edge.push([p.x + p.half * 1.25, p.y]);
    if (i < STEPS) back.unshift([p.x - p.half * 0.75, p.y]);
  }
  return [...edge, ...back];
};

const v3 = ([x, y, z]: V3) => new THREE.Vector3(x, y, z);

/** Push each corner of a rough solid in or out a little, the same way every time, so a stone looks hewn. */
function roughen(geo: THREE.BufferGeometry, by: number, seed: number): THREE.BufferGeometry {
  const g = mergeVertices(geo);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const k = 1 + by * ((n - Math.floor(n)) * 2 - 1);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  return g;
}

// ---------- shared pieces ----------

/** A book standing, its cover toward you: covers, pages, a rounded spine, gold corners. */
function book(k: Kit, cover: Paint, spine: Paint, corner: Paint) {
  k.box(10.5, 13, 0.8, cover, { at: [0, 0, -1.5] }, 0.2);
  k.box(10.5, 13, 0.8, cover, { at: [0, 0, 1.5] }, 0.2);
  k.box(9.8, 12.2, 2.4, C.paper, { at: [0.35, 0, 0] });
  k.cyl(1.9, 1.9, 13, 6, spine, { at: [-5, 0, 0] });
  for (const y of [5.7, -5.7]) k.box(1.7, 1.7, 0.35, corner, { at: [4.5, y, 1.95] }, 0.1);
}

/** A short bow's stave, tips and grip, unstrung: the grip at (3.2, 0, 0), the tips at (-0.5, ±8, 0). */
function bowStave(k: Kit) {
  const stave: V3[] = Array.from({ length: 9 }, (_, i) => {
    const y = -8 + i * 2;
    const t = y / 8;
    return [3.2 * (1 - t * t) - 0.5 * t ** 6, y, 0];
  });
  k.rod(stave, 0.6, C.wood, {}, 6);
  for (const y of [-8, 8]) k.ball(0.6, C.bark, { at: [-0.5, y, 0] });
  k.cyl(0.85, 0.85, 2.8, 6, k.a, { at: [3.2, 0, 0] });
}

/** A dagger, its guard at the origin. */
function dagger(k: Kit) {
  k.hull(bladePoints(8, 1.9, 0.75, 2.6, 0.3), C.steel);
  k.box(4.6, 0.8, 1.2, C.gold, {}, 0.25);
  whipping(k, [0, -1.8, 0], 0.6, 2.4);
  k.ball(0.8, C.gold, { at: [0, -3.5, 0] });
  // The whipping is under the fist, so a turn of the same cord round the pommel and a little knot below it show
  // the rarity in the hand.
  k.ring(0.8, 0.3, k.a, { at: [0, -3.5, 0], rot: [Math.PI / 2, 0, 0] }, 4, 10);
  k.within({ at: [0, -4.1, 0], scale: 0.7 }, () => swordKnot(k, [0, 0, 0]));
}

/** A straight bar from `a` to `b`, `r` thick: one stroke of something drawn in straight lines (a bolt of lightning). */
function bar(k: Kit, a: V3, b: V3, r: number, paint: Paint) {
  const from = v3(a);
  const along = v3(b).sub(from);
  const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize()));
  const mid = from.addScaledVector(along, 0.5);
  k.cyl(r, r, along.length() + r, 4, paint, { at: [mid.x, mid.y, mid.z], rot: [turn.x, turn.y, turn.z] });
}

/**
 * A bolt of lightning down the middle of a glass, from `top` to `bottom` (heights), in an upright plane through
 * its middle turned `turn` round from the front, its kinks reaching `R` either side: a jagged line of short
 * straight strokes, kinked hard left and right, with a fork splitting off part way. `seed` makes each bolt its own.
 */
function lightning(k: Kit, turn: number, R: number, top: number, bottom: number, seed: number, paint: Paint) {
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const on = (a: number, y: number): V3 => [Math.cos(turn) * a * R, y, -Math.sin(turn) * a * R];
  const steps = 6;
  const path: { across: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = top - ((top - bottom) * (i + (i > 0 && i < steps ? (rnd() - 0.5) * 0.5 : 0))) / steps;
    path.push({ across: i === 0 ? 0 : (i % 2 ? 1 : -1) * (0.3 + rnd() * 0.45), y });
  }
  for (let i = 0; i < steps; i++) bar(k, on(path[i].across, path[i].y), on(path[i + 1].across, path[i + 1].y), 0.12, paint);
  // A fork off one of the kinks, out and down to the side it kinked toward.
  const fork = path[2 + Math.floor(rnd() * 2)];
  const out = Math.sign(fork.across) || 1;
  const knee = { across: fork.across + out * 0.55, y: fork.y - 0.6 };
  const tip = { across: knee.across - out * 0.25, y: knee.y - 0.7 };
  bar(k, on(fork.across, fork.y), on(knee.across, knee.y), 0.09, paint);
  bar(k, on(knee.across, knee.y), on(tip.across, tip.y), 0.07, paint);
}

/**
 * Cord whipped tight round a grip or shaft, in the rarity colour, the turns showing: how a weapon shows its
 * rarity, on the stuff of a ship rather than on a gem. Along y, `len` long, centred at `at`.
 */
function whipping(k: Kit, at: V3, r: number, len: number) {
  k.cyl(r, r, len, 6, k.a, { at });
  const turns = Math.max(2, Math.round(len / 0.6));
  for (let i = 1; i < turns; i++) k.cyl(r + 0.05, r + 0.05, 0.14, 6, k.s, { at: [at[0], at[1] - len / 2 + (i * len) / turns, at[2]] });
}

/**
 * A sword knot: a loop of cord from the pommel at `at`, a knot and a tassel, in the rarity colour. Built fast to
 * the hilt, not as a dangle: soldiers and bandits carry these swords too, and a knot left swinging after a fall
 * would keep one who got up from standing as one never knocked down (see ragdoll.test.ts).
 */
function swordKnot(k: Kit, at: V3) {
  const [x, y, z] = at;
  k.rod([[x, y, z], [x + 0.75, y - 1.4, z + 0.2], [x + 0.5, y - 2.6, z]], 0.2, k.a, {}, 4);
  k.ball(0.45, k.s, { at: [x + 0.5, y - 2.8, z] });
  k.cyl(0.25, 0.7, 1.6, 6, k.a, { at: [x + 0.5, y - 3.8, z] });
}

/** A midshipman's dirk, its grip at the origin: a short straight blade, a small brass cross, an ivory grip banded in the trim, a capped pommel. */
function dirk(k: Kit) {
  k.hull(bladePoints(9, 1.7, 0.7, 3, 3), C.steel);
  k.box(4.4, 0.8, 1.3, C.gold, { at: [0, 2.7, 0] }, 0.25);
  for (const x of [-2.3, 2.3]) k.ball(0.55, C.gold, { at: [x, 2.7, 0] });
  k.cyl(0.55, 0.6, 3.4, 6, C.bone, { at: [0, 0.5, 0] });
  k.ball(0.95, C.gold, { at: [0, -1.6, 0] });
  for (const y of [-0.6, 1.6]) k.cyl(0.66, 0.66, 0.4, 6, k.a, { at: [0, y, 0] });
}

/** A gaff hook, its collar at the origin: a bound wooden grip, a steel shank curling over into a barbed point toward +x. */
function gaffHook(k: Kit) {
  k.cyl(0.6, 0.7, 4.4, 6, C.wood, { at: [0, -2.2, 0] });
  for (const y of [-3.3, -1.2]) k.cyl(0.74, 0.74, 0.4, 6, C.leather, { at: [0, y, 0] });
  k.ball(0.75, C.iron, { at: [0, -4.6, 0] });
  k.cyl(0.85, 0.85, 0.9, 6, k.a, { at: [0, 0.3, 0] });
  k.rod([[0, 0.6, 0], [0, 4.5, 0], [0.5, 6.8, 0], [2.2, 7.8, 0], [3.9, 6.9, 0], [4.3, 5, 0]], 0.42, C.steel, {}, 6);
  k.cone(0.5, 1.6, 4, C.shine, { at: [4.3, 4.2, 0], rot: [0, 0, Math.PI] });
  k.cone(0.25, 1.1, 4, C.steel, { at: [4.6, 3.9, 0], rot: [0, 0, -0.6] });
}

/**
 * The chainshot flail: a short haft, and from its iron cap three chains of different lengths, each with a small
 * cannon ball on its end, which hang loose (`loose`: in a hand, straight chains that swing, each on its own).
 */
function flail(k: Kit, loose: boolean) {
  k.cyl(0.6, 0.7, 10, 6, C.wood, { at: [0, -1, 0] });
  whipping(k, [0, -3.8, 0], 0.8, 3);
  k.ball(0.85, C.gold, { at: [0, -6.4, 0] });
  k.cyl(0.95, 0.85, 1.2, 6, k.a, { at: [0, 4.4, 0] });
  k.cyl(0.75, 0.95, 0.9, 6, C.iron, { at: [0, 5.4, 0] });
  // A spider of three short iron arms on the cap, a ring on each, so the chains hang apart.
  const arm = (a: number): V3 => [Math.cos(a) * 1.3, 6.3, Math.sin(a) * 1.3];
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const [x, y, z] = arm(a);
    k.rod([[0, 5.7, 0], [x * 0.6, 6.1, z * 0.6], [x, y, z]], 0.2, C.iron, {}, 5);
    k.ring(0.42, 0.16, C.iron, { at: [x, y + 0.2, z], rot: [0, Math.PI / 2 - a, 0] }, 4, 8);
  }
  const links = (chain: THREE.Curve<THREE.Vector3>, n: number, last: boolean, first = 0) => {
    for (let i = 0; i <= n; i++) {
      if (i === n && !last) continue;
      const t = i / n;
      const at = chain.getPoint(t);
      const along = chain.getTangent(t);
      const link = k.ring(0.5, 0.17, C.iron, { at: [at.x, at.y, at.z], scale: [1.5, 1, 1] }, 4, 6);
      link.rotation.order = "ZYX";
      link.rotation.set((first + i) % 2 ? Math.PI / 2 : 0, 0, Math.atan2(along.y, along.x));
    }
  };
  const R = 1.3;
  // Each shot: where its chain hangs from, where the ball is and (for the picture) the way its chain curls over,
  // and how long its chain is in the hand: short, middling and long, so the three hang in a staggered cluster.
  const pivot = (a: number): V3 => {
    const [x, y, z] = arm(a);
    return [x, y + 0.4, z];
  };
  const shots: { pivot: V3; ball: V3; curl: V3[]; hang: number }[] = [
    { pivot: pivot(0), ball: [5.4, 4.9, 0.6], curl: [[2.6, 8.1, 0.3], [4.1, 7.9, 0.5], [5.3, 6.3, 0.6]], hang: 1.6 },
    { pivot: pivot((Math.PI * 4) / 3), ball: [3.2, 0.9, -0.9], curl: [[0.4, 7.6, -1.1], [2.3, 5.9, -1], [3.2, 2.3, -0.9]], hang: 3.0 },
    { pivot: pivot((Math.PI * 2) / 3), ball: [7.0, 1.6, 0.6], curl: [[0.6, 8.8, 1.1], [4.6, 8.9, 0.8], [6.8, 6.6, 0.6], [7.1, 3.0, 0.6]], hang: 4.4 },
  ];
  const shot = (at: V3) => k.ball(R, "#5b5f68", { at }, 1);
  const weight = { clear: { from: [0, 5.5, 0] as V3, to: [0, -7, 0] as V3, r: 2.2 }, size: R };
  for (const s of shots) {
    if (!loose) {
      // The picture: each chain curled over from the cap to its ball.
      k.dangle(s.pivot, s.ball, () => {
        links(new THREE.CatmullRomCurve3([v3(s.pivot), ...s.curl.map(v3)]), 6, true);
        shot(s.ball);
      }, weight);
      continue;
    }
    // In hand: a straight chain `hang` long, out the way the picture's ball lies, jointed half way, so it bends as
    // it swings; the ball on the lower half.
    const along = v3(s.ball).sub(v3(s.pivot)).normalize();
    const end = v3(s.pivot).addScaledVector(along, s.hang);
    const ball = end.clone().addScaledVector(along, R * 0.95).toArray() as V3;
    const knee = v3(s.pivot).lerp(end, 0.5);
    const kneeAt = knee.toArray() as V3;
    const n = Math.max(1, Math.round(s.hang / 2.2));
    k.dangle(s.pivot, kneeAt, () => {
      links(new THREE.LineCurve3(v3(s.pivot), knee), n, false);
      k.dangle(kneeAt, ball, () => {
        links(new THREE.LineCurve3(knee, end), n, true, n);
        shot(ball);
      }, weight);
    }, { size: 0.6, mass: 0.25 });
  }
}

/** One boot, toe toward +z. */
function boot(k: Kit) {
  k.cyl(1.9, 2.1, 7, 6, C.leather, { at: [0, 2.5, 0] });
  k.box(3.8, 2.8, 7, C.leather, { at: [0, -1.5, 1.6] }, 0.9);
  k.box(4, 0.8, 7.6, C.bark, { at: [0, -3.2, 1.8] }, 0.25);
  k.box(3.2, 1.2, 2, C.bark, { at: [0, -3.8, -1.3] }, 0.2);
  k.cyl(2.45, 2.35, 1.6, 6, k.a, { at: [0, 6.6, 0] });
}

/** A pair of boots or shoes as the sea boots stand, side by side and turned a little: `one` builds one, toe toward +z. */
function bootPair(k: Kit, one: () => void) {
  k.within({ at: [-2.6, 0, -0.6], rot: [0, -0.45, 0] }, one);
  k.within({ at: [2.6, 0, 0.4], rot: [0, -0.3, 0] }, one);
}

/** Three cast bars, two below and one across them. */
function ingots(k: Kit, color: string) {
  const bar: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar.push([sx * 4.4, 0, sz * 1.9], [sx * 3.4, 2.2, sz * 1.2]);
  k.hull(bar, color, { at: [0, -2.2, -2.2] });
  k.hull(bar, color, { at: [0, -2.2, 2.2] });
  k.hull(bar, color, { at: [0, 0.05, 0], rot: [0, Math.PI / 2, 0] });
}

/** A mushroom of size `s` standing at (x, z). */
function mushroom(k: Kit, x: number, z: number, s: number) {
  k.cyl(0.85 * s, 1.1 * s, 4 * s, 6, C.paper, { at: [x, 2 * s, z] });
  k.cyl(2.8 * s, 2.8 * s, 0.25, 8, "#e8d6b0", { at: [x, 4 * s, z] });
  k.dome(3 * s, 8, "#b8452f", { at: [x, 4 * s, z], scale: [1, 0.7, 1] });
  for (const [a, up] of [[0.4, 0.55], [2.3, 0.6], [4.1, 0.5], [5.4, 0.85]] as const) {
    const r = 3 * s * Math.cos(up);
    k.ball(0.5 * s, C.paper, { at: [x + Math.cos(a) * r, 4 * s + 2.1 * s * Math.sin(up), z + Math.sin(a) * r] });
  }
}

/** A heart's outline, `size` across, its point at the bottom. */
const heartOutline = (size: number): [number, number][] =>
  Array.from({ length: 18 }, (_, i) => {
    const t = (i / 18) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [(x * size) / 32, (y * size) / 32] as [number, number];
  });

// ---------- the models ----------

export const LOW_POLY: Record<string, LowPolyDef> = {
  // ---- weapons ----
  broadsword: {
    lean: DIAG,
    build: (k) => {
      k.hull(bladePoints(13.5, 2.7, 0.9, 3.2, 3), C.steel);
      k.box(8, 1.1, 1.6, C.gold, { at: [0, 2.7, 0] }, 0.3);
      for (const x of [-4.1, 4.1]) k.ball(0.75, C.gold, { at: [x, 2.7, 0] });
      whipping(k, [0, 0.3, 0], 0.65, 3.8);
      k.ball(1.15, C.gold, { at: [0, -2, 0] });
      swordKnot(k, [0, -2.9, 0]);
    },
  },
  "hammer-drop": {
    // The Anchor Mace: a grappling iron on a stout haft. Four hooked tines spring from the crown at its head and
    // curve out and down, their barbed points turned back up; a ring on top, a collar in the rarity colour where
    // the iron meets the wood, a coil of line wound round the haft below it and a wrapped grip.
    lean: -0.6,
    spin: 0.6,
    build: (k) => {
      const iron = "#4f535b";
      const rope = "#c9b58a";
      k.cyl(0.62, 0.72, 11, 6, C.wood, { at: [0, -0.5, 0] });
      k.ring(0.7, 0.22, C.iron, { at: [0, -6.6, 0] }, 4, 10);
      whipping(k, [0, -3.6, 0], 0.8, 3.4);
      // The coil of line round the haft, and its end hanging.
      for (let i = 0; i < 4; i++) k.ring(0.95, 0.24, rope, { at: [0, 1.0 + i * 0.42, 0], rot: [Math.PI / 2, 0, i * 0.1] }, 5, 12);
      k.rod([[0.85, 1.0, 0.3], [1.15, 0.0, 0.4], [1.0, -1.1, 0.3]], 0.17, rope, {}, 4);
      // The iron: a collar banded in the trim, the shank up to the crown, and a ring on top.
      k.cyl(0.95, 0.85, 0.9, 6, iron, { at: [0, 3.5, 0] });
      k.cyl(1.0, 1.0, 0.5, 6, k.a, { at: [0, 4.15, 0] });
      k.cyl(0.5, 0.62, 5.2, 6, iron, { at: [0, 6.8, 0] });
      k.ball(1.05, iron, { at: [0, 9.5, 0] });
      k.ring(0.75, 0.24, iron, { at: [0, 10.9, 0] }, 4, 10);
      // The tines: up and out from the crown, over, and down, each ending in an arrowhead point turned back up.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.35;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        const at = (r: number, y: number): V3 => [c * r, y, s * r];
        k.rod([at(0.5, 9.6), at(1.7, 10.4), at(2.9, 9.8), at(3.45, 8.2), at(3.2, 6.7)], 0.46, iron, {}, 5);
        // The point: a flat, broad arrowhead, its tip turned up and in toward the shank.
        const dir = new THREE.Vector3(-c * 0.3, 1, -s * 0.3).normalize();
        const turn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
        const face = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().setFromEuler(turn).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a)),
        );
        k.cone(0.85, 1.7, 4, C.steel, { at: at(3.05, 6.6), rot: [face.x, face.y, face.z], scale: [1, 1, 0.45] });
      }
    },
  },
  "wizard-staff": {
    // The Squall Staff: a straight ash staff with a rope grip, and at its head a storm glass, a brass cage round
    // a glass with a dark squall turning inside it and lightning zapping through.
    lean: DIAG,
    build: (k) => {
      const ash = "#b48d5e";
      k.cyl(0.58, 0.68, 17.4, 6, ash, { at: [0, -1.5, 0] });
      k.cyl(0.78, 0.62, 1, 6, C.gold, { at: [0, -10.3, 0] });
      whipping(k, [0, -1, 0], 0.78, 3.4);
      k.cyl(0.95, 0.78, 1, 8, C.gold, { at: [0, 6.9, 0] });
      // The cage: a cap below and above, four bars between, and a ring to hang it by.
      k.cyl(2.25, 2.0, 0.8, 8, C.gold, { at: [0, 7.7, 0] });
      k.cyl(2.0, 2.25, 0.8, 8, C.gold, { at: [0, 13.7, 0] });
      k.cone(1.6, 1.3, 8, C.gold, { at: [0, 14.75, 0] });
      k.ring(0.6, 0.18, C.gold, { at: [0, 15.75, 0] }, 4, 10);
      for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2 + Math.PI / 4;
        k.cyl(0.2, 0.2, 5.6, 4, C.gold, { at: [Math.cos(t) * 1.95, 10.7, Math.sin(t) * 1.95] });
      }
      // Glints on the glass, between the bars.
      for (const t of [0.25, Math.PI - 0.25]) k.box(0.14, 4.2, 0.14, C.shine, { at: [Math.sin(t) * 1.8, 10.9, Math.cos(t) * 1.8] });
      // The squall: dark storm cloud swirling round inside the glass, in puffs with gaps between, so the
      // lightning down its middle shows through.
      k.spin([0, 10.7, 0], [0, 1, 0], () => {
        for (let i = 0; i < 6; i++) {
          const t = i * 2.4;
          const y = 8.5 + i * 0.85;
          k.ball(0.72 + (i % 2) * 0.12, ["#46505e", "#5b6574", "#6f7a8a"][i % 3], { at: [Math.cos(t) * 1.05, y, Math.sin(t) * 1.05] }, 1);
        }
      });
      // Lightning zapping down the middle of it: a different fork each flash, now this way, now that, now none.
      for (const [turn, seed] of [[0.3, 11], [1.7, 47], [-1.1, 83], [2.6, 131], [0.9, 197]] as const) {
        k.flicker(() => lightning(k, turn, 1, 13.0, 8.4, seed, { glow: "#eefaff" }));
      }
    },
  },
  "scroll-unfurled": {
    // A closed tome.
    spin: 0.55,
    tip: 0.25,
    lean: 0.12,
    build: (k) => {
      book(k, k.a, k.s, C.gold);
      k.cyl(2.4, 2.4, 0.5, 6, C.gold, { at: [0.5, 1, 1.95], rot: [Math.PI / 2, 0, 0] });
      k.cyl(1.2, 1.2, 0.4, 6, k.s, { at: [0.5, 1, 2.25], rot: [Math.PI / 2, 0, 0] });
      k.box(0.8, 2.6, 0.2, C.gold, { at: [2, -7.4, 0] });
    },
  },
  daggers: {
    spin: 0.3,
    inHand: dagger,
    build: (k) => {
      k.within({ at: [0, 0, -0.5], rot: [0, 0, 0.62] }, () => dagger(k));
      k.within({ at: [0, 0, 0.5], rot: [0, 0, -0.62] }, () => dagger(k));
    },
  },
  crossbow: {
    // A short bow with an arrow nocked: the stave on one diagonal, the arrow on the other.
    lean: -DIAG,
    spin: 0.3,
    // In an archer's hand, the stave alone: the figure strings it and nocks an arrow of its own, to draw (see figures.ts).
    inHand: bowStave,
    build: (k) => {
      bowStave(k);
      k.cyl(0.12, 0.12, 16, 3, C.paper, { at: [-0.5, 0, 0] });
      k.cyl(0.25, 0.25, 10.5, 4, C.paper, { at: [3.6, 0, 0.9], rot: [0, 0, Math.PI / 2] });
      k.cone(0.75, 2, 4, C.steel, { at: [9.6, 0, 0.9], rot: [0, 0, -Math.PI / 2] });
      for (const r of [0, Math.PI / 2]) k.box(2.4, 1.3, 0.12, k.a, { at: [-0.4, 0, 0.9], rot: [r, 0, 0] });
    },
  },
  "root-staff": {
    // A crooked staff, roots curled round a stone at the head, a leaf budding.
    lean: DIAG,
    build: (k) => {
      k.rod([[0, -10, 0], [0.6, -5, 0.3], [-0.5, 0, 0], [0.7, 4, -0.3], [0, 7.2, 0]], 0.75, C.wood, {}, 6);
      k.ball(0.75, C.wood, { at: [0, -10, 0] });
      k.rod([[0, 7, 0], [-1.6, 8.5, 0.5], [-2.5, 10.5, 0], [-1.3, 12.2, 0]], 0.45, C.wood, {}, 5);
      k.rod([[0, 7, 0], [1.5, 9, -0.3], [2.3, 11, 0.2], [1.2, 12.7, 0.4]], 0.45, C.bark, {}, 5);
      k.rod([[0, 7, 0], [0.2, 9.5, 0.9], [-0.3, 11.8, 0.5]], 0.4, C.bark, {}, 5);
      k.ball(1.4, "#8d8f86", { at: [0, 10.4, 0] });
      whipping(k, [0, 6.4, 0], 0.85, 1.6);
      k.add(new THREE.OctahedronGeometry(1), "#a6d06a", { at: [2.3, 4.6, 0.2], rot: [0, 0, -0.9], scale: [1.2, 2.1, 0.35] });
      k.add(new THREE.OctahedronGeometry(1), "#7fae4a", { at: [-1.9, 1.4, 0], rot: [0, 0, 0.8], scale: [1, 1.8, 0.3] });
    },
  },
  sickle: {
    lean: -0.25,
    spin: 0.5,
    build: (k) => {
      k.cyl(0.7, 0.6, 7, 6, C.wood, { at: [0, -3.5, 0] });
      k.cyl(0.85, 0.85, 1, 6, k.a, { at: [0, 0.2, 0] });
      const deg = Math.PI / 180;
      const outline: [number, number][] = [];
      for (let d = 200; d >= -20; d -= 20) outline.push([3.5 + 4.6 * Math.cos(d * deg), 2.5 + 4.6 * Math.sin(d * deg)]);
      outline.push([8.4, -0.5]);
      for (let d = -20; d <= 200; d += 20) outline.push([3.9 + 3.3 * Math.cos(d * deg), 2 + 3.3 * Math.sin(d * deg)]);
      k.plate(outline, 0.5, C.steel, {}, 0.15);
    },
  },
  lute: {
    lean: DIAG,
    spin: 0.4,
    build: (k) => {
      k.dome(4.5, 10, C.leather, { at: [0, -3, 0], rot: [-Math.PI / 2, 0, 0], scale: [1, 0.6, 1.25] });
      k.cyl(4.5, 4.5, 0.4, 10, "#c99a5c", { at: [0, -3, 0.2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.25] });
      k.cyl(1.3, 1.3, 0.2, 8, C.dark, { at: [0, -1.4, 0.45], rot: [Math.PI / 2, 0, 0] });
      k.box(3, 0.6, 0.5, C.bark, { at: [0, -5.6, 0.6] });
      k.box(1.8, 9, 1, C.wood, { at: [0, 5.6, 0.2] });
      k.box(1.5, 9, 0.3, C.bark, { at: [0, 5.6, 0.85] });
      k.box(2, 3.2, 1, k.a, { at: [0, 11.3, -0.8], rot: [-0.6, 0, 0] }, 0.2);
      for (const x of [-0.5, -0.17, 0.17, 0.5]) k.box(0.12, 15.6, 0.12, C.paper, { at: [x, 2.2, 1.08] });
    },
  },
  flute: {
    lean: DIAG,
    spin: 0,
    build: (k) => {
      k.cyl(0.85, 0.85, 16, 8, C.paper, {});
      k.cyl(1.02, 1.02, 0.9, 8, k.a, { at: [0, 7.1, 0] });
      k.cyl(1.02, 1.02, 0.7, 8, C.gold, { at: [0, -7.5, 0] });
      k.cyl(1.02, 1.02, 0.5, 8, C.gold, { at: [0, 3.6, 0] });
      k.cyl(0.48, 0.48, 0.3, 6, C.dark, { at: [0, 5.4, 0.78], rot: [Math.PI / 2, 0, 0] });
      for (const y of [1.6, -0.2, -2, -3.8, -5.6]) k.cyl(0.36, 0.36, 0.3, 6, C.dark, { at: [0, y, 0.78], rot: [Math.PI / 2, 0, 0] });
    },
  },
  accordion: {
    // A squeeze box, built along its length (y), the top edge toward -x: a lacquered end board at each end, the
    // treble one keyed on its face and the bass one studded with buttons, pleated bellows between and a strap
    // along the top in the rarity colour. Laid on its side in the picture; held by an end board in each hand.
    lean: -Math.PI / 2,
    spin: 0.35,
    tip: 0.15,
    build: (k) => {
      const lacquer = "#b8333a";
      for (const s of [-1, 1]) {
        k.box(7.4, 2.2, 4.6, lacquer, { at: [0, s * 6.4, 0] }, 0.3);
        k.box(7.6, 0.35, 4.8, C.gold, { at: [0, s * 7.6, 0] }, 0.1);
      }
      // The bellows: folds standing out pale, and the dark between them.
      for (let i = 0; i <= 20; i++) {
        const y = -5 + i * 0.5;
        if (i % 2 === 0) k.box(6.9, 0.32, 4.3, C.paper, { at: [0, y, 0] }, 0.08);
        else k.box(6.2, 0.5, 3.7, C.dark, { at: [0, y, 0] });
      }
      // The treble keys, white with the black among them, and the bass buttons.
      for (let i = 0; i < 7; i++) k.box(0.8, 1.6, 0.35, C.bone, { at: [-2.7 + i * 0.9, -6.5, 2.42] }, 0.06);
      for (const i of [0, 1, 3, 4, 5]) k.box(0.45, 0.9, 0.3, C.dark, { at: [-2.25 + i * 0.9, -6.1, 2.66] });
      for (const x of [-2.1, -0.7, 0.7, 2.1]) for (const y of [5.9, 6.9]) k.cyl(0.32, 0.32, 0.3, 6, C.shine, { at: [x, y, 2.42], rot: [Math.PI / 2, 0, 0] });
      k.box(0.5, 10.6, 1.6, k.a, { at: [-3.95, 0, -1.1] }, 0.1);
    },
  },
  orb: {
    lean: -0.2,
    build: (k) => {
      // An armillary sphere: a fixed brass frame (a meridian and a horizon ring) round a brass globe on the axis
      // rod, and inside it two rings that turn about the rod on their own (see Kit.spin), lagging as the hand turns;
      // the tilted one enamelled in the rarity colour.
      k.ball(1.6, C.gold, { at: [0, 3.6, 0] }, 1);
      k.rod([[0, -1.2, 0], [0, 8.6, 0]], 0.22, C.gold, {}, 6);
      k.ball(0.45, C.gold, { at: [0, 8.8, 0] });
      k.ring(4.6, 0.34, C.gold, { at: [0, 3.6, 0] }, 6, 20);
      k.ring(4.6, 0.3, C.gold, { at: [0, 3.6, 0], rot: [Math.PI / 2, 0, 0] }, 6, 20);
      k.spin([0, 3.6, 0], [0, 1, 0], () => {
        k.ring(3.9, 0.3, C.gold, { at: [0, 3.6, 0], rot: [0, Math.PI / 2, 0] }, 6, 20);
        k.ring(3.4, 0.34, k.a, { at: [0, 3.6, 0], rot: [Math.PI / 2, 0, 0.45] }, 6, 18);
      });
      k.cyl(1.4, 0.9, 1.2, 6, C.gold, { at: [0, -1.5, 0] });
      k.cyl(0.7, 0.8, 6, 6, C.wood, { at: [0, -5, 0] });
      whipping(k, [0, -5, 0], 0.82, 3);
      k.ball(0.85, C.gold, { at: [0, -8.2, 0] });
    },
  },
  scepter: {
    lean: DIAG,
    build: (k) => {
      k.cyl(0.55, 0.65, 13, 6, C.gold, { at: [0, -3, 0] });
      for (const y of [-9.6, -2.2]) k.cyl(0.9, 0.9, 0.6, 6, "#b8891f", { at: [0, y, 0] });
      whipping(k, [0, -5.9, 0], 0.7, 3.6);
      k.cyl(3, 3, 0.6, 6, k.a, { at: [0, 5, 0] });
      k.lathe([[0, 3.2], [1.6, 3.6], [2.6, 5], [2.4, 6.6], [1.4, 7.5], [0, 7.8]], 6, C.gold);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.cone(0.4, 1.4, 4, C.gold, { at: [Math.cos(a) * 1.9, 7.7, Math.sin(a) * 1.9] });
      }
      k.ball(1.45, "#7f9c96", { at: [0, 8.6, 0], scale: [1, 1.2, 1] });
    },
  },
  "pager-axe": {
    // A long haft and a broad bearded blade.
    lean: DIAG,
    spin: 0.4,
    build: (k) => {
      k.cyl(0.6, 0.7, 20, 6, C.wood, { at: [0, -2, 0] });
      for (const y of [-10, 2.4]) k.cyl(0.82, 0.82, 1.3, 6, k.a, { at: [0, y, 0] });
      k.ball(0.8, C.iron, { at: [0, 8.2, 0] });
      k.box(1.8, 5, 1.6, C.iron, { at: [0, 5.4, 0] }, 0.3);
      k.plate([[0.6, 7.6], [3, 7.9], [6.2, 9.6], [6.9, 6], [6.5, 2], [5.2, -0.8], [3.6, 1.5], [1.8, 3.1], [0.6, 3.3]], 0.6, C.steel, {}, 0.22);
      k.cone(0.6, 2.6, 4, C.iron, { at: [-1.9, 5.6, 0], rot: [0, 0, Math.PI / 2] });
    },
  },
  maul: {
    // A ship's anchor swung upside down, rusted and hung with weed: gripped low on a broad flat shank, the eye
    // and a length of chain under the fist, and up top a pointed crown whose arms spread in a wide, shallow arc
    // to big barbed flukes. Rope wound round the grip, banded in the accent.
    lean: DIAG,
    spin: 0.5,
    build: (k) => {
      const rust = "#7a4b34";
      const dark = "#5a3626";
      const weed = "#6f6a2c";
      k.box(1.7, 18, 1.1, rust, { at: [0, -1.2, 0] }, 0.25);
      k.cyl(1.15, 1.15, 3.6, 6, C.leather, { at: [0, -9, 0] });
      k.cyl(1.2, 1.2, 0.6, 6, k.a, { at: [0, -7, 0] });
      k.ring(1.45, 0.42, dark, { at: [0, -12.5, 0] }, 6, 10);
      k.ring(0.75, 0.22, C.iron, { at: [0, -14.6, 0], rot: [0, Math.PI / 2, 0] }, 4, 8);
      k.ring(0.75, 0.22, C.iron, { at: [0, -15.9, 0] }, 4, 8);
      // The crown and arms: one broad crescent, pointed at the top.
      k.plate([[-6.9, 6.7], [-5.4, 8.5], [-3, 9.6], [0, 11], [3, 9.6], [5.4, 8.5], [6.9, 6.7], [6, 6.1], [4.6, 7.3], [2.6, 8.1], [0.9, 8.3], [-0.9, 8.3], [-2.6, 8.1], [-4.6, 7.3], [-6, 6.1]], 1.4, rust, {}, 0.3);
      for (const s of [-1, 1]) {
        // A fluke: a spade on the arm's end, its point down toward the fist and a barb out to the side.
        const f: [number, number][] = [[5.3, 7.3], [6.8, 8.2], [9, 7.8], [7.8, 6.6], [6.6, 3.5]];
        k.plate(s > 0 ? f : f.map(([x, y]) => [-x, y] as [number, number]).reverse(), 0.9, dark, {}, 0.2);
      }
      // Weed hanging off the arms and wound round the shank.
      for (const [x, z] of [[2.6, 0.8], [-4.4, -0.75], [5.6, 0.6]]) {
        k.rod([[x, 9.2 - Math.abs(x) * 0.25, z], [x + 0.3, 7, z * 1.1], [x - 0.2, 5.2, z], [x + 0.2, 4, z * 0.9]], 0.18, weed, {}, 4);
      }
      k.rod([[0.95, 6, 0.7], [-0.95, 4.6, 0.7], [-0.95, 4, -0.7], [0.95, 2.6, -0.7], [0.95, 2, 0.7], [-0.6, 0.6, 0.75], [-0.3, -1.4, 0.8]], 0.2, weed, {}, 4);
    },
  },
  grimoire: {
    // A dark book, clasped and strapped, a brass boss on the cover and a ribbon marker hanging out.
    spin: 0.55,
    tip: 0.25,
    lean: 0.12,
    build: (k) => {
      book(k, "#2e2440", "#3a2a4a", C.iron);
      k.ring(2.5, 0.35, C.gold, { at: [0.4, 0.6, 2.05] }, 4, 10);
      k.cyl(1, 1, 0.4, 8, C.gold, { at: [0.4, 0.6, 2.1], rot: [Math.PI / 2, 0, 0] });
      k.box(1.1, 4.2, 0.12, k.a, { at: [1.8, -7.6, 0.3], rot: [0, 0, 0.15] });
      k.box(10.6, 1.3, 4.5, k.a, { at: [0, -2.6, 0] }, 0.1);
      k.box(2.2, 2.4, 4.4, C.gold, { at: [5.3, 0, 0] }, 0.3);
    },
  },
  // ---- sea blades: built like the broadsword (the blade up from y = 3, the grip at the origin), a curved one
  // with its edge toward +x, so the picture shows the curve; in the hand it is turned edge on (see figures.ts).
  cutlass: {
    // A sailor's cutlass: a short, broad, curved blade with a clipped point, and a brass shell and bow round the hand.
    lean: DIAG,
    build: (k) => {
      k.plate(curvedBlade(12.5, 2.4, 2.2, 3.1, 0.3), 0.7, C.steel, {}, 0.25);
      k.box(0.5, 9, 0.2, C.shine, { at: [-0.9, 8, 0.4], rot: [0, 0, 0.14] });
      k.cyl(2.1, 1.7, 0.6, 10, C.gold, { at: [0.3, 2.7, 0] });
      k.rod([[2.0, 2.6, 0], [3.0, 0.9, 0], [2.6, -1.3, 0], [0.5, -2.1, 0]], 0.38, C.gold, {}, 5);
      whipping(k, [0, 0.3, 0], 0.68, 3.8);
      k.ball(1.1, C.gold, { at: [0, -2.1, 0] });
      swordKnot(k, [0, -2.9, 0]);
    },
  },
  sabre: {
    // An officer's sabre: a long, slim blade with a deep curve, a slender guard and knuckle bow, a wired grip.
    lean: DIAG,
    build: (k) => {
      k.plate(curvedBlade(15.5, 3.6, 1.5, 1.7, 0.22), 0.55, C.steel, {}, 0.2);
      k.box(4.2, 0.6, 1.1, C.gold, { at: [0.2, 2.75, 0] }, 0.2);
      k.ball(0.5, C.gold, { at: [-2, 2.75, 0] });
      k.rod([[2.2, 2.7, 0], [2.9, 1.0, 0], [2.4, -1.3, 0], [0.4, -2.2, 0]], 0.26, C.gold, {}, 5);
      k.cyl(0.55, 0.6, 4, 6, C.dark, { at: [0, 0.3, 0] });
      for (const y of [-0.7, 0.3, 1.3]) k.cyl(0.66, 0.66, 0.22, 6, C.gold, { at: [0, y, 0] });
      k.ball(0.95, C.gold, { at: [0, -2.2, 0] });
      swordKnot(k, [0, -3, 0]);
    },
  },
  rapier: {
    // A rapier: a long, narrow, straight blade for the point, behind a cup, a ring and long quillons, with a knuckle bow.
    lean: DIAG,
    build: (k) => {
      k.hull(bladePoints(16, 1.0, 0.7, 4, 3), C.steel);
      k.lathe([[0.5, 2.2], [1.7, 2.6], [2.2, 3.4], [2.3, 3.9]], 10, C.steel);
      k.box(7, 0.5, 0.6, C.gold, { at: [0, 2.3, 0] }, 0.15);
      for (const x of [-3.6, 3.6]) k.ball(0.5, C.gold, { at: [x, 2.3, 0] });
      k.rod([[2.0, 2.3, 0], [2.6, 0.7, 0], [2.1, -1.4, 0], [0.4, -2.2, 0]], 0.24, C.gold, {}, 5);
      whipping(k, [0, 0.2, 0], 0.55, 3.8);
      k.ball(0.95, C.gold, { at: [0, -2.2, 0] });
      swordKnot(k, [0, -3, 0]);
    },
  },
  dirk: {
    // A midshipman's dirk, alone: the knife a Rogue's archer draws for close work (see figures.ts).
    lean: DIAG,
    pad: 0.25,
    build: dirk,
  },
  dirks: {
    // The Rogue's Twin Gutting Knives: a pair of dirks, crossed at the guards.
    spin: 0.3,
    inHand: dirk,
    build: (k) => {
      for (const s of [-1, 1]) k.within({ at: [0, 0, s * 0.5], rot: [0, 0, -s * 0.62] }, () => k.within({ at: [0, -2.7, 0] }, () => dirk(k)));
    },
  },
  // ---- guns and the crossbow: the barrel up the model, muzzle at the top. A gun's grip and stock fall away
  // toward -x, so the picture shows it side on (turned half round, so the stock hangs underneath, not above); the crossbow's top is toward +z, so the picture looks down on
  // its bow. In the hand they are turned to point ahead (see GUN and BOLT in figures.ts).
  pistol: {
    // A flintlock: an iron barrel on a walnut stock, a curved grip with a capped butt, a cock and a brass guard.
    lean: -0.7,
    spin: Math.PI + 0.25,
    build: (k) => {
      k.cyl(0.75, 0.9, 9.5, 8, C.iron, { at: [0, 3.2, 0] });
      k.cyl(1.0, 1.0, 0.6, 8, C.steel, { at: [0, 7.7, 0] });
      k.cyl(0.5, 0.5, 0.2, 8, C.dark, { at: [0, 8.02, 0] });
      k.box(1.6, 8, 1.5, C.wood, { at: [-0.95, 1.6, 0] }, 0.35);
      k.box(2.2, 2.6, 1.9, C.iron, { at: [-0.3, -2.4, 0] }, 0.35);
      k.rod([[-0.7, -3, 0], [-2.2, -4.8, 0], [-3.4, -7.2, 0]], 1.0, C.wood, {}, 6);
      k.ball(1.2, C.gold, { at: [-3.6, -7.7, 0] });
      k.box(0.6, 1.9, 0.5, C.steel, { at: [1.0, -1.7, 0], rot: [0, 0, -0.55] });
      k.box(0.5, 0.7, 0.45, C.paper, { at: [1.5, -0.8, 0] });
      k.ring(1.0, 0.2, C.gold, { at: [-2.1, -3, 0] }, 4, 12);
      k.cyl(1.0, 1.0, 0.7, 8, k.a, { at: [0, 1.6, 0] });
    },
  },
  blunderbuss: {
    // A short, fat gun with a brass barrel belled out at the muzzle, a heavy stock and an iron butt plate.
    lean: DIAG,
    spin: Math.PI + 0.25,
    build: (k) => {
      const brass = "#c99a3a";
      k.lathe([[1.0, -4], [1.0, 4.5], [1.3, 7], [2.5, 9.6], [2.8, 10]], 10, brass);
      k.cyl(2.3, 2.3, 0.2, 10, C.dark, { at: [0, 9.6, 0] });
      k.cyl(1.15, 1.15, 0.7, 10, k.a, { at: [0, 0.5, 0] });
      k.cyl(1.2, 1.2, 0.6, 10, k.a, { at: [0, 4.4, 0] });
      k.box(1.9, 9.5, 1.8, C.wood, { at: [-1.0, -1.2, 0] }, 0.4);
      k.box(2.2, 2.8, 2.2, C.iron, { at: [-0.2, -4.8, 0] }, 0.35);
      k.box(0.6, 2, 0.5, C.steel, { at: [1.2, -4.1, 0], rot: [0, 0, -0.55] });
      // The stock: a narrow wrist where the hand closes, widening down and back to the shoulder.
      k.hull([[-0.2, -5.6, 0.85], [-0.2, -5.6, -0.85], [-2.0, -5.6, 0.85], [-2.0, -5.6, -0.85], [-1.5, -8, 0.8], [-1.5, -8, -0.8], [-3.0, -8, 0.8], [-3.0, -8, -0.8], [-2.2, -12.6, 1], [-2.2, -12.6, -1], [-5.6, -11.8, 1], [-5.6, -11.8, -1]], C.wood);
      k.box(3.9, 0.7, 2.2, C.iron, { at: [-3.9, -12.4, 0], rot: [0, 0, -0.24] }, 0.2);
      k.ring(1.1, 0.22, C.gold, { at: [-2.2, -6.4, 0] }, 4, 12);
    },
  },
  "harpoon-gun": {
    // A whaler's gun: a stout iron tube with a barbed harpoon standing out of it, a coil of line at its side,
    // a winding handle and a pistol grip.
    lean: DIAG,
    spin: Math.PI + 0.25,
    build: (k) => {
      const rope = "#c9b58a";
      k.cyl(1.15, 1.3, 9, 8, C.iron, { at: [0, 0, 0] });
      k.cyl(1.4, 1.4, 0.8, 8, k.a, { at: [0, 4.1, 0] });
      k.cyl(1.45, 1.45, 0.7, 8, k.a, { at: [0, -2.8, 0] });
      // The harpoon: a steel shaft, a broad head, and two barbs laid back from it.
      k.cyl(0.32, 0.32, 8, 5, C.steel, { at: [0, 8, 0] });
      k.hull(bladePoints(3.4, 2.2, 0.7, 2.4, 11.4), C.steel);
      for (const s of [-1, 1]) k.cone(0.45, 1.8, 4, C.steel, { at: [s * 1.0, 10.9, 0], rot: [0, 0, s * 2.55] });
      // The line: coiled at the side, and run up to the harpoon's shaft.
      for (const z of [-0.35, 0.35]) k.ring(1.9, 0.38, rope, { at: [2.6, -0.4, z] }, 5, 14);
      k.rod([[2.6, 1.5, 0], [1.4, 4.6, 0.5], [0.3, 7.2, 0.2]], 0.16, rope, {}, 4);
      k.box(1.9, 7, 1.8, C.wood, { at: [-1.1, -1.6, 0] }, 0.4);
      k.rod([[-1.0, -4.6, 0], [-2.6, -6.8, 0], [-3.6, -9.6, 0]], 1.05, C.wood, {}, 6);
      k.ball(1.2, C.iron, { at: [-3.8, -10.1, 0] });
      k.ring(1.0, 0.2, C.gold, { at: [-2.4, -4.8, 0] }, 4, 12);
      k.cyl(0.3, 0.3, 1.8, 5, C.steel, { at: [0, -3.9, 1.7], rot: [Math.PI / 2, 0, 0] });
      k.ball(0.5, C.gold, { at: [0, -3.9, 2.7] });
    },
  },
  "heavy-crossbow": {
    // A true crossbow, seen from above: a steel bow across a long tiller, the string drawn back to the nut,
    // a bolt in the groove, a stirrup at the nose and a long trigger under the stock.
    lean: DIAG,
    spin: 0.15,
    tip: 0.2,
    build: (k) => {
      k.box(1.9, 17, 1.6, C.wood, { at: [0, -1.5, 0] }, 0.4);
      k.hull([[-1.4, -8, 0.8], [1.4, -8, 0.8], [-1.4, -8, -0.8], [1.4, -8, -0.8], [-1.9, -11.6, 0.9], [1.9, -11.6, 0.9], [-1.9, -11.6, -0.9], [1.9, -11.6, -0.9]], C.wood);
      k.box(2.1, 1.6, 1.8, k.a, { at: [0, -6.4, 0] }, 0.3);
      // The bow, its tips swept back, lashed to the nose of the tiller.
      k.rod([[-7.4, 3.6, 0.2], [-4.6, 5.4, 0.2], [0, 6.2, 0.2], [4.6, 5.4, 0.2], [7.4, 3.6, 0.2]], 0.6, C.iron, {}, 6);
      for (const x of [-7.4, 7.4]) k.ball(0.7, C.steel, { at: [x, 3.6, 0.2] });
      k.box(2.3, 1.3, 2, C.leather, { at: [0, 6.2, 0.1] }, 0.3);
      // Drawn: the string back from each tip to the nut.
      k.rod([[-7.4, 3.6, 0.5], [0, -0.6, 0.9], [7.4, 3.6, 0.5]], 0.13, C.paper, {}, 4);
      k.cyl(0.55, 0.55, 0.6, 8, C.gold, { at: [0, -0.6, 0.9], rot: [0, 0, Math.PI / 2] });
      // The bolt in its groove, and the stirrup.
      k.cyl(0.22, 0.22, 7.6, 5, C.bark, { at: [0, 3.4, 1.0] });
      k.cone(0.55, 1.5, 4, C.steel, { at: [0, 7.9, 1.0] });
      for (const r of [0, Math.PI / 2]) k.box(1.3, 1.6, 0.1, k.a, { at: [0, 0.4, 1.0], rot: [0, r, 0] });
      k.ring(1.15, 0.22, C.iron, { at: [0, 8.2, 0], rot: [Math.PI / 2, 0, 0] }, 4, 12);
      k.box(0.4, 5, 0.4, C.steel, { at: [0, -4.4, -1.2], rot: [0.2, 0, 0] });
    },
  },
  "void-staff": {
    // The Undertow Staff: a snapped length of drowned mast, black and waterlogged, barnacled and hung with weed,
    // a rusted iron band and a frayed stub of rigging round it, and over the broken top a whirlpool of dark water
    // funnelling down into the wood, turning on its own in the hand.
    lean: DIAG,
    tip: 0.45,
    build: (k) => {
      const wet = "#2c3236";
      const rust = "#7a4b34";
      const weed = "#4a6a3c";
      // Long, and gripped low (see HOLD in figures.ts), so the whirlpool rides up clear of a hat's brim.
      k.rod([[0, -12.6, 0], [0.2, -8, 0.1], [0.25, -5, 0.1], [-0.15, 0, -0.1], [0.2, 4, 0.1], [0, 8, 0]], 0.72, wet, {}, 7);
      k.cyl(0.8, 0.62, 0.8, 6, C.iron, { at: [0, -12.8, 0] });
      whipping(k, [0.1, -6, 0.05], 0.86, 3);
      // The broken top: splinters standing up at odd heights round the snap.
      for (const [a, h, r] of [[0, 1.6, 0.32], [1.3, 0.9, 0.28], [2.5, 1.3, 0.3], [3.8, 0.7, 0.26], [5.0, 1.1, 0.28]] as const) {
        k.cone(r, h, 4, wet, { at: [Math.cos(a) * 0.42, 8 + h / 2, Math.sin(a) * 0.42], rot: [Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15] });
      }
      // A rusted mast band, its rivets standing out, and under it a stub of rigging wound round and frayed.
      k.cyl(0.92, 0.92, 0.9, 7, rust, { at: [0.1, 5.6, 0.05] });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        k.ball(0.17, "#5a3626", { at: [0.1 + Math.cos(a) * 0.95, 5.6, 0.05 + Math.sin(a) * 0.95] });
      }
      whipping(k, [0.15, 4.2, 0.08], 0.86, 1.4);
      k.rod([[0.95, 4.0, 0.3], [1.35, 2.9, 0.45], [1.25, 1.7, 0.4]], 0.2, k.a, {}, 4);
      for (const [dx, dz] of [[-0.25, 0.1], [0.05, 0.25], [0.3, -0.05]] as const) k.rod([[1.25, 1.7, 0.4], [1.25 + dx, 1.0, 0.4 + dz]], 0.07, k.a, {}, 3);
      // Barnacles in clusters, and weed hanging off the band and the wood.
      for (const [y, a, r] of [[2.2, 0.3, 0.34], [2.6, 0.9, 0.26], [-4.6, 2.6, 0.32], [-4.1, 3.1, 0.24], [-6.8, 4.4, 0.3], [6.8, 4.0, 0.26]] as const) {
        k.cone(r, r * 1.1, 5, "#cfc6b0", { at: [Math.cos(a) * 0.72, y, Math.sin(a) * 0.72], rot: [Math.sin(a) * 1.5, 0, -Math.cos(a) * 1.5] });
      }
      for (const [a, len] of [[2.2, 3.4], [4.6, 2.4]] as const) {
        const [x, z] = [Math.cos(a) * 0.95, Math.sin(a) * 0.95];
        k.rod([[x, 5.3, z], [x * 1.15 + 0.2, 4.3, z * 1.15], [x * 1.1 - 0.15, 5.3 - len * 0.6, z * 1.1], [x * 1.2, 5.3 - len, z * 1.2]], 0.15, weed, {}, 4);
      }
      // The whirlpool: a funnel of water over the snap, dark underneath and bright green-blue on its face, foam
      // spiralling round and down into a throat with a glint of the deep in it, froth broken round the rim, and the
      // water drawn on down round the mast. It turns, so the foam goes round and down. Kept narrow (`W`).
      const W = 0.82;
      const ring = (pts: [number, number][]) => pts.map(([r, y]) => [r * W, y] as [number, number]);
      k.spin([0, 10.2, 0], [0, 1, 0], () => {
        k.lathe(ring([[0.25, 8.9], [0.9, 9.4], [1.7, 10.0], [2.5, 10.7], [2.95, 11.2], [2.8, 11.4], [1.9, 10.9], [1.0, 10.2], [0.3, 9.6]]), 12, "#1f4d58");
        // The face of the water, bright, a skin over the funnel's upper side (rising from (0.3, 9.6) to (2.8, 11.4)).
        k.lathe(ring([[0.3, 9.66], [2.86, 11.5], [2.8, 11.58], [0.28, 9.74]]), 14, "#3f9aa5");
        const face = (r: number) => 9.6 + (r - 0.3) * 0.72;
        for (let arm = 0; arm < 4; arm++) {
          const pts: V3[] = [];
          for (let i = 0; i <= 7; i++) {
            const t = i / 7;
            // Wound so that, turning the way the whirlpool does, the foam seems drawn in and down to the throat.
            const a = arm * (Math.PI / 2) - t * 2.8;
            const r = 2.7 - t * 2.3;
            pts.push([Math.cos(a) * r * W, face(r) + 0.2, Math.sin(a) * r * W]);
          }
          k.rod(pts, 0.17 - (arm % 2) * 0.05, "#eaf7f7", {}, 5);
        }
        k.ball(0.3, { glow: "#6ff0e0" }, { at: [0, 9.3, 0] });
        // Water drawn down out of the throat and wound round and round the mast, a thread of foam beside it. It
        // climbs as it goes round the way the whirlpool turns, so as it turns the water seems to run down.
        for (const [r, thick, color, lag] of [[1.0, 0.15, "#3f9aa5", 0], [1.02, 0.07, "#eaf7f7", 0.5]] as const) {
          const pts: V3[] = [];
          for (let i = 0; i <= 30; i++) {
            const t = i / 30;
            const a = lag + t * Math.PI * 2 * 2.5;
            pts.push([Math.cos(a) * r, 3.2 + t * 5.6, Math.sin(a) * r]);
          }
          k.rod(pts, thick, color, {}, 4);
        }
        // Froth round the rim, in clumps.
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + (i % 3) * 0.12;
          const r = 0.22 + ((i * 7) % 5) * 0.04;
          k.ball(r, "#eaf7f7", { at: [Math.cos(a) * 2.85 * W, 11.55, Math.sin(a) * 2.85 * W], scale: [1, 0.7, 1] });
        }
      }, 2.2);
    },
  },

  // ---- signature weapons: each class's own, dropped by lairs and bosses ----
  "ballast-flail": {
    // The Chainshot Flail: a short haft, and on three chains from its cap three small iron cannon balls.
    lean: -0.35,
    spin: 0.4,
    build: (k) => flail(k, false),
    // In hand the chain hangs straight from the ring, and swings.
    inHand: (k) => flail(k, true),
  },
  "barometer-rod": {
    // A staff with a barometer's dial set in it and a tube of glowing glass at its head.
    lean: DIAG,
    build: (k) => {
      k.cyl(0.55, 0.7, 17, 6, C.wood, { at: [0, -1.5, 0] });
      whipping(k, [0, -1, 0], 0.8, 2.6);
      k.cyl(0.78, 0.6, 0.9, 6, C.iron, { at: [0, -9.6, 0] });
      const face: Place["rot"] = [Math.PI / 2, 0, 0];
      k.cyl(2, 2, 0.7, 12, C.gold, { at: [0, 3.6, 0.5], rot: face });
      k.cyl(1.6, 1.6, 0.3, 12, C.paper, { at: [0, 3.6, 0.85], rot: face });
      k.box(0.25, 1.4, 0.12, C.dark, { at: [0.3, 4.1, 1.05], rot: [0, 0, -0.5] });
      k.ball(0.28, C.dark, { at: [0, 3.6, 1.1] });
      for (const y of [7.4, 11.6]) k.cyl(1.2, 1.2, 0.7, 8, C.gold, { at: [0, y, 0] });
      k.cyl(0.8, 0.8, 3.6, 8, { glow: "#8fd3ff" }, { at: [0, 9.5, 0] });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        k.cyl(0.18, 0.18, 4.2, 4, C.gold, { at: [Math.cos(a) * 1.05, 9.5, Math.sin(a) * 1.05] });
      }
      k.cone(1.1, 1.6, 6, C.gold, { at: [0, 12.75, 0] });
      k.ball(0.75, C.gold, { at: [0, 13.9, 0] });
    },
  },
  "gaff-hook": {
    // A pair of gaff hooks, crossed at the collars, their points curling outward.
    spin: 0.3,
    inHand: gaffHook,
    build: (k) => {
      k.within({ at: [0, 0, -0.5], rot: [0, 0, -0.6] }, () => gaffHook(k));
      k.within({ at: [0, 0, 0.5], rot: [0, Math.PI, -0.6] }, () => gaffHook(k));
    },
  },
  "coral-staff": {
    // Bleached driftwood, crowned with branching coral round a pearl, barnacles on the shaft.
    lean: DIAG,
    build: (k) => {
      const drift = "#c2a785";
      k.rod([[0, -10, 0], [0.6, -5, 0.3], [-0.4, 0, 0], [0.5, 4, -0.2], [0, 7, 0]], 0.75, drift, {}, 6);
      k.ball(0.75, drift, { at: [0, -10, 0] });
      for (const [x, y, z, r] of [[0.75, -3.2, 0.3, -1.3], [-0.6, 1.8, 0.45, 1.2], [0.55, 2.6, -0.4, -1.4]] as const) k.cone(0.4, 0.5, 5, C.paper, { at: [x, y, z], rot: [0, 0, r] });
      const coral = "#ff8f7a";
      const tips = "#ffc0ad";
      const branches: V3[][] = [
        [[0, 6.6, 0], [-1.2, 8.5, 0.3], [-2.6, 10.4, 0], [-2.9, 12.1, 0.2]],
        [[0, 6.6, 0], [1.3, 8.8, -0.2], [2.7, 10.2, 0.1], [3.1, 12.3, 0]],
        [[-1.2, 8.5, 0.3], [-0.5, 10.6, 0.8], [-0.8, 12.8, 0.5]],
        [[1.3, 8.8, -0.2], [1.1, 11, -0.7], [1.7, 13, -0.5]],
        [[-2.6, 10.4, 0], [-3.9, 11.2, -0.2], [-4.4, 12.5, -0.1]],
      ];
      for (const b of branches) {
        k.rod(b, 0.58, coral, {}, 5);
        k.ball(0.68, tips, { at: b[b.length - 1] });
      }
      k.ball(1.4, "#efe6d4", { at: [0, 10.3, 0.4] }, 1);
      whipping(k, [-0.3, -1.2, 0.05], 0.98, 3);
    },
  },
  "ships-bell": {
    // A hand bell: a flared brass bell banded at the lip, the clapper showing beneath, a turned wooden handle.
    spin: 0.4,
    tip: 0.2,
    build: (k) => {
      k.lathe([[0, -4.6], [3.4, -4.6], [3.6, -4.1], [3.2, -3.5], [2.6, -1], [2.2, 1.4], [1.6, 2.6], [0, 3]], 10, C.gold);
      k.cyl(3.15, 3.15, 0.1, 10, C.dark, { at: [0, -4.62, 0] });
      k.ring(3.35, 0.36, k.a, { at: [0, -3.9, 0], rot: [Math.PI / 2, 0, 0] }, 4, 16);
      k.ring(2.35, 0.22, "#b8891f", { at: [0, 0.6, 0], rot: [Math.PI / 2, 0, 0] }, 4, 14);
      // The clapper hangs inside, and knocks about a little within the lip.
      k.dangle([0, -2.2, 0], [0, -5.6, 0], () => {
        k.cyl(0.22, 0.22, 3.4, 4, C.iron, { at: [0, -3.9, 0] });
        k.ball(0.9, C.iron, { at: [0, -5.6, 0] });
      }, { limit: 0.35 });
      k.cyl(0.95, 0.95, 0.8, 8, C.gold, { at: [0, 3.3, 0] });
      k.cyl(0.6, 0.75, 4.2, 6, C.wood, { at: [0, 5.8, 0] });
      k.ball(0.95, C.wood, { at: [0, 8.2, 0] });
    },
  },
  astrolabe: {
    // A brass astrolabe on a short handle: the star plate, a rete, the sighting rule across it and its brass pin.
    spin: 0.35,
    tip: 0.2,
    lean: -0.15,
    build: (k) => {
      const face: Place["rot"] = [Math.PI / 2, 0, 0];
      k.cyl(4.2, 4.2, 0.8, 16, C.gold, { at: [0, 3.6, 0], rot: face });
      k.cyl(3.5, 3.5, 0.3, 16, "#2d357a", { at: [0, 3.6, 0.45], rot: face });
      k.ring(4.15, 0.35, "#b8891f", { at: [0, 3.6, 0.45] }, 4, 20);
      for (const [x, y] of [[-2, 1.1], [1.7, 1.4], [-1.1, -1.9], [2.1, -1.3], [0.4, 2.4]] as const) k.ball(0.22, C.shine, { at: [x, 3.6 + y, 0.65] });
      k.ring(2.2, 0.18, C.gold, { at: [0.6, 4, 0.75] }, 4, 14);
      k.box(8.2, 0.5, 0.25, C.steel, { at: [0, 3.6, 0.95], rot: [0, 0, 0.7] });
      k.cyl(0.5, 0.5, 0.5, 6, C.gold, { at: [0, 3.6, 1.15], rot: face });
      k.box(1.6, 1.2, 0.8, C.gold, { at: [0, 8.2, 0] }, 0.2);
      k.ring(0.9, 0.25, C.gold, { at: [0, 9.3, 0], rot: [0, Math.PI / 2, 0] }, 4, 10);
      k.cyl(1, 0.7, 1, 6, C.gold, { at: [0, -1, 0] });
      k.cyl(0.7, 0.8, 5.5, 6, C.wood, { at: [0, -4.2, 0] });
      whipping(k, [0, -4.2, 0], 0.82, 3);
      k.ball(0.85, C.gold, { at: [0, -7.2, 0] });
    },
  },
  "boarding-pike": {
    // A long pole, an iron socket, a pair of lugs and a steel spearhead.
    lean: DIAG,
    spin: 0.4,
    build: (k) => {
      k.cyl(0.6, 0.7, 20, 6, C.wood, { at: [0, -2, 0] });
      for (const y of [-10, 2.4]) k.cyl(0.82, 0.82, 1.3, 6, k.a, { at: [0, y, 0] });
      k.cyl(0.75, 0.75, 1.4, 6, C.iron, { at: [0, 8.4, 0] });
      k.cyl(0.28, 0.28, 3.4, 5, C.iron, { at: [0, 9.2, 0], rot: [0, 0, Math.PI / 2] });
      k.cone(1.25, 5.6, 4, C.steel, { at: [0, 12.2, 0] });
      k.cone(0.45, 4.6, 4, C.shine, { at: [0, 12.4, 0.5] });
    },
  },
  "bilge-chalice": {
    // The Bilge Chalice: a battered ship's tin mug, dented and rust-spotted, a rolled rim and a hooked handle with a
    // lanyard in the rarity colour tied through it, brimming over with glowing bilge that slops down its side,
    // bubbles swirling up off it.
    spin: 0.4,
    tip: 0.3,
    build: (k) => {
      const bilge = { glow: "#6dff9e" };
      const tin = "#9aa1a8";
      const dark = "#6f767d";
      const rust = "#8a5a3a";
      k.lathe([[0, -3.6], [2.55, -3.6], [2.75, -3.3], [2.85, -0.4], [2.78, 0.4], [2.95, 2.6], [3.0, 2.9], [0, 2.9]], 9, tin);
      k.ring(3.0, 0.24, dark, { at: [0, 2.95, 0], rot: [Math.PI / 2, 0, 0] }, 4, 20);
      k.ring(2.68, 0.2, dark, { at: [0, -3.35, 0], rot: [Math.PI / 2, 0, 0] }, 4, 20);
      // A seam up the back, riveted, and rust running down from the rim and spotting the tin.
      k.box(0.3, 6.2, 0.16, dark, { at: [-2.9, -0.3, 0], rot: [0, -Math.PI / 2, 0] });
      for (let i = 0; i < 5; i++) k.ball(0.14, dark, { at: [-2.98, -3 + i * 1.35, 0] });
      for (const [a, len] of [[-0.7, 2.2], [-0.45, 1.3], [2.5, 1.8]] as const) {
        k.rod([[Math.sin(a) * 2.98, 2.7, Math.cos(a) * 2.98], [Math.sin(a) * 2.95, 2.7 - len, Math.cos(a) * 2.95]], 0.12, rust, {}, 4);
      }
      for (const [a, y, r] of [[0.5, -2.4, 0.26], [0.75, -2.1, 0.18], [-1.6, -1.2, 0.22], [3.5, 0.2, 0.24]] as const) {
        k.ball(r, rust, { at: [Math.sin(a) * 2.9, y, Math.cos(a) * 2.9], scale: [1, 1, 0.4], rot: [0, a, 0] });
      }
      // The handle, a hooked loop of tin strap riveted on, and the lanyard tied through it, swinging.
      k.rod([[2.9, 2.1, 0], [4.2, 2.0, 0], [4.7, 0.6, 0], [4.4, -1.0, 0], [2.95, -1.5, 0]], 0.32, tin, {}, 5);
      for (const y of [2.1, -1.5]) k.ball(0.22, dark, { at: [2.98, y, 0] });
      k.ring(0.45, 0.16, k.a, { at: [4.5, -0.6, 0], rot: [Math.PI / 2, 0, 0.3] }, 4, 8);
      k.dangle([4.55, -0.8, 0], [4.3, -3.6, 0.25], () => {
        k.rod([[4.55, -0.8, 0], [4.85, -2.2, 0.3], [4.3, -3.4, 0.25], [3.95, -2.2, 0.05], [4.4, -0.85, 0]], 0.13, k.a, {}, 4);
        k.ball(0.26, k.s, { at: [4.3, -3.5, 0.25] });
      }, { size: 0.4, mass: 0.3 });
      // The bilge, brimming over the rim and slopping down one side, a drop gathering at the end.
      k.cyl(2.85, 2.85, 0.3, 12, bilge, { at: [0, 3.0, 0] });
      k.ball(2.6, bilge, { at: [0, 2.85, 0], scale: [1, 0.22, 1] });
      k.rod([[1.5, 3.2, 2.5], [1.75, 2.6, 2.85], [1.7, 1.7, 2.95]], 0.42, bilge, {}, 6);
      k.ball(0.45, bilge, { at: [1.7, 1.45, 2.95] });
      // Bubbles rising off it, swirling round over the cup.
      k.spin([0, 4, 0], [0, 1, 0], () => {
        for (const [x, y, z, r] of [[0.9, 3.7, 0.5, 0.5], [-1.1, 4.5, -0.3, 0.38], [0.3, 5.4, -0.9, 0.3], [-0.5, 6.2, 0.6, 0.24], [1.4, 4.4, -1.0, 0.28]] as const) {
          k.ball(r, bilge, { at: [x, y, z] });
        }
      }, 1.4);
    },
  },

  // ---- armor ----
  "round-shield": {
    spin: 0.5,
    tip: 0.15,
    build: (k) => {
      const face: Place = { rot: [Math.PI / 2, 0, 0] };
      k.cyl(7, 7, 1.2, 12, C.iron, face);
      k.cyl(5.6, 5.8, 0.6, 12, k.a, { at: [0, 0, 0.8], ...face });
      k.dome(2, 8, C.gold, { at: [0, 0, 1], rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        k.ball(0.38, C.steel, { at: [Math.cos(a) * 6.3, Math.sin(a) * 6.3, 0.7] });
      }
    },
  },
  shield: {
    spin: 0.5,
    tip: 0.15,
    build: (k) => {
      k.plate([[-6, 7], [6, 7], [6, 1], [4.8, -3], [2.4, -6], [0, -8], [-2.4, -6], [-4.8, -3], [-6, 1]], 1, C.iron, {}, 0.5);
      k.box(1.8, 13, 0.6, k.a, { at: [0, -0.4, 0.9] });
      k.box(10.6, 1.8, 0.6, k.a, { at: [0, 3, 0.9] });
      k.ball(1.1, C.gold, { at: [0, 3, 1.3] });
    },
  },
  "chest-armor": {
    // The Hauberk of Calm Seas: a mail shirt in courses of rings down to a skirt, steel pauldrons, a breastplate
    // with a ridge down it, rivets along its top and a roundel of the accent with a calm sea across it, a gold belt.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const rows: Row[] = [[6, 5, 2.4, 2.4], [3, 5.4, 3.4, 2.6], [-3, 4, 2.6, 2.3], [-6.2, 4.6, 2.7, 2.5]];
      k.hull(torsoPoints(rows), C.iron);
      for (const y of [-2.2, -4.9, -5.7]) k.hull(torsoPoints([rowAt(rows, y + 0.15), rowAt(rows, y - 0.15)], 0.12), MAIL);
      k.cyl(2, 2.4, 0.5, 8, C.dark, { at: [0, 6.05, 0] });
      for (const sx of [-1, 1]) k.dome(2.8, 6, C.steel, { at: [sx * 4.8, 5.4, 0], rot: [0, 0, -sx * 0.5] });
      const plate: V3[] = [];
      for (const y of [5.6, 3, -1.6]) {
        const z = frontAt(y, rows);
        for (const sx of [-1, 1]) plate.push([sx * 3.6, y, z * 0.62 + 0.2], [sx * 3.6, y, z * 0.62 - 0.6]);
        plate.push([0, y, z + 0.45], [0, y, z - 0.3]);
      }
      k.hull(plate, C.steel);
      for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) k.ball(0.28, C.shine, { at: [x, 5.3, frontAt(5.3, rows) * (1 - Math.abs(x) * 0.1) + 0.35] });
      const f = frontAt(2.2, rows) + 0.5;
      k.cyl(1.45, 1.45, 0.4, 10, C.gold, { at: [0, 2.2, f], rot: [Math.PI / 2, 0, 0] });
      k.cyl(1.15, 1.15, 0.5, 10, k.a, { at: [0, 2.2, f + 0.1], rot: [Math.PI / 2, 0, 0] });
      k.rod([[-0.85, 2.05, f + 0.4], [-0.3, 2.35, f + 0.4], [0.3, 2.05, f + 0.4], [0.85, 2.35, f + 0.4]], 0.14, C.gold, {}, 4);
      k.box(8.8, 1.3, 5.6, C.gold, { at: [0, -3.8, 0.1] }, 0.25);
      k.box(1.5, 1.5, 0.5, C.steel, { at: [0, -3.8, 3] }, 0.1);
    },
  },
  "oilskin-coat": {
    // The Oilskin Greatcoat: yellow oilskin to the shins, a short cape over the shoulders under a stand-up collar,
    // buttoned over double-breasted with its edge in the accent, a dark belt with a buckle of it, cuffs of it, and
    // the skirts open below the belt.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [oil, deep, lit] = ["#b1933c", "#8a7230", "#c4a64e"];
      const rows: readonly Row[] = [...TORSO.slice(0, 3), [-6.2, 5, 2.8, 2.6], [-11, 5.8, 3.2, 3]];
      k.hull(torsoPoints(rows, 0.15), oil);
      // The front buttoned over: a flap to the wearer's left, its edge in the accent.
      const flap: V3[] = [];
      for (const y of [5.4, 3, -3]) for (const x of [-1.6, 1.8]) flap.push([x, y, frontAt(y, rows) + 0.35], [x, y, frontAt(y, rows) - 0.4]);
      k.hull(flap, lit);
      k.rod([5.4, 3, -3].map((y): V3 => [1.85, y, frontAt(y, rows) + 0.4]), 0.24, k.a, {}, 4);
      for (const y of [3.2, 1.2, -0.8]) for (const x of [-0.7, 1]) k.ball(0.36, C.gold, { at: [x, y, frontAt(y, rows) + 0.55] });
      // Below the belt it hangs open: a dark gap between its skirts.
      k.box(1.2, 7.6, 0.4, tone(oil, -0.28), { at: [0, -7.2, frontAt(-7.2, rows) + 0.1] });
      for (const sx of [-1, 1]) k.box(2.4, 1, 0.4, deep, { at: [sx * 3, -5.6, frontAt(-5.6, rows) + 0.15] }, 0.15);
      k.hull(torsoPoints([[-3.25, 4.5, 2.7, 2.4], [-4.35, 4.5, 2.7, 2.4]], 0.35), C.dark);
      k.box(1.4, 1.4, 0.5, k.a, { at: [0, -3.8, frontAt(-3.8, rows) + 0.6] }, 0.1);
      for (const sx of [-1, 1]) {
        k.cyl(1.7, 2, 4.6, 6, oil, { at: [sx * 5.5, 3.6, 0], rot: [0, 0, sx * 0.5] });
        k.cyl(1.9, 1.9, 0.9, 6, k.a, { at: [sx * 6.6, 1.6, 0], rot: [0, 0, sx * 0.5] });
      }
      // The cape over the shoulders, hemmed darker, and the collar standing up out of it.
      k.cyl(3, 6.6, 2.8, 12, lit, { at: [0, 5.6, 0], scale: [1, 1, 0.6] });
      k.cyl(6.75, 6.75, 0.5, 12, deep, { at: [0, 4.15, 0], scale: [1, 1, 0.61] });
      k.cyl(2.3, 2.6, 1.6, 10, deep, { at: [0, 7.6, 0] });
      k.cyl(1.9, 1.9, 0.4, 10, C.dark, { at: [0, 8.3, 0] });
    },
  },
  "diving-plate": {
    // Diver's Plate: riveted iron over a dark canvas suit, a brass corselet over the shoulders bolted round with a
    // plate of the accent at its front, a chain slung across the chest, and rope wound round the waist and knotted.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [iron, brass, bolt, rope] = ["#5d6064", "#b8893a", "#d9ac55", "#b49a62"];
      const rows: readonly Row[] = [...TORSO.slice(0, 3), [-6.2, 4.9, 2.8, 2.6]];
      k.hull(torsoPoints(rows), iron);
      for (const y of [2.4, 0.4, -1.6]) for (const sx of [-1, 1]) k.ball(0.3, "#8a8e94", { at: [sx * 2.2, y, frontAt(y, rows) * 0.9 + 0.2] });
      for (const sx of [-1, 1]) k.cyl(1.7, 1.9, 4.2, 6, tone(iron, -0.08), { at: [sx * 5.5, 3.9, 0], rot: [0, 0, sx * 0.5] });
      k.cyl(3.3, 5.6, 2.2, 12, brass, { at: [0, 5.7, 0], scale: [1, 1, 0.68] });
      for (let i = 0; i < 10; i++) {
        const a = ((i + 0.5) / 10) * Math.PI * 2;
        k.ball(0.32, bolt, { at: [Math.sin(a) * 5.15, 5, Math.cos(a) * 5.15 * 0.7] });
      }
      k.cyl(2.3, 2.5, 1, 10, tone(brass, -0.15), { at: [0, 7.1, 0] });
      k.box(2.4, 1, 0.4, k.a, { at: [0, 5.5, 3.2], rot: [-0.55, 0, 0] }, 0.1);
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const y = 3.4 - 6.4 * t;
        k.ring(0.6, 0.2, C.dark, { at: [-3.4 + 6.4 * t, y, frontAt(y, rows) + 0.25], rot: [0, i % 2 ? Math.PI / 2 : 0, -0.8] }, 4, 8);
      }
      k.hull(torsoPoints([[-3.1, 4.4, 2.7, 2.4], [-4.5, 4.5, 2.7, 2.4]], 0.3), rope);
      k.ball(0.8, tone(rope, -0.1), { at: [-1.6, -3.8, frontAt(-3.8, rows) + 0.6] });
      k.rod([[-1.6, -4.2, frontAt(-3.8, rows) + 0.6], [-1.9, -6.2, frontAt(-6.2, rows) + 0.5], [-1.7, -7.6, frontAt(-6.2, rows) + 0.5]], 0.32, rope, {}, 4);
    },
  },
  "striped-jersey": {
    // Striped Jersey: a sailor's knitted jersey in bands of blue and white, the sleeves striped to match, and a
    // collar of the accent round the boat neck.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [white, blue] = ["#e8edf2", "#2f5d9a"];
      k.hull(torsoPoints(TORSO), white);
      for (const y of [4.4, 2.4, 0.4, -1.6, -3.6, -5.5]) k.hull(torsoPoints([rowAt(TORSO, y + 0.45), rowAt(TORSO, y - 0.45)], 0.1), blue);
      for (const sx of [-1, 1])
        k.within({ at: [sx * 5.5, 4, 0], rot: [0, 0, sx * 0.5] }, () => {
          k.cyl(1.6, 1.9, 4.6, 6, white, {});
          for (const d of [0.9, -0.9]) k.cyl(1.8, 1.85, 0.8, 6, blue, { at: [0, d, 0] });
          k.cyl(1.75, 1.75, 0.9, 6, blue, { at: [0, -2.3, 0] });
        });
      k.cyl(2.5, 2.9, 0.8, 8, k.a, { at: [0, 6.1, 0] });
      k.cyl(1.9, 2.2, 0.4, 8, C.dark, { at: [0, 6.4, 0] });
    },
  },
  "leather-jerkin": {
    // Leather Jerkin: a sleeveless brown leather jerkin over a pale shirt, open in a V at the chest and laced
    // across it in the accent, stitched round the opening, a dark belt, and the shirt's full sleeves.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [shirt, hide, deep] = ["#e6dcc6", "#7a4e2c", "#4a2f1c"];
      k.hull(torsoPoints(TORSO), shirt);
      const rows: readonly Row[] = [[5.6, 4.4, 2.3, 2.3], ...TORSO.slice(1, 3), [-6.8, 4.9, 2.8, 2.6]];
      k.hull(torsoPoints(rows, 0.18), hide);
      const V: [number, number][] = [[5.6, 1.5], [3.6, 0.8], [1.6, 0.15]];
      const strip: V3[] = [];
      for (const [y, w] of V) {
        const z = frontAt(y, rows) + 0.25;
        strip.push([-w, y, z], [w, y, z], [-w, y, z - 0.6], [w, y, z - 0.6]);
      }
      k.hull(strip, shirt);
      for (const s of [-1, 1]) k.rod(V.map(([y, w]): V3 => [s * (w + 0.15), y, frontAt(y, rows) + 0.3]), 0.14, deep, {}, 4);
      for (const y of [5, 4, 3, 2.1]) for (const t of [-0.45, 0.45]) k.box(2.6 - (5.6 - y) * 0.55, 0.16, 0.16, k.a, { at: [0, y, frontAt(y, rows) + 0.36], rot: [0, 0, t] });
      k.cyl(2, 2.4, 0.5, 8, C.dark, { at: [0, 6.05, 0] });
      for (const s of [-1, 1]) {
        k.cyl(1.8, 2, 1.6, 6, hide, { at: [s * 5, 5.1, 0], rot: [0, 0, s * 0.5] });
        k.within({ at: [s * 5.6, 3.9, 0], rot: [0, 0, s * 0.5] }, () => {
          k.cyl(1.8, 2.1, 4.4, 6, shirt, {});
          k.cyl(1.7, 1.7, 0.8, 6, tone(shirt, -0.08), { at: [0, -2.4, 0] });
        });
      }
      k.hull(torsoPoints([[-3.25, 4.5, 2.7, 2.4], [-4.35, 4.5, 2.7, 2.4]], 0.35), deep);
      k.box(1.4, 1.4, 0.5, C.gold, { at: [0, -3.8, frontAt(-3.8, rows) + 0.6] }, 0.1);
    },
  },
  gambeson: {
    // Quilted Gambeson: a thick padded coat of off-white cloth quilted in diamonds, a stand-up collar, quilted
    // sleeves, and toggles of the accent down the front.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [cloth, stitch] = ["#d9c9a3", "#8f7b52"];
      const rows: readonly Row[] = [[6, 4.8, 2.6, 2.6], [3, 5.3, 3.5, 2.9], [-3, 4.7, 2.9, 2.6], [-7.4, 5.1, 3, 2.8]];
      k.hull(torsoPoints(rows), cloth);
      const on = (x: number, y: number): V3 => [x, y, frontZ(x, y, rows) + 0.12];
      for (const y0 of [-9, -6, -3, 0, 3, 6, 9])
        for (const s of [-1, 1]) {
          let prev: V3 | null = null;
          for (const x of [-3, -1.5, 0, 1.5, 3]) {
            const y = y0 + s * x;
            const p = y >= -6.8 && y <= 5.4 ? on(x, y) : null;
            if (p && prev) bar(k, prev, p, 0.13, stitch);
            prev = p;
          }
        }
      k.hull(torsoPoints([rowAt(rows, -6.9), rowAt(rows, -7.4)], 0.1), tone(cloth, -0.08));
      for (const y of [4.4, 2.2, 0, -2.2]) {
        k.cyl(0.28, 0.28, 1.6, 5, k.a, { at: [0.3, y, frontZ(0, y, rows) + 0.4], rot: [0, 0, Math.PI / 2] });
        k.box(0.9, 0.18, 0.18, stitch, { at: [-0.7, y, frontZ(0.7, y, rows) + 0.25] });
      }
      k.cyl(2.4, 2.6, 1.4, 10, cloth, { at: [0, 6.6, 0] });
      k.cyl(2, 2, 0.3, 10, C.dark, { at: [0, 7.2, 0] });
      for (const s of [-1, 1])
        k.within({ at: [s * 5.7, 3.9, 0], rot: [0, 0, s * 0.5] }, () => {
          k.cyl(1.9, 2.2, 4.8, 6, cloth, {});
          for (const d of [1, -0.6]) k.cyl(2.1, 2.12, 0.25, 6, stitch, { at: [0, d, 0] });
          k.cyl(1.95, 1.95, 0.9, 6, tone(cloth, -0.08), { at: [0, -2.4, 0] });
        });
    },
  },
  "stoker-apron": {
    // Stoker's Apron: a heavy smith's apron of scorched leather from the chest to below the knees, slung from the
    // neck and riveted in brass, a pocket of the accent on it, over a dark shirt with its sleeves rolled up.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [shirt, hide, scorch, brass] = ["#3a3a44", "#6a4428", "#2e2018", "#b8893a"];
      k.hull(torsoPoints(TORSO), shirt);
      k.cyl(2, 2.4, 0.5, 8, C.dark, { at: [0, 6.05, 0] });
      for (const s of [-1, 1])
        k.within({ at: [s * 5.3, 4.3, 0], rot: [0, 0, s * 0.5] }, () => {
          k.cyl(1.6, 1.85, 3.4, 6, shirt, {});
          k.cyl(1.95, 1.95, 0.9, 6, tone(shirt, 0.1), { at: [0, -1.7, 0] });
        });
      k.hull(torsoPoints([[-3, 4.4, 2.6, 2.3], [-3.5, 4.4, 2.6, 2.3]], 0.2), tone(hide, -0.1));
      const apron: V3[] = [];
      for (const [y, hw] of [[5.2, 2.1], [1.2, 2.6], [-3.2, 3.6], [-6.2, 3.8], [-9, 4]] as const)
        for (const x of [-hw, -hw / 2, 0, hw / 2, hw]) {
          const z = frontZ(x, Math.max(y, -6.2));
          apron.push([x, y, z + 0.45], [x, y, z - 0.2]);
        }
      k.hull(apron, hide);
      const face = (x: number, y: number, out: number): V3 => [x, y, frontZ(x, Math.max(y, -6.2)) + out];
      k.rod([face(-1.9, 5.2, 0.2), [-1.6, 6.3, 0.5], [0, 6.6, -1.6], [1.6, 6.3, 0.5], face(1.9, 5.2, 0.2)], 0.25, tone(hide, -0.1), {}, 4);
      for (const [x, y] of [[-1.8, 4.9], [1.8, 4.9], [-2.3, 1.4], [2.3, 1.4], [-3.2, -3], [3.2, -3]]) k.ball(0.3, brass, { at: face(x, y, 0.5) });
      for (const [x, y, s] of [[1.4, -6, 1], [-1.8, -1.2, 0.8], [0.8, 3.2, 0.6]]) k.ball(0.9 * s, scorch, { at: face(x, y, 0.4), scale: [1.2, 0.8, 0.25] });
      k.box(3, 2.2, 0.35, k.a, { at: face(-0.4, -4.4, 0.6) }, 0.1);
      k.box(3, 0.3, 0.4, k.s, { at: face(-0.4, -3.4, 0.65) });
    },
  },
  "barnacle-mail": {
    // Barnacle Mail: a mail shirt gone sea-green with verdigris, its courses of rings showing, crusted with
    // barnacles and little shells, a big scallop shell of the accent on the chest, a rope belt.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [green, course, barnacle, shell, rope] = ["#5f8f7c", "#456e5e", "#cfc6b0", "#e8c9a8", "#b49a62"];
      const rows: readonly Row[] = [[6, 5, 2.4, 2.4], [3, 5.4, 3.4, 2.6], [-3, 4, 2.6, 2.3], [-6.2, 4.6, 2.7, 2.5]];
      k.hull(torsoPoints(rows), green);
      for (const y of [3.8, 0.8, -2, -5.4]) k.hull(torsoPoints([rowAt(rows, y + 0.15), rowAt(rows, y - 0.15)], 0.12), course);
      k.cyl(2, 2.4, 0.5, 8, C.dark, { at: [0, 6.05, 0] });
      for (const s of [-1, 1])
        k.within({ at: [s * 5.3, 4.3, 0], rot: [0, 0, s * 0.5] }, () => {
          k.cyl(1.7, 1.95, 3.2, 6, green, {});
          k.cyl(2, 2, 0.4, 6, course, { at: [0, -1.5, 0] });
        });
      const on = (x: number, y: number, out = 0): V3 => [x, y, frontZ(x, y, rows) + out];
      for (const [x, y, r] of [[-2.6, 4.2, 0.55], [-1.7, 3.3, 0.4], [2.9, -1.2, 0.5], [3.3, -2.2, 0.4], [-3, -4.6, 0.55], [1.2, -5.2, 0.45], [2.2, 4.6, 0.4]]) {
        k.cone(r, r * 1.2, 5, barnacle, { at: on(x, y, r * 0.4), rot: [Math.PI / 2, 0, 0] });
        k.ball(r * 0.4, C.dark, { at: on(x, y, r * 1.05) });
      }
      for (const s of [-1, 1]) for (const [dx, dz, r] of [[0, 0.6, 0.55], [0.7, -0.8, 0.45], [-0.6, -0.3, 0.4]] as const) k.cone(r, r * 1.3, 5, barnacle, { at: [s * (4.4 + dx), 6.5, dz] });
      for (const [x, y] of [[-2.8, 0.6], [2.4, -4]]) k.dome(0.8, 6, shell, { at: on(x, y, 0.05), rot: [Math.PI / 2, 0, 0], scale: [1, 0.5, 1] });
      const f = frontZ(0, 2.2, rows);
      k.dome(1.9, 7, k.a, { at: [0, 2.2, f + 0.05], rot: [Math.PI / 2, 0, 0], scale: [1, 0.5, 1] });
      for (let i = 0; i < 5; i++) {
        const t = -1.1 + (2.2 * i) / 4;
        k.rod([[0, 0.7, f + 0.4], [Math.sin(t) * 0.9, 2.2 + Math.cos(t) * 0.6, f + 0.95], [Math.sin(t) * 1.75, 2.2 + Math.cos(t) * 1.2, f + 0.35]], 0.09, k.s, {}, 3);
      }
      k.box(1.4, 0.7, 0.5, k.s, { at: [0, 0.55, f + 0.3] }, 0.1);
      k.hull(torsoPoints([[-3.3, 4.2, 2.65, 2.35], [-4.3, 4.4, 2.7, 2.4]], 0.3), rope);
    },
  },
  "ghostsail-cloak": {
    // Ghostsail Cloak: a pale grey-white cloak of old sailcloth, hood up over a dark empty face with two pale
    // eyes glowing in it, a short cape over the shoulders, torn and ragged at the hem, clasped with a glowing gem
    // of the accent.
    spin: 0.4,
    tip: 0.2,
    build: (k) => {
      const [cloth, deep, tear] = ["#d9dde2", "#b7bdc5", "#8e959f"];
      k.cyl(4.6, 7, 12.5, 10, cloth, { at: [0, -2.5, 0], scale: [1, 1, 0.72] });
      k.rod([[0, 3.6, 4.6 * 0.72 + 0.05], [0, -8.7, 7 * 0.72 + 0.05]], 0.35, C.dark, {}, 4);
      for (let i = 0; i < 12; i++) {
        const a = ((i + 0.5) / 12) * Math.PI * 2;
        k.cone(1.05, 1.4 + ((i * 7) % 5) * 0.35, 4, i % 3 ? cloth : deep, { at: [Math.sin(a) * 6.5, -9.1 - ((i * 7) % 5) * 0.17, Math.cos(a) * 6.5 * 0.72], rot: [Math.PI, a, 0] });
      }
      // Rents in the cloth, dark slits on its face (its radius grows from 4.6 at the top to 7 at the hem).
      for (const [a, y, len, t] of [[-0.6, -4.5, 1.8, 0.4], [0.5, -6.4, 1.4, -0.3], [0.9, 0.2, 1.2, 0.2]]) {
        const r = 4.6 + (3.75 - y) * 0.192 + 0.05;
        k.box(0.3, len, 0.2, tear, { at: [Math.sin(a) * r, y, Math.cos(a) * r * 0.72], rot: [0, a, t] });
      }
      k.cyl(3.2, 6.2, 3, 10, deep, { at: [0, 4.4, 0], scale: [1, 1, 0.75] });
      k.cyl(3.2, 6.2, 2.6, 10, cloth, { at: [0, 4.6, 0], scale: [1, 1, 0.74] });
      k.within({ at: [0, 7, 0], scale: 0.8 }, () => {
        const cowl = new THREE.LatheGeometry([[0, 8.5], [1.2, 7.8], [3, 5.8], [4.4, 3], [4.9, 0], [4.8, -2.6], [4.4, -4]].reverse().map(([r, y]) => new THREE.Vector2(r, y)), 8);
        const p = cowl.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - Math.max(0, p.getY(i) - 2) * 0.35);
        k.add(cowl, cloth);
        k.cyl(2.8, 2.8, 1, 10, "#141a1a", { at: [0, 0.2, 4.2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.3] });
        k.ring(2.9, 0.5, deep, { at: [0, 0.2, 4.6], scale: [1, 1.3, 1] }, 5, 12);
        for (const x of [-1, 1]) k.ball(0.42, { glow: "#cfe8ff" }, { at: [x, 0.7, 4.8] });
      });
      k.gem(0.65, 1.3, { glow: k.a }, { at: [0, 4, 4.1] });
    },
  },
  "heavy-helm": {
    spin: 0.55,
    tip: 0.2,
    build: (k) => {
      k.lathe([[4.6, -4.4], [4.9, -3], [5.1, 0], [5, 3], [4.2, 5.2], [2.4, 6.6], [0, 7]], 8, C.iron);
      k.cyl(5, 5, 0.9, 8, C.steel, { at: [0, -4.2, 0] });
      k.box(6.4, 0.9, 1.2, C.dark, { at: [0, 0.4, 4.5] });
      k.box(1.3, 6, 1, C.steel, { at: [0, -1, 4.7] }, 0.2);
      k.box(1.2, 2.6, 5.4, k.a, { at: [0, 7.6, -0.6] }, 0.5);
    },
  },
  "brutal-helm": {
    // The Spyglass Visor: a lookout's leather cap with a seam over the top, a riveted brass band, flaps over the
    // ears, goggles, and a spyglass drawn out over one eye with its lens alight.
    spin: -0.75,
    tip: 0.15,
    build: (k) => {
      const [leather, stitch, brass, bright] = ["#7a4a2a", "#5a3520", "#b8893a", "#d9ac55"];
      k.lathe([[4.6, -2.6], [4.85, -0.5], [4.65, 2], [3.75, 4.2], [2.2, 5.6], [0, 6]], 12, leather);
      k.rod([[0, -0.5, 4.95], [0, 2, 4.75], [0, 4.2, 3.85], [0, 5.65, 2.25], [0, 6.1, 0], [0, 5.65, -2.25], [0, 4.2, -3.85]], 0.35, stitch);
      k.cyl(5.05, 5.05, 1.4, 12, brass, { at: [0, -2.3, 0] });
      for (const a of [-1.1, -0.55, 0.55, 1.1]) k.ball(0.32, bright, { at: [Math.sin(a) * 5.1, -2.3, Math.cos(a) * 5.1] });
      for (const sx of [-1, 1]) {
        k.box(1.1, 4.4, 3.2, leather, { at: [sx * 4.55, -5, -0.2], rot: [0, 0, sx * 0.08] }, 0.3);
        k.ball(0.35, bright, { at: [sx * 5.15, -5.4, -0.2] });
      }
      // The goggles under the band, and the strap between them.
      k.box(6, 0.8, 0.8, stitch, { at: [0, -4.3, 4.1] }, 0.2);
      for (const sx of [-1, 1]) k.cyl(1.35, 1.45, 1.1, 12, brass, { at: [sx * 1.9, -4.3, 4.5], rot: [Math.PI / 2, 0, 0] });
      k.ring(1.3, 0.3, bright, { at: [1.9, -4.3, 5.1] }, 6, 14);
      k.cyl(1.05, 1.05, 0.2, 12, C.dark, { at: [1.9, -4.3, 5.1], rot: [Math.PI / 2, 0, 0] });
      // The spyglass over the other eye: a bright drawn length, a leather grip, the barrel, and its lens.
      k.cyl(0.95, 0.95, 1.6, 12, bright, { at: [-1.9, -4.3, 5.8], rot: [Math.PI / 2, 0, 0] });
      k.cyl(1.2, 1.2, 1.5, 12, leather, { at: [-1.9, -4.3, 7.3], rot: [Math.PI / 2, 0, 0] });
      k.cyl(1.55, 1.4, 1.6, 12, brass, { at: [-1.9, -4.3, 8.8], rot: [Math.PI / 2, 0, 0] });
      k.ring(1.5, 0.3, bright, { at: [-1.9, -4.3, 9.6] }, 6, 14);
      k.cyl(1.25, 1.25, 0.2, 12, { glow: k.a }, { at: [-1.9, -4.3, 9.55], rot: [Math.PI / 2, 0, 0] });
    },
  },
  hood: {
    // A peaked hood with a lined opening, two eyes in the shadow, and a mantle over the shoulders.
    spin: 0.35,
    tip: 0.15,
    build: (k) => {
      const cowl = new THREE.LatheGeometry([[0, 8.5], [1.2, 7.8], [3, 5.8], [4.4, 3], [4.9, 0], [4.8, -2.6], [4.4, -4]].reverse().map(([r, y]) => new THREE.Vector2(r, y)), 8);
      const p = cowl.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - Math.max(0, p.getY(i) - 2) * 0.35);
      k.add(cowl, C.leather);
      k.cyl(4.4, 6.4, 3, 8, C.hide, { at: [0, -5.4, 0] });
      k.cyl(2.8, 2.8, 1, 10, C.dark, { at: [0, 0.2, 4.2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.3] });
      k.ring(2.9, 0.55, k.a, { at: [0, 0.2, 4.6], scale: [1, 1.3, 1] }, 5, 12);
      for (const x of [-1, 1]) k.ball(0.4, { glow: C.shine }, { at: [x, 0.7, 4.8] });
      k.ball(0.75, C.gold, { at: [0, -4.1, 4.6] });
    },
  },
  tricorn: {
    // Tricorn: a black three-cornered hat, its cocked brim edged in gold braid, a cockade of the accent on the left.
    spin: 0.4,
    tip: 0.25,
    build: (k) => tricornHat(k, "#3a3644", k.a),
  },
  "sun-hat": {
    // Straw Sun Hat: a wide sloping brim and a round crown of woven straw, rings of the weave showing, a band of
    // the accent round the crown tied in a bow with its ends lying on the brim.
    spin: 0.4,
    tip: 0.3,
    build: (k) => {
      const [straw, weave] = ["#e2c77e", "#c4a75c"];
      k.cyl(3.9, 7.8, 0.9, 16, straw, { at: [0, -0.2, 0] });
      for (const r of [5, 6.6]) k.ring(r, 0.12, weave, { at: [0, 0.3 - ((r - 3.9) / 3.9) * 0.9, 0], rot: [Math.PI / 2, 0, 0] }, 3, 16);
      k.lathe([[3.7, 0], [3.8, 2.4], [3.3, 3.8], [2, 4.5], [0, 4.7]], 12, straw);
      k.ring(3.82, 0.12, weave, { at: [0, 2.4, 0], rot: [Math.PI / 2, 0, 0] }, 3, 12);
      k.cyl(3.85, 3.8, 1.1, 12, k.a, { at: [0, 0.75, 0] });
      k.ball(0.6, k.s, { at: [3.9, 0.75, 0.3] });
      for (const [dz, end] of [[0.9, 1.6], [-0.2, 0.2]] as const) k.rod([[3.9, 0.6, 0.3], [5.1, 0.15, dz], [6.3, -0.35, end]], 0.22, k.a, {}, 4);
    },
  },
  bandana: {
    // Bandana: a red cloth tied close over a round head, spotted with the accent and hemmed darker, knotted at the
    // back on the right with its two ends hanging from the knot.
    spin: 0.4,
    tip: 0.25,
    build: (k) => {
      const red = "#b03a2e";
      k.lathe([[4.5, -1.2], [4.6, 0.8], [4.1, 3], [2.8, 4.6], [1.3, 5.4], [0, 5.6]], 10, red);
      k.cyl(4.62, 4.62, 0.5, 10, tone(red, -0.12), { at: [0, -0.95, 0] });
      for (const [y, r, n, off] of [[1.8, 4.37, 7, 0], [3.8, 3.45, 5, 0.4], [5.1, 1.9, 3, 0.9]]) {
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          k.ball(0.38, k.a, { at: [Math.sin(a) * r, y, Math.cos(a) * r] });
        }
      }
      const [x, z] = [4.2, -1.6];
      k.ball(0.95, tone(red, -0.08), { at: [x, 0, z] }, 1);
      for (const [dx, dz, len] of [[0.4, -0.5, 3.4], [0.2, 0.6, 2.6]] as const) k.rod([[x, -0.3, z], [x + dx * 1.5, -len * 0.5, z + dz * 1.5], [x + dx * 2.2, -len, z + dz * 2.2]], 0.45, dx > 0.3 ? red : tone(red, -0.08), {}, 4);
    },
  },
  "lookout-cap": {
    // Lookout's Cap: a navy peaked cap, its crown wider at the top and piped in gold, a band of the accent, a
    // shiny black peak, and a little brass spyglass for a badge.
    spin: 0.4,
    tip: 0.25,
    build: (k) => {
      const [navy, brass] = ["#2b3a58", "#b8893a"];
      k.cyl(4.75, 4.75, 1.6, 12, k.a, { at: [0, -0.4, 0] });
      k.cyl(5.5, 4.8, 2.2, 12, navy, { at: [0, 1.5, 0] });
      k.cyl(5.5, 5.5, 0.4, 12, tone(navy, 0.06), { at: [0, 2.8, 0] });
      k.ring(5.5, 0.18, C.gold, { at: [0, 2.6, 0], rot: [Math.PI / 2, 0, 0] }, 3, 12);
      k.plate([[-4, 0], [4, 0], [3.2, 1.8], [0, 2.6], [-3.2, 1.8]], 0.3, "#1c1c24", { at: [0, -1.1, 4.4], rot: [Math.PI / 2 + 0.35, 0, 0] }, 0.08);
      k.cyl(0.38, 0.5, 2.8, 8, brass, { at: [0, 1.5, 5.4], rot: [0, 0, Math.PI / 2] });
      for (const x of [-1.2, 0.3]) k.cyl(0.56, 0.56, 0.3, 8, tone(brass, -0.15), { at: [x, 1.5, 5.4], rot: [0, 0, Math.PI / 2] });
      for (const sx of [-1, 1]) k.ball(0.35, C.gold, { at: [sx * 4.8, -0.4, 0.4] });
    },
  },
  "miners-lamp": {
    // Miner's Lamp: a round leather cap with a short brim and a band of the accent, and on its front a brass lamp
    // on a bracket, its lens alight.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const [leather, brass] = ["#6e4a2c", "#b8893a"];
      k.lathe([[4.7, -1.6], [4.9, 0.6], [4.5, 3], [3.2, 4.8], [1.4, 5.7], [0, 5.9]], 12, leather);
      k.cyl(5.6, 5.6, 0.4, 12, tone(leather, -0.08), { at: [0, -1.6, 0] });
      k.rod([[0, 0.6, 4.95], [0, 3, 4.55], [0, 4.8, 3.25], [0, 5.95, 0], [0, 4.8, -3.25]], 0.3, tone(leather, -0.12));
      k.cyl(4.95, 4.95, 0.9, 12, k.a, { at: [0, -0.6, 0] });
      k.box(2, 2.4, 0.6, brass, { at: [0, 0.6, 4.9] }, 0.15);
      k.cyl(1.6, 1.2, 2.2, 10, brass, { at: [0, 1.2, 6.1], rot: [Math.PI / 2, 0, 0] });
      k.cyl(1.35, 1.35, 0.25, 10, { glow: "#ffe7a3" }, { at: [0, 1.2, 7.25], rot: [Math.PI / 2, 0, 0] });
      k.ring(1.5, 0.22, tone(brass, 0.12), { at: [0, 1.2, 7.25] }, 4, 12);
      k.cyl(0.35, 0.35, 0.9, 6, brass, { at: [0, 2.5, 5.9] });
    },
  },
  "storm-crown": {
    // Storm Crown: a band of dark silver round a cap of deep blue, its points jagged bolts of lightning in silver
    // and pale blue, the front one tallest, over a glowing gem of the accent.
    spin: 0.4,
    tip: 0.3,
    build: (k) => {
      const [silver, pale, deep] = ["#7c8494", "#a8d4f0", "#5a6170"];
      const bolt: [number, number][] = [[-0.7, 0], [0.7, 0], [0.3, 1.6], [1, 1.6], [-0.3, 4.2], [0, 2.4], [-0.8, 2.4]];
      k.dome(4.2, 10, "#2a3550", { at: [0, 0.6, 0], scale: [1, 0.55, 1] });
      k.cyl(4.6, 4.4, 2.2, 10, silver, {});
      for (const y of [-1, 1.05]) k.cyl(4.75, 4.75, 0.4, 10, deep, { at: [0, y, 0] });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        k.plate(bolt, 0.45, i % 2 ? silver : pale, { at: [Math.sin(a) * 4.5, 1.1, Math.cos(a) * 4.5], rot: [0, a, 0], scale: i === 0 ? 1.35 : 1 }, 0.08);
        if (i > 0) k.ball(0.3, pale, { at: [Math.sin(a + Math.PI / 7) * 4.75, 0, Math.cos(a + Math.PI / 7) * 4.75] });
      }
      k.gem(0.8, 1.6, { glow: k.a }, { at: [0, 0, 4.75] });
    },
  },
  "lantern-helm": {
    // The Lighthouse Paladin's Lantern Helm: a steel dome with a brass comb over the crown, a twist of brass rope
    // round the brow and a short peak, riveted cheek guards, and a little lantern burning on top between four
    // brass posts, under a red peaked cap.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const steel = "#aeb6c2";
      const dome: [number, number][] = [[4.8, -4.2], [5.1, -2.6], [5.2, 0], [4.7, 2.2], [3.4, 3.6], [1.6, 4.3], [0, 4.5]];
      k.lathe(dome, 10, steel);
      // The comb: a crescent of brass standing up along the crown from brow to nape, its inside lost in the dome.
      const arc = (out: number, from: number) => dome.slice(from).map(([r, y]) => [r + out, y + out * 0.3] as [number, number]);
      const outer = arc(0.75, 1);
      const inner = arc(-0.8, 1);
      k.plate([...outer, ...outer.slice(0, -1).reverse().map(([r, y]) => [-r, y] as [number, number]), ...inner.map(([r, y]) => [-r, y] as [number, number]), ...inner.slice(0, -1).reverse()], 0.55, C.gold, { rot: [0, Math.PI / 2, 0] }, 0.12);
      // The brow band a twist of brass rope, its strands slanting round.
      k.ring(5.25, 0.6, C.gold, { at: [0, -2.2, 0], rot: [Math.PI / 2, 0, 0] }, 6, 28);
      for (let i = 0; i < 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        k.box(0.16, 1.15, 0.12, "#a07a22", { at: [Math.sin(t) * 5.84, -2.2, Math.cos(t) * 5.84], rot: [0, t, 0.7] });
      }
      // A short peak over the brow.
      k.plate([[-3.4, 0], [3.4, 0], [2.6, 1.3], [0, 1.8], [-2.6, 1.3]], 0.3, steel, { at: [0, -2.95, 4.6], rot: [Math.PI / 2 + 0.2, 0, 0] }, 0.08);
      for (const sx of [-1, 1]) {
        k.box(1.2, 3, 3.4, steel, { at: [sx * 4.5, -5.1, 1.2], rot: [0, 0, -sx * 0.1] }, 0.3);
        for (const y of [-4.3, -5.9]) k.ball(0.3, C.gold, { at: [sx * 5.15, y, 1.4] });
        // The same line of rivets carried on up each side of the dome over the band, as far apart and in line.
        for (const [r, y] of [[5.16, -1.1], [5.1, 0.5], [4.72, 2.1], [3.27, 3.7]]) k.ball(0.3, C.gold, { at: [sx * (Math.sqrt(r * r - 1.4 * 1.4) + 0.05), y, 1.4] });
      }
      k.cyl(2, 2.3, 0.8, 8, C.gold, { at: [0, 4.6, 0] });
      k.box(2.6, 2.8, 2.6, { glow: "#ffd27a" }, { at: [0, 6.3, 0] });
      for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [-1.45, 1.45], [1.45, 1.45]]) k.box(0.45, 3.1, 0.45, C.gold, { at: [x, 6.3, z] });
      k.cyl(2.2, 2.2, 0.45, 8, C.gold, { at: [0, 7.95, 0] });
      k.cone(2.2, 1.9, 8, "#c23b30", { at: [0, 9.1, 0] });
      k.ball(0.45, C.gold, { at: [0, 10.2, 0] });
    },
  },
  "knit-cap": {
    // A plain knitted cap, the brim rolled up round the head and a small nub on the crown.
    spin: 0.35,
    tip: 0.3,
    build: (k) => {
      const wool = "#5b3f2a";
      k.lathe([[4.6, -1.6], [4.75, 1], [4.3, 3.4], [3.1, 5.2], [1.5, 6.2], [0.6, 6.5]], 10, wool);
      k.cyl(5.1, 5.1, 2.6, 10, "#6e4e36", { at: [0, -1.2, 0] });
      k.cyl(5.2, 5.2, 0.7, 10, "#7d5b40", { at: [0, 0.2, 0] });
      k.ball(0.85, wool, { at: [0, 6.8, 0] });
    },
  },
  "naval-tunic": {
    // A plain navy tunic: a white open collar, a row of brass buttons and a leather belt.
    spin: 0.45,
    tip: 0.2,
    build: (k) => {
      const navy = "#2f4562";
      const pts: V3[] = [];
      for (const [y, w, front, back] of [[6, 4.6, 2.4, 2.4], [3, 5, 3.2, 2.6], [-3, 4.4, 2.6, 2.3], [-6.2, 4.8, 2.7, 2.5]] as const) {
        pts.push([-w, y, 0], [w, y, 0], [0, y, front], [0, y, -back]);
        for (const sx of [-1, 1]) pts.push([sx * w * 0.72, y, front * 0.85], [sx * w * 0.72, y, -back * 0.9]);
      }
      k.hull(pts, navy);
      k.cyl(2, 2.4, 0.5, 8, C.dark, { at: [0, 6.05, 0] });
      for (const sx of [-1, 1]) {
        k.box(2.8, 0.7, 2.6, "#e8edf2", { at: [sx * 1.9, 5.5, 2.2], rot: [0.5, 0, -sx * 0.6] }, 0.2);
        k.cyl(1.6, 1.9, 4.2, 6, navy, { at: [sx * 5.4, 4.2, 0], rot: [0, 0, sx * 0.5] });
      }
      for (const y of [3.4, 1.4, -0.6]) k.ball(0.45, C.gold, { at: [0, y, 3.15 - (3.4 - y) * 0.1] });
      k.box(8.8, 1.1, 5.6, C.leather, { at: [0, -3.8, 0.1] }, 0.25);
      k.box(1.4, 1.4, 0.5, C.gold, { at: [0, -3.8, 3] }, 0.1);
    },
  },
  "deck-boots": {
    // Plain leather sea boots with no trim: a short shaft and a round toe.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const plain = (x: number, z: number, turn: number) =>
        k.within({ at: [x, 0, z], rot: [0, turn, 0] }, () => {
          k.cyl(1.9, 2.1, 6, 6, "#7a5230", { at: [0, 2, 0] });
          k.box(3.8, 2.8, 7, "#7a5230", { at: [0, -1.5, 1.6] }, 0.9);
          k.box(4, 0.7, 7.6, C.bark, { at: [0, -3.2, 1.8] }, 0.25);
        });
      plain(-2.6, -0.6, -0.45);
      plain(2.6, 0.4, -0.3);
    },
  },
  "armored-pants": {
    // Deckhand Greaves: iron over the legs, domed steel knee cops with a wing on the outside, steel greaves down the
    // shins strapped on in the accent, and a waistband of it.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      k.box(8.6, 2, 4.2, k.a, { at: [0, 6, 0] }, 0.4);
      k.box(1.4, 1.4, 0.5, C.gold, { at: [0, 6, 2.2] }, 0.1);
      k.box(8.2, 3, 4, C.iron, { at: [0, 3.8, 0] }, 0.5);
      for (const sx of [-1, 1]) {
        k.cyl(2, 1.7, 10, 6, C.iron, { at: [sx * 2.3, -2.6, 0], rot: [0, 0, sx * 0.05] });
        k.cyl(2.2, 2.2, 0.9, 6, C.steel, { at: [sx * 2.3, 1, 0] });
        k.dome(1.7, 8, C.steel, { at: [sx * 2.4, -1.4, 1.2], rot: [Math.PI / 2, 0, 0], scale: [1, 0.7, 1] });
        k.plate([[0, 1.3], [1.4, 0], [0, -1.3], [-0.4, 0]], 0.3, C.steel, { at: [sx * 4.1, -1.4, 0.4], rot: [0, sx * Math.PI / 2, 0] }, 0.08);
        k.box(2.8, 3.8, 0.7, C.steel, { at: [sx * 2.4, -5.2, 1.6], rot: [0.05, 0, 0] }, 0.3);
        k.cyl(2.05, 2.05, 0.6, 6, k.a, { at: [sx * 2.4, -4.4, 0] });
        k.cyl(1.95, 1.95, 1.2, 6, C.hide, { at: [sx * 2.6, -7.6, 0] });
      }
    },
  },
  "sailcloth-trousers": {
    // Sailcloth Trousers: loose pale canvas tied at the waist with a rope, sewn in panels with a seam down each leg
    // and a patch on one knee, each leg gathered at the shin by a cord of the accent and bloused out below it.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [cloth, seam, rope] = ["#d8cfb4", "#b3aa8f", "#b49a62"];
      k.box(8.8, 4.4, 4.4, cloth, { at: [0, 4.6, 0] }, 0.6);
      k.cyl(4.6, 4.6, 0.7, 10, rope, { at: [0, 6.5, 0], scale: [1, 1, 0.52] });
      k.ball(0.6, tone(rope, -0.1), { at: [0.8, 6.4, 2.45] });
      for (const dx of [0.5, 1.2]) k.rod([[0.8, 6.2, 2.5], [dx + 0.2, 4.6, 2.55], [dx, 3.4, 2.4]], 0.22, rope, {}, 4);
      for (const sx of [-1, 1]) {
        k.cyl(2.35, 2.55, 8.4, 6, cloth, { at: [sx * 2.45, -1.6, 0], rot: [0, 0, sx * 0.06] });
        k.cyl(1.9, 1.9, 0.8, 6, k.a, { at: [sx * 2.75, -6, 0] });
        k.cyl(2.3, 1.95, 1.6, 6, cloth, { at: [sx * 2.75, -7.2, 0] });
        k.box(0.3, 8, 0.4, seam, { at: [sx * 4.9, -1.4, 0], rot: [0, 0, sx * 0.06] });
      }
      k.box(2, 2, 0.4, seam, { at: [2.6, -2, 2.4] }, 0.1);
    },
  },
  "riveted-leggings": {
    // Riveted Leggings: dark canvas, riveted iron plates down the thighs, round iron knee plates on a brass lip
    // with rivets round them and a boss of the accent, and a brass band round each shin.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [canvas, iron, brass, rivet] = ["#4d4a3e", "#5d6064", "#b8893a", "#8a8e94"];
      k.box(8.6, 2, 4.2, tone(canvas, -0.06), { at: [0, 6, 0] }, 0.4);
      k.box(8.2, 3, 4, canvas, { at: [0, 3.8, 0] }, 0.5);
      for (const sx of [-1, 1]) {
        k.cyl(2, 1.75, 10, 6, canvas, { at: [sx * 2.3, -2.6, 0], rot: [0, 0, sx * 0.05] });
        k.box(2.8, 4, 0.6, iron, { at: [sx * 2.3, 1.8, 2.1] }, 0.15);
        for (const [x, y] of [[-0.95, 3.4], [0.95, 3.4], [-0.95, 0.2], [0.95, 0.2]]) k.ball(0.25, rivet, { at: [sx * 2.3 + x, y, 2.45] });
        k.dome(1.95, 8, brass, { at: [sx * 2.4, -2.2, 1.2], rot: [Math.PI / 2, 0, 0], scale: [1, 0.55, 1] });
        k.dome(1.65, 8, iron, { at: [sx * 2.4, -2.2, 1.3], rot: [Math.PI / 2, 0, 0], scale: [1, 0.75, 1] });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          k.ball(0.2, rivet, { at: [sx * 2.4 + Math.cos(a) * 1.15, -2.2 + Math.sin(a) * 1.15, 2.4] });
        }
        k.ball(0.45, k.a, { at: [sx * 2.4, -2.2, 2.6] });
        k.cyl(1.95, 1.95, 0.8, 6, brass, { at: [sx * 2.5, -5.4, 0] });
        k.cyl(1.85, 1.85, 0.8, 6, tone(canvas, -0.08), { at: [sx * 2.55, -7.2, 0] });
      }
    },
  },
  "striped-breeches": {
    // Striped Breeches: cream breeches striped down in red to a band at the knee, pale stockings below, and a
    // garter of the accent tied round each leg under the knee.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [cream, red, hose] = ["#e6dcc2", "#9e3b34", "#f1ede4"];
      k.box(8.6, 2, 4.2, tone(cream, -0.06), { at: [0, 6, 0] }, 0.4);
      k.box(8.2, 3, 4, cream, { at: [0, 3.8, 0] }, 0.5);
      for (const x of [-2.8, -1.4, 1.4, 2.8]) k.box(0.5, 2.8, 0.3, red, { at: [x, 3.8, 2.02] });
      for (const sx of [-1, 1]) {
        k.cyl(2.2, 2, 5.8, 8, cream, { at: [sx * 2.35, -0.3, 0] });
        for (let i = 0; i < 8; i += 2) {
          const a = ((i + 0.5) / 8) * Math.PI * 2;
          k.box(0.55, 5.6, 0.2, red, { at: [sx * 2.35 + Math.sin(a) * 1.97, -0.3, Math.cos(a) * 1.97], rot: [0, a, 0] });
        }
        k.cyl(2.05, 2.05, 0.7, 8, tone(cream, -0.1), { at: [sx * 2.35, -3.1, 0] });
        k.cyl(1.75, 1.45, 4.6, 6, hose, { at: [sx * 2.4, -5.6, 0] });
        k.cyl(1.85, 1.85, 0.6, 6, k.a, { at: [sx * 2.4, -3.9, 0] });
        k.ball(0.5, k.s, { at: [sx * 4.2, -3.9, 0.4], scale: [0.6, 1, 1.4] });
      }
    },
  },
  "leather-chaps": {
    // Leather Chaps: brown leather chaps over dark trousers, a belt with a brass buckle and conchos of the accent,
    // a buckled strap round each thigh, and fringe down the outside of each leg.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [trews, hide, light] = ["#34312e", "#7a4a2a", "#9a6238"];
      k.box(8.2, 3, 4, trews, { at: [0, 3.8, 0] }, 0.5);
      k.box(9, 1.6, 4.6, hide, { at: [0, 5.8, 0] }, 0.4);
      k.box(1.3, 1.1, 0.4, C.gold, { at: [0, 5.8, 2.35] }, 0.1);
      for (const x of [-3, 3]) k.cyl(0.6, 0.6, 0.3, 8, k.a, { at: [x, 5.8, 2.35], rot: [Math.PI / 2, 0, 0] });
      for (const sx of [-1, 1]) {
        k.cyl(2, 1.75, 10, 6, trews, { at: [sx * 2.3, -2.6, 0], rot: [0, 0, sx * 0.05] });
        k.cyl(1.85, 1.85, 0.8, 6, tone(trews, -0.08), { at: [sx * 2.55, -7.2, 0] });
        k.cyl(2.3, 2.05, 8.6, 6, hide, { at: [sx * 2.35, -1.9, 0], rot: [0, 0, sx * 0.05] });
        k.cyl(2.4, 2.4, 0.5, 6, tone(hide, -0.12), { at: [sx * 2.35, 0.6, 0] });
        k.box(0.7, 0.7, 0.3, C.gold, { at: [sx * 2.35, 0.6, 2.45] }, 0.08);
        for (let y = 1.6; y > -5.8; y -= 0.75) k.box(1, 0.22, 0.3, light, { at: [sx * (4.65 + (1.6 - y) * 0.03), y, 0], rot: [0, 0, -sx * 0.35] });
      }
    },
  },
  kilt: {
    // Kilt: a green tartan kilt checked in navy with a fine check of the accent, belted in dark leather, a
    // fur-topped sporran with tassels at the front, bare knees and turned-down hose with flashes of the accent.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [green, navy, belt, skin, hose] = ["#2f5a3e", "#1f3350", "#3d2a1c", "#d9a47e", "#e3dccb"];
      const r = (y: number) => 4.5 + ((5.8 - y) / 7) * 1.1;
      const D = 0.52;
      k.cyl(r(5.8), r(-1.2), 7, 12, green, { at: [0, 2.3, 0], scale: [1, 1, D] });
      for (const [y, c, h] of [[4.2, navy, 0.6], [1.2, navy, 0.6], [2.7, k.a, 0.2], [-0.3, k.a, 0.2]] as const) k.cyl(r(y + h / 2) + 0.04, r(y - h / 2) + 0.04, h, 12, c, { at: [0, y, 0], scale: [1, 1, D] });
      for (let i = 0; i < 12; i++) {
        if (i % 4 === 3) continue;
        const a = (i / 12) * Math.PI * 2;
        const on = (y: number): V3 => [Math.sin(a) * (r(y) + 0.05), y, Math.cos(a) * (r(y) + 0.05) * D];
        bar(k, on(5.7), on(-1.1), i % 2 ? 0.08 : 0.16, i % 2 ? k.a : navy);
      }
      k.cyl(4.6, 4.6, 1.1, 12, belt, { at: [0, 6.2, 0], scale: [1, 1, 0.54] });
      k.box(1.3, 1, 0.4, C.gold, { at: [0, 6.2, 2.55] }, 0.1);
      k.box(2.6, 3, 1, C.hide, { at: [0, 3, 3.1] }, 0.4);
      k.box(2.8, 1.2, 1.2, "#cdbfa6", { at: [0, 4.3, 3.15] }, 0.3);
      k.ball(0.3, C.gold, { at: [0, 3.7, 3.75] });
      for (const x of [-0.8, 0, 0.8]) {
        k.cyl(0.18, 0.25, 1.2, 4, C.dark, { at: [x, 1, 3.4] });
        k.ball(0.25, C.gold, { at: [x, 0.35, 3.4] });
      }
      for (const sx of [-1, 1]) {
        k.cyl(1.7, 1.65, 2.2, 6, skin, { at: [sx * 2.3, -2.1, 0] });
        k.cyl(1.85, 1.5, 4.6, 6, hose, { at: [sx * 2.35, -5.4, 0] });
        k.cyl(1.95, 1.9, 0.9, 6, tone(hose, -0.06), { at: [sx * 2.35, -3.3, 0] });
        k.box(0.5, 1.2, 0.3, k.a, { at: [sx * 3.95, -3.9, 0.3] });
      }
    },
  },
  "sea-legs": {
    // Sea-Legs Slops: wide navy bell-bottoms flaring to hems dark with tar, a buttoned flap at the front, and a
    // drawstring of the accent round the waist tied in front.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [navy, tar] = ["#26365a", "#1a1a20"];
      k.box(8.6, 2, 4.2, tone(navy, -0.06), { at: [0, 6, 0] }, 0.4);
      k.box(8.2, 3, 4, navy, { at: [0, 3.8, 0] }, 0.5);
      k.box(5, 3, 0.35, tone(navy, 0.05), { at: [0, 3.7, 2.05] }, 0.1);
      for (const [x, y] of [[-2.1, 4.8], [2.1, 4.8], [-2.1, 2.6], [2.1, 2.6]]) k.ball(0.3, C.gold, { at: [x, y, 2.3] });
      for (const sx of [-1, 1]) {
        k.cyl(2, 2.6, 10.4, 8, navy, { at: [sx * 2.4, -2.8, 0], rot: [0, 0, sx * 0.14] });
        k.cyl(2.65, 2.7, 1, 8, tar, { at: [sx * 3.08, -7.6, 0], rot: [0, 0, sx * 0.14] });
      }
      k.cyl(4.5, 4.5, 0.35, 10, k.a, { at: [0, 6.6, 0], scale: [1, 1, 0.52] });
      k.ball(0.5, k.a, { at: [0, 6.4, 2.4] });
      for (const [dx, end] of [[-0.4, 4.4], [0.5, 4.6]] as const) {
        k.rod([[0, 6.3, 2.45], [dx, 5.3, 2.55], [dx * 1.3, end, 2.5]], 0.2, k.a, {}, 4);
        k.ball(0.25, k.s, { at: [dx * 1.3, end - 0.1, 2.5] });
      }
    },
  },
  "pathfinder-breeches": {
    // Pathfinder's Breeches: hard-wearing green-brown breeches belted in leather with a buckle of the accent,
    // flapped pockets on the thighs, leaf-shaped patches on the knees, and the shins wrapped in slanting bands, the
    // top one in the accent.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [cloth, deep, leaf, wrap] = ["#5f5a3c", "#4a462e", "#4f7a3a", "#a08f68"];
      const leafShape: [number, number][] = [[0, -1.5], [0.8, -0.6], [0.9, 0.4], [0.4, 1.2], [0, 1.6], [-0.4, 1.2], [-0.9, 0.4], [-0.8, -0.6]];
      k.box(8.6, 2, 4.2, deep, { at: [0, 6, 0] }, 0.4);
      k.box(8.9, 1, 4.5, C.leather, { at: [0, 6, 0] }, 0.3);
      k.box(1.3, 1.1, 0.4, k.a, { at: [0, 6, 2.3] }, 0.1);
      k.box(8.2, 3, 4, cloth, { at: [0, 3.8, 0] }, 0.5);
      for (const sx of [-1, 1]) {
        k.cyl(2.05, 1.85, 7, 6, cloth, { at: [sx * 2.3, -1.1, 0], rot: [0, 0, sx * 0.05] });
        k.box(0.7, 2.6, 2.4, tone(cloth, -0.05), { at: [sx * 4.3, 0.4, 0.2] }, 0.15);
        k.box(0.8, 0.8, 2.5, deep, { at: [sx * 4.35, 1.6, 0.2] }, 0.1);
        k.ball(0.22, C.gold, { at: [sx * 4.75, 1.4, 0.2] });
        k.plate(leafShape, 0.25, leaf, { at: [sx * 2.4, -2.6, 1.95], rot: [0, 0, sx * 0.4] }, 0.06);
        k.box(0.12, 2.6, 0.1, tone(leaf, -0.15), { at: [sx * 2.4, -2.6, 2.15], rot: [0, 0, sx * 0.4] });
        for (let i = 0; i < 6; i++) k.cyl(1.95 - i * 0.04, 1.95 - i * 0.04, 0.6, 6, i === 0 ? k.a : i % 2 ? tone(wrap, -0.08) : wrap, { at: [sx * 2.5, -4.4 - i * 0.65, 0], rot: [(i % 2 ? 1 : -1) * 0.18, 0, 0] });
      }
    },
  },
  "windrunner-leggings": {
    // Windrunner Leggings: sleek pale leggings with a silver seam down each side, glowing chevrons of the accent
    // on the shins, and ribbons of it streaming back from the hips and knees.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      const [pale, seam] = ["#e4e8ee", "#b9c2ce"];
      k.box(8.4, 1.6, 4, tone(pale, -0.06), { at: [0, 6.1, 0] }, 0.4);
      k.box(8, 3, 3.8, pale, { at: [0, 3.8, 0] }, 0.5);
      for (const sx of [-1, 1]) {
        k.cyl(1.9, 1.4, 10.6, 8, pale, { at: [sx * 2.2, -2.9, 0], rot: [0, 0, sx * 0.04] });
        bar(k, [sx * 4.12, 2.2, 0], [sx * 3.84, -7.8, 0], 0.12, seam);
        k.cyl(1.5, 1.5, 0.6, 8, seam, { at: [sx * 2.4, -7.9, 0] });
        k.cyl(1.68, 1.68, 0.4, 8, k.a, { at: [sx * 2.33, -3.8, 0] });
        const x0 = sx * 2.35;
        for (const y of [-5, -6.1]) {
          bar(k, [x0 - 0.7, y - 0.7, 1.38], [x0, y, 1.62], 0.1, { glow: k.a });
          bar(k, [x0, y, 1.62], [x0 + 0.7, y - 0.7, 1.38], 0.1, { glow: k.a });
        }
        k.rod([[sx * 3.9, -3.8, -0.3], [sx * 5, -3, -1.6], [sx * 5.6, -3.8, -3], [sx * 6.6, -3.1, -4.2]], 0.28, k.a, {}, 4);
        k.rod([[sx * 3.8, 6.1, -1.2], [sx * 5, 6.8, -2.4], [sx * 5.6, 5.9, -3.6], [sx * 6.8, 6.6, -4.6]], 0.28, k.a, {}, 4);
      }
    },
  },
  boots: {
    spin: 0,
    tip: 0.3,
    build: (k) => {
      k.within({ at: [-2.6, 0, -0.6], rot: [0, -0.45, 0] }, () => boot(k));
      k.within({ at: [2.6, 0, 0.4], rot: [0, -0.3, 0] }, () => boot(k));
    },
  },
  treads: {
    // Gangplank Treads: short leather boots laced up the front, a band of the accent round the ankle, and thick
    // iron-shod soles studded underneath for grip on a wet plank.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const one = () => {
        const brown = "#5a4632";
        k.cyl(1.95, 2.1, 3.4, 6, brown, { at: [0, 0.6, 0] });
        k.cyl(2.25, 2.2, 0.9, 6, k.a, { at: [0, 2.4, 0] });
        k.box(3.8, 2.8, 7, brown, { at: [0, -1.5, 1.6] }, 0.9);
        for (const y of [1.4, 0.2, -1]) k.box(1.6, 0.3, 0.3, C.hide, { at: [0, y, 2.05 + (1.4 - y) * 0.35] });
        k.box(4.2, 0.9, 7.8, C.iron, { at: [0, -3.25, 1.8] }, 0.25);
        for (const z of [-1.4, 0.8, 3, 5]) for (const x of [-1.45, 1.45]) k.ball(0.32, C.steel, { at: [x, -3.75, z] });
      };
      k.within({ at: [-2.6, 0, -0.6], rot: [0, -0.45, 0] }, one);
      k.within({ at: [2.6, 0, 0.4], rot: [0, -0.3, 0] }, one);
    },
  },
  "lead-boots": {
    // Lead Boots: a diver's heavy boots, dark and tall, a brass cap over the toe and a brass band round the top,
    // a strap of the accent round the shaft, and a thick dark sole.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const one = () => {
        const [lead, brass] = ["#3d3f44", "#b8893a"];
        k.cyl(2.1, 2.3, 7, 6, lead, { at: [0, 2.5, 0] });
        k.cyl(2.5, 2.45, 1.4, 6, brass, { at: [0, 6.4, 0] });
        k.cyl(2.35, 2.35, 0.7, 6, k.a, { at: [0, 2.4, 0] });
        k.box(4.1, 3, 7.2, lead, { at: [0, -1.5, 1.6] }, 0.9);
        k.box(4.3, 2.4, 2.6, brass, { at: [0, -1.7, 4.2] }, 0.6);
        k.box(4.4, 1, 7.9, C.dark, { at: [0, -3.3, 1.8] }, 0.25);
      };
      k.within({ at: [-2.6, 0, -0.6], rot: [0, -0.45, 0] }, one);
      k.within({ at: [2.6, 0, 0.4], rot: [0, -0.3, 0] }, one);
    },
  },
  "cork-clogs": {
    // Cork Clogs: chunky low clogs carved from pale wood, the toe rounded and turned up, a thick cork sole, and a
    // band of the accent across the instep.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [wood, cork] = ["#e0c79a", "#a8784c"];
      bootPair(k, () => {
        const body: V3[] = [[0, 0.3, 6.3]];
        for (const sx of [-1, 1]) body.push([sx * 1.9, -2.6, -2.1], [sx * 2, -2.6, 4.6], [sx * 1.8, 0.4, -2.1], [sx * 1.9, 0.2, 1.4], [sx * 1.4, -0.7, 5.4], [sx * 1.2, -2.3, 5.9]);
        k.hull(body, wood);
        k.cyl(1.35, 1.35, 0.25, 8, C.dark, { at: [0, 0.35, -0.5], scale: [1, 1, 1.35] });
        k.box(4.3, 1.1, 8.4, cork, { at: [0, -3.15, 1.8] }, 0.3);
        for (const [x, z] of [[2.15, 0.2], [2.15, 3.6], [-2.15, 1.8]]) k.ball(0.22, tone(cork, -0.15), { at: [x, -3.1, z] });
        k.box(4.2, 0.55, 1.2, k.a, { at: [0, -0.02, 2.6], rot: [0.22, 0, 0] }, 0.12);
      });
    },
  },
  "rope-sandals": {
    // Rope Sandals: open soles of coiled rope, cords crossing over the foot and wound twice round the ankle, a loop
    // behind the heel, and a toe strap of the accent.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [rope, deep] = ["#c9ad74", "#a68b55"];
      bootPair(k, () => {
        k.cyl(2, 2, 0.9, 10, rope, { at: [0, -3.2, 1.6], scale: [1, 1, 2] });
        k.ring(1.3, 0.2, deep, { at: [0, -2.72, 1.6], rot: [Math.PI / 2, 0, 0], scale: [1, 2, 1] }, 4, 10);
        for (const sx of [-1, 1]) k.rod([[sx * 1.9, -2.8, 0.2], [sx * 0.6, -1.2, 1.6], [-sx * 0.9, -1, 2.6], [-sx * 1.9, -2.8, 3.4]], 0.3, rope, {}, 4);
        k.rod([[-1.7, -2.8, 4.3], [0, -1.9, 4.7], [1.7, -2.8, 4.3]], 0.32, k.a, {}, 4);
        k.rod([[-1.8, -2.8, -1.2], [-1.1, -1.5, -2.3], [1.1, -1.5, -2.3], [1.8, -2.8, -1.2]], 0.3, rope, {}, 4);
        for (const y of [0.4, 2.2]) k.ring(1.5, 0.28, rope, { at: [0, y, -0.7], rot: [Math.PI / 2, 0, 0] }, 4, 8);
        k.rod([[0, -1.3, -2.45], [0, 0.4, -2.2]], 0.26, rope, {}, 4);
        k.rod([[0, -1.1, 2.1], [0, 0.4, 0.8]], 0.26, rope, {}, 4);
        for (const sx of [-1, 1]) k.rod([[sx * 1.5, 0.4, -0.7], [0, 1.3, 0.85], [-sx * 1.5, 2.2, -0.7]], 0.24, deep, {}, 3);
      });
    },
  },
  "buckled-shoes": {
    // Buckled Shoes: low black leather shoes with a block heel, a tongue standing up the front with a big square
    // brass buckle on it, and a little bow of the accent above the buckle.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [black, sole] = ["#24222a", "#141218"];
      bootPair(k, () => {
        k.box(3.8, 2.6, 7, black, { at: [0, -1.6, 1.6] }, 0.9);
        k.cyl(1.3, 1.3, 0.2, 8, C.dark, { at: [0, -0.25, -0.2], scale: [1, 1, 1.4] });
        k.box(4, 0.6, 7.6, sole, { at: [0, -3.2, 1.8] }, 0.2);
        k.box(2.8, 1.4, 2, sole, { at: [0, -3.9, -1.2] }, 0.2);
        k.box(2.6, 2.4, 0.5, black, { at: [0, 0.2, 2.3], rot: [-0.35, 0, 0] }, 0.15);
        k.ring(1.1, 0.24, C.gold, { at: [0, 0.1, 2.6], rot: [-0.35, 0, Math.PI / 4] }, 4, 4);
        k.box(0.5, 0.5, 0.3, k.s, { at: [0, 1.3, 2.0], rot: [-0.35, 0, 0] }, 0.1);
        for (const sx of [-1, 1]) k.ball(0.45, k.a, { at: [sx * 0.55, 1.3, 2.0], scale: [1.2, 0.7, 0.5] });
      });
    },
  },
  "ice-cleats": {
    // Ice Cleats: stout hide boots with a thick ruff of white fur round the top, a strap of the accent buckled
    // round the shaft, and iron soles with spikes underneath.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [fur, sole] = ["#e8e0d0", "#4a4d55"];
      bootPair(k, () => {
        k.cyl(2.15, 2.3, 5.4, 6, C.hide, { at: [0, 1.7, 0] });
        k.cyl(2.85, 2.6, 1.8, 8, fur, { at: [0, 4.9, 0] });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          k.ball(0.75, fur, { at: [Math.sin(a) * 2.6, 5.8, Math.cos(a) * 2.6] });
        }
        k.box(4.2, 3, 7.2, C.hide, { at: [0, -1.5, 1.6] }, 1);
        k.box(4.4, 0.9, 7.8, sole, { at: [0, -3.3, 1.8] }, 0.2);
        for (const z of [-1.4, 1, 3.4, 5.2]) for (const x of [-1.4, 1.4]) k.cone(0.38, 1, 4, C.steel, { at: [x, -4.25, z], rot: [Math.PI, 0, 0] });
        k.cyl(2.45, 2.45, 0.7, 6, k.a, { at: [0, 1.4, 0] });
        k.box(0.9, 0.9, 0.4, C.iron, { at: [0, 1.4, 2.5] }, 0.1);
      });
    },
  },
  "springheel-boots": {
    // Springheel Boots: tall brown leather boots laced up the front in the accent, a turned-down cuff, a sole under
    // the ball of the foot and a coiled brass spring under each heel on a brass foot plate.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [brown, brass] = ["#6a4026", "#c99a45"];
      bootPair(k, () => {
        k.cyl(1.85, 2.05, 8.4, 6, brown, { at: [0, 3.2, 0] });
        k.cyl(2.35, 2.2, 1.3, 6, tone(brown, 0.08), { at: [0, 7.5, 0] });
        k.box(3.7, 2.7, 7, brown, { at: [0, -1.4, 1.7] }, 0.9);
        k.box(3.9, 0.8, 4.2, C.bark, { at: [0, -3.1, 3.2] }, 0.25);
        k.box(3.2, 0.7, 2.6, C.bark, { at: [0, -3, -0.9] }, 0.2);
        const coil: V3[] = Array.from({ length: 13 }, (_, i) => [Math.sin(i * 1.5) * 1.15, -3.4 - i * 0.24, -0.9 + Math.cos(i * 1.5) * 1.15]);
        k.rod(coil, 0.26, brass, {}, 4);
        k.box(3, 0.4, 2.6, brass, { at: [0, -6.5, -0.9] }, 0.1);
        for (const y of [0.6, 2, 3.4, 4.8, 6.2]) {
          const z = 2.05 - ((y + 1) / 8.4) * 0.2 + 0.08;
          for (const t of [-0.5, 0.5]) k.box(1.5, 0.2, 0.2, k.a, { at: [0, y, z], rot: [0, 0, t] });
        }
      });
    },
  },
  "courier-shoes": {
    // Courier's Shoes: light running shoes of pale leather on a thin bone-white sole, laced across, with a little
    // wing of the accent sweeping back from each side of the ankle.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const pale = "#e6d3ae";
      const wing: [number, number][] = [[0, 0], [1, 1.8], [2.6, 3], [3.4, 2.6], [2.8, 1.6], [3.6, 1.2], [2.6, 0.4], [3, -0.2], [1.4, -0.4]];
      bootPair(k, () => {
        k.box(3.6, 2.4, 7, pale, { at: [0, -1.7, 1.6] }, 1);
        k.cyl(1.85, 1.95, 1.8, 6, pale, { at: [0, 0.1, -0.4] });
        k.cyl(1.5, 1.5, 0.2, 6, C.dark, { at: [0, 1, -0.4] });
        k.box(3.8, 0.7, 7.5, C.bone, { at: [0, -3.1, 1.8] }, 0.3);
        for (const z of [1.6, 2.6, 3.6]) k.box(1.6, 0.22, 0.3, "#f4efe4", { at: [0, -0.42, z] });
        for (const sx of [-1, 1]) k.plate(wing, 0.25, k.a, { at: [sx * 1.95, 0.4, -0.6], rot: [0, Math.PI / 2, 0], scale: 0.9 }, 0.06);
      });
    },
  },
  "soft-sneaks": {
    // Soft-Sole Sneaks: soft dark felt slippers with a round toe and a thin sole, bound up the ankle with slanting
    // wraps, one of them in the accent, a loose end hanging.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [felt, wrap] = ["#38343f", "#58525f"];
      bootPair(k, () => {
        k.cyl(1.8, 1.95, 4.6, 6, felt, { at: [0, 0.8, 0] });
        k.box(3.6, 2.6, 6.8, felt, { at: [0, -1.8, 1.6] }, 1.1);
        k.ball(1.5, felt, { at: [0, -2.2, 4.4], scale: [1.15, 0.85, 1] });
        k.box(3.7, 0.4, 7.2, tone(felt, -0.06), { at: [0, -3.15, 1.7] }, 0.15);
        for (const [y, tilt, c] of [[-0.4, 0.22, wrap], [0.7, -0.22, wrap], [1.8, 0.22, k.a], [2.9, -0.2, wrap]] as const) k.cyl(2.02, 2.02, 0.5, 6, c, { at: [0, y, 0], rot: [tilt, 0, 0] });
        k.box(3.8, 0.45, 1, wrap, { at: [0, -0.55, 2.4], rot: [0.5, 0, 0] }, 0.1);
        k.rod([[0.9, 3, 1.8], [1.4, 2.2, 2.2], [1.3, 1.4, 2.1]], 0.15, wrap, {}, 4);
      });
    },
  },
  "cloudstep-boots": {
    // Cloudstep Boots: white boots with sky-blue feet and cuffs, trimmed in gold, a glowing gem of the accent on
    // each cuff, and puffs of cloud round the soles.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [white, sky, cloud] = ["#eef3f8", "#8fc3e8", "#fbfdff"];
      bootPair(k, () => {
        k.cyl(1.9, 2.1, 6.4, 6, white, { at: [0, 2.2, 0] });
        k.cyl(2.55, 2.2, 1.6, 6, sky, { at: [0, 6.1, 0] });
        k.cyl(2.6, 2.6, 0.3, 6, C.gold, { at: [0, 6.95, 0] });
        k.cyl(2.25, 2.25, 0.3, 6, C.gold, { at: [0, 5.3, 0] });
        k.gem(0.7, 1.5, { glow: k.a }, { at: [0, 6.1, 2.55] });
        k.box(3.8, 2.8, 7, sky, { at: [0, -1.5, 1.6] }, 0.9);
        k.box(4.1, 0.3, 7.7, C.gold, { at: [0, -2.85, 1.8] }, 0.1);
        k.box(4, 0.7, 7.6, white, { at: [0, -3.35, 1.8] }, 0.25);
        for (const [x, z, r] of [[-2.1, -1.6, 1.1], [2.1, -1.4, 1], [-2.3, 1.2, 1.2], [2.3, 1.6, 1.1], [-2, 3.8, 1], [2.1, 4, 1.1], [0, 5.9, 1.2], [0, -2.6, 1]]) k.ball(r, cloud, { at: [x, -3.6, z], scale: [1, 0.7, 1] });
      });
    },
  },
  "phase-treads": {
    // Phase Treads: dark violet boots under a cuff of faintly glowing lavender rising to a point at the front,
    // glowing rune lines of the accent up the shaft and on the toe, and a line of it round the sole.
    spin: 0,
    tip: 0.3,
    build: (k) => {
      const [violet, deep] = ["#3b2a55", "#251a38"];
      const rune = { glow: k.a };
      bootPair(k, () => {
        k.cyl(1.9, 2.1, 7, 6, violet, { at: [0, 2.5, 0] });
        k.cyl(2.4, 2.15, 1.2, 6, { glow: "#5d4a86" }, { at: [0, 6.5, 0] });
        k.cone(0.9, 1.8, 4, { glow: "#5d4a86" }, { at: [0, 7.6, 1.9], rot: [0.3, 0, 0] });
        k.box(3.8, 2.8, 7, violet, { at: [0, -1.5, 1.6] }, 0.9);
        k.box(4, 0.8, 7.6, deep, { at: [0, -3.2, 1.8] }, 0.25);
        k.box(4.1, 0.18, 7.7, rune, { at: [0, -2.75, 1.8] }, 0.05);
        k.box(0.22, 4.2, 0.2, rune, { at: [0, 2.6, 2.08] });
        for (const y of [1.2, 3.8]) for (const t of [-1, 1]) k.box(0.9, 0.2, 0.2, rune, { at: [t * 0.35, y + 0.25, 2.05], rot: [0, 0, t * 0.7] });
        k.gem(0.5, 1, rune, { at: [0, 0, 3.4], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.3] });
      });
    },
  },

  // ---- trinkets ----
  ring: {
    spin: 0.8,
    tip: 0.3,
    pad: 0.1,
    build: (k) => {
      k.ring(3.6, 0.9, C.gold, {}, 6, 14);
      k.cyl(1.2, 0.8, 1, 6, C.gold, { at: [0, 4.6, 0] });
      k.gem(1.5, 2.6, { glow: k.a }, { at: [0, 5.9, 0] });
    },
  },
  "linked-rings": {
    spin: 0.7,
    tip: 0.25,
    lean: 0.4,
    pad: 0.08,
    build: (k) => {
      k.ring(3.4, 0.75, C.gold, { at: [-1.7, 0, 0] }, 6, 14);
      k.ring(3.4, 0.75, k.a, { at: [1.7, 0, 0], rot: [Math.PI / 2, 0, 0] }, 6, 14);
    },
  },
  "gem-chain": {
    // A pendant on a chain.
    spin: 0.3,
    tip: 0.25,
    build: (k) => {
      for (const sx of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([v3([sx * 5.5, 7, -0.6]), v3([sx * 3.6, 2.6, 0.4]), v3([sx * 0.6, -0.9, 1])]);
        const links = 9;
        for (let i = 0; i <= links; i++) {
          const t = i / links;
          const at = curve.getPoint(t);
          const along = curve.getTangent(t);
          const link = k.ring(0.6, 0.2, C.gold, { at: [at.x, at.y, at.z], scale: [1.6, 1, 1] }, 4, 6);
          link.rotation.order = "ZYX";
          link.rotation.set(i % 2 ? Math.PI / 2 : 0, 0, Math.atan2(along.y, along.x));
        }
      }
      k.cyl(0.7, 1, 0.9, 6, C.gold, { at: [0, -1.7, 1] });
      k.add(new THREE.OctahedronGeometry(1), { glow: k.a }, { at: [0, -4.6, 1], scale: [2.2, 3.2, 1.2] });
    },
  },
  key: {
    lean: -0.6,
    spin: 0.35,
    build: (k) => {
      k.ring(2.6, 0.75, C.gold, { at: [0, 6, 0] }, 6, 10);
      k.gem(1.1, 2, { glow: k.a }, { at: [0, 6, 0] });
      k.cyl(0.65, 0.65, 10, 6, C.gold, { at: [0, -1.5, 0] });
      k.cyl(1, 1, 0.7, 6, "#b8891f", { at: [0, 3.2, 0] });
      k.box(2.6, 1, 0.9, C.gold, { at: [1.6, -4.6, 0] }, 0.15);
      k.box(1.8, 0.9, 0.9, C.gold, { at: [1.2, -6.1, 0] }, 0.15);
    },
  },
  "crowned-heart": {
    // The harbormaster's badge: a heart under a crown.
    spin: 0.45,
    tip: 0.15,
    build: (k) => {
      k.plate(heartOutline(13), 2, k.a, {}, 0.6);
      k.cyl(3.2, 3, 1.2, 8, C.gold, { at: [0, 5.6, 0] });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        k.cone(0.55, 1.7, 4, C.gold, { at: [Math.cos(a) * 2.8, 7, Math.sin(a) * 2.8] });
        k.ball(0.35, C.gold, { at: [Math.cos(a) * 2.8, 8, Math.sin(a) * 2.8] });
      }
    },
  },

  // ---- hut materials ----
  "res-wood": {
    // Three logs, two below and one on top, their cut ends toward you.
    spin: -0.75,
    tip: 0.3,
    build: (k) => {
      const end = "#d9b27c";
      const along: Place["rot"] = [0, 0, Math.PI / 2];
      for (const [y, z, len] of [[-1.9, -2.3, 11], [-1.9, 2.3, 10.4], [1.9, 0, 10.8]] as const) {
        k.cyl(2.2, 2.2, len, 8, [C.wood, end, end], { at: [0, y, z], rot: along });
        for (const sx of [-1, 1]) k.cyl(1.1, 1.1, 0.1, 8, C.leather, { at: [(sx * len) / 2, y, z], rot: along });
      }
    },
  },
  "res-stone": {
    spin: 0.4,
    tip: 0.2,
    build: (k) => {
      k.add(roughen(new THREE.IcosahedronGeometry(5, 0), 0.22, 1), C.iron, { scale: [1.1, 0.8, 1] });
      k.add(roughen(new THREE.IcosahedronGeometry(2.6, 0), 0.25, 2), "#a2abb8", { at: [4.6, -2.4, 2.6] });
    },
  },
  "res-iron": { spin: 0.6, tip: 0.45, build: (k) => ingots(k, "#aeb6c3") },
  "res-copper": { spin: 0.6, tip: 0.45, build: (k) => ingots(k, "#c8743a") },
  "res-gem": {
    // A cut gem, and a smaller one beside it.
    spin: 0.4,
    tip: 0.35,
    build: (k) => {
      const cut: [number, number][] = [[0, -4.4], [4, 0.6], [4, 1.2], [2.4, 2.8], [0, 2.8]];
      k.lathe(cut, 8, { glow: "#ff6fe0" });
      k.lathe(cut, 8, { glow: "#ff9be8" }, { at: [4.8, -3, 1.6], scale: 0.42, rot: [0.4, 0, -0.5] });
    },
  },
  "res-fur": {
    // A pelt stretched flat: four legs, a tail, darker along the spine.
    spin: 0.3,
    tip: 0.75,
    build: (k) => {
      const half: [number, number][] = [[0, 7.5], [1.2, 6.8], [1.6, 5.6], [4.6, 6.2], [5.4, 5.2], [2.9, 3.4], [3.3, 0], [2.9, -3], [5.4, -4.4], [4.8, -5.7], [2.2, -5], [0.9, -6], [0.6, -9], [0, -9.6]];
      const outline = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
      const pelt = k.plate(outline, 0.7, "#c08550", {}, 0.35);
      const p = pelt.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.6 * Math.cos(p.getY(i) * 0.45) - 0.4 * Math.cos(p.getX(i) * 0.5));
      k.box(1.8, 12, 0.4, C.leather, { at: [0, -0.6, 1.05] }, 0.15);
      for (const sx of [-1, 1]) k.cone(0.6, 1.4, 4, C.hide, { at: [sx * 0.9, 7.6, 0.3], rot: [0, 0, -sx * 0.4] });
    },
  },
  "res-bone": {
    lean: DIAG,
    spin: 0.4,
    build: (k) => {
      k.cyl(1, 1, 10, 6, C.bone, {});
      for (const sy of [-1, 1]) for (const sx of [-1, 1]) k.ball(1.6, C.bone, { at: [sx * 1.1, sy * 5.6, 0] }, 1);
    },
  },
  "res-herbs": {
    // A tied bunch of leafy stems with a few small flowers.
    lean: -0.15,
    build: (k) => {
      for (const [x, z] of [[-2.6, 0], [-1.2, 1], [0, -0.6], [1.3, 0.9], [2.6, 0]] as const) k.rod([[0, -7, 0], [0, -3, 0], [x, 2.6, z]], 0.25, "#3d6b2c", {}, 4);
      k.cyl(1.1, 1.1, 1.4, 6, C.leather, { at: [0, -3, 0] });
      const leaves: [number, number, number, number, string][] = [
        [-3, 3.6, 0.5, 0.5, "#4f8a3a"], [-1.4, 4.8, 1.2, 0.2, "#6fae4a"], [0.2, 4, -0.8, -0.1, "#4f8a3a"], [1.6, 4.8, 1, -0.3, "#6fae4a"],
        [3, 3.4, 0.2, -0.6, "#4f8a3a"], [-0.6, 2.2, 1.6, 0.3, "#3d6b2c"], [1, 2.4, 1.6, -0.4, "#4f8a3a"],
      ];
      for (const [x, y, z, r, c] of leaves) k.add(new THREE.OctahedronGeometry(1), c, { at: [x, y, z], rot: [0.3, 0, r], scale: [1.3, 2.2, 0.4] });
      k.ball(0.75, "#c9a3e6", { at: [-2.2, 5.6, 1] });
      k.ball(0.75, "#c9a3e6", { at: [2.4, 6, 0.4] });
      k.ball(0.65, C.paper, { at: [0.3, 6.4, 0.6] });
    },
  },
  "res-mushrooms": {
    // Two caps on pale stems, the near one larger, on a little moss.
    spin: 0.4,
    tip: 0.35,
    build: (k) => {
      k.cyl(5.6, 5.9, 0.6, 8, "#4f8a3a", { at: [0, -0.3, 0] });
      mushroom(k, -1.6, 0.6, 1.25);
      mushroom(k, 3, -1.2, 0.85);
    },
  },
  "res-slime": {
    // A squat glob of cave slime with a smaller one beside it, a shine on each and a bubble caught inside.
    spin: 0.4,
    tip: 0.35,
    build: (k) => {
      k.ball(4.2, "#65a30d", { at: [-0.8, 1.6, 0], scale: [1.25, 0.62, 1.1] }, 1);
      k.ball(2, "#4d7c0f", { at: [3.6, 0.8, 1.6], scale: [1.2, 0.6, 1.1] }, 1);
      k.ball(1.2, "#a3e635", { at: [-2.2, 3.4, 1.2], scale: [1.4, 0.4, 1] });
      k.ball(0.6, "#a3e635", { at: [3.2, 1.8, 2.2], scale: [1.4, 0.4, 1] });
      k.ball(0.7, "#d9f99d", { at: [0.8, 2.2, 3.6] });
    },
  },

  // ---- gold ----
  cash: {
    // Two stacks of coins, one taller.
    spin: 0.4,
    tip: 0.45,
    build: (k) => {
      const edge = "#b8891f";
      const coin = (x: number, y: number, z: number) => k.cyl(3.2, 3.2, 0.8, 10, [edge, C.gold, C.gold], { at: [x, y, z] });
      for (const [i, x, z] of [[0, 0, 0], [1, 0.3, -0.2], [2, -0.2, 0.2], [3, 0.2, 0.1], [4, -0.1, -0.1]] as const) coin(x - 2, i * 0.85, z - 1);
      k.ring(2.3, 0.2, C.gold, { at: [-2.1, 3.85, -1.1], rot: [Math.PI / 2, 0, 0] }, 4, 10);
      for (const [i, x, z] of [[0, 0, 0], [1, -0.3, 0.2]] as const) coin(x + 3.4, i * 0.85, z + 2.4);
    },
  },
};

// ---------- starting clothes ----------
// Each class's own hat, tunic, trousers and shoes (garbIcon in packages/world/src/gear.ts), pictured in the class's
// stock look as the figure draws them on a hero of that class (figures.ts): the same hat, the same colours, a coat
// or a vest where the class has one, and what it wears over them.

/** A colour a little lighter (k > 0) or darker (k < 0), as figures.ts tones its cloth. */
const tone = (hex: string, k: number) => `#${new THREE.Color(hex).offsetHSL(0, 0, k).getHexString()}`;

/**
 * A tricorn in `c`: a low round crown (over a band of `band`, if given), and round it a brim cocked up into three
 * walls meeting in three points, one over the brow; a gold braid along their tops and a cockade of `cockade` on the left.
 */
function tricornHat(k: Kit, c: string, cockade: string, band?: string) {
  if (band) k.cyl(3.55, 3.6, 1.1, 10, band, { at: [0, -0.4, 0] });
  k.lathe([[3.45, 0], [3.5, 2], [3, 3.6], [1.8, 4.4], [0, 4.6]], 10, c);
  const foot = Array.from({ length: 6 }, (_, i) => {
    const point = i % 2 === 0;
    return { a: (i / 6) * Math.PI * 2, r: point ? 6.6 : 4.5, y: point ? 0.6 : 0, top: point ? 1.4 : 3.8 };
  });
  const at = (f: (typeof foot)[number], s: number, y: number): V3 => [Math.sin(f.a) * f.r * s, y, Math.cos(f.a) * f.r * s];
  for (let i = 0; i < 6; i++) {
    const [f, g] = [foot[i], foot[(i + 1) % 6]];
    const pts: V3[] = [];
    for (const s of [1, 0.88]) pts.push(at(f, s, f.y), at(g, s, g.y), at(f, s * 1.05, f.top), at(g, s * 1.05, g.top));
    k.hull(pts, c);
    k.rod([at(f, 1.02, f.top + 0.05), at(g, 1.02, g.top + 0.05)], 0.2, C.gold, {}, 4);
  }
  const w = foot[1];
  k.ball(0.8, cockade, { at: at(w, 1.08, 2.2), scale: [1, 1, 0.5], rot: [0, w.a, 0] });
  k.ball(0.32, C.gold, { at: at(w, 1.16, 2.2) });
}

/** A class's hat, as its look draws it: [hat, its colour]. */
function garbHat(k: Kit, look: Look) {
  const c = look.hatColor ?? look.body;
  switch (look.hat) {
    case "lamphelm":
      LOW_POLY["lantern-helm"].build(k);
      return;
    case "hood": {
      // A peaked hood with a shadowed opening, and a mantle over the shoulders.
      const cowl = new THREE.LatheGeometry([[0, 8.5], [1.2, 7.8], [3, 5.8], [4.4, 3], [4.9, 0], [4.8, -2.6], [4.4, -4]].reverse().map(([r, y]) => new THREE.Vector2(r, y)), 8);
      const p = cowl.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - Math.max(0, p.getY(i) - 2) * 0.35);
      k.add(cowl, c);
      k.cyl(4.4, 6.6, 3, 8, tone(c, -0.04), { at: [0, -5.4, 0] });
      k.cyl(2.8, 2.8, 1, 10, "#141a1a", { at: [0, 0.2, 4.2], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.3] });
      k.ring(2.9, 0.5, tone(c, 0.06), { at: [0, 0.2, 4.6], scale: [1, 1.3, 1] }, 5, 12);
      return;
    }
    case "tricorn":
      tricornHat(k, c, look.accent, look.bandana);
      return;
    case "kerchief": {
      // Tied close over the crown, knotted on one side, two tails hanging from the knot.
      k.lathe([[4.5, -1.2], [4.6, 0.8], [4.1, 3], [2.8, 4.6], [1.3, 5.4], [0, 5.6]], 10, c);
      const side = look.knotSide ? 1 : 0;
      const [x, z] = side ? [4.5, -0.6] : [0, -4.5];
      k.ball(0.95, tone(c, -0.08), { at: [x, 0, z] }, 1);
      for (const [dx, dz, len] of [[0.4, -0.5, 3.4], [0.2, 0.6, 2.6]] as const) {
        const [ox, oz] = side ? [dx, dz] : [dz, -dx];
        k.rod([[x, -0.3, z], [x + ox * 1.5, -len * 0.5, z + oz * 1.5], [x + ox * 2.2, -len, z + oz * 2.2]], 0.45, dx > 0.3 ? c : tone(c, -0.08), {}, 4);
      }
      return;
    }
    case "coral": {
      // A band of kelp, and on it a crown of branching coral, tallest at the front, with a little shell there.
      k.cyl(4.4, 4.5, 1.4, 10, "#3d6b2e", {});
      for (let i = 0; i < 7; i++) {
        const a = ((i - 3) / 3) * 1.9;
        const tall = 1 - Math.abs(i - 3) * 0.12;
        const col = i % 2 ? c : tone(c, 0.1);
        const base: V3 = [Math.sin(a) * 4.3, 0.5, Math.cos(a) * 4.3];
        const tip: V3 = [base[0] * 1.2, 0.5 + 4.4 * tall, base[2] * 1.2];
        k.rod([base, tip], 0.42, col, {}, 5);
        k.ball(0.32, tone(col, 0.15), { at: tip });
        for (const [t, side, up] of [[0.4, 1, 1.8], [0.65, -1, 1.4]] as const) {
          const mid: V3 = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
          const end: V3 = [mid[0] + Math.cos(a) * 1.1 * side, mid[1] + up, mid[2] - Math.sin(a) * 1.1 * side];
          k.rod([mid, end], 0.24, col, {}, 4);
          k.ball(0.22, tone(col, 0.15), { at: end });
        }
      }
      k.ball(0.6, "#f0dcc8", { at: [0, 0.3, 4.6], scale: [1, 0.8, 0.5] });
      return;
    }
    case "diver": {
      // A round brass helmet on a bolted collar: a big round window in front, a smaller one each side, a valve on top.
      const dark = tone(c, -0.2);
      k.lathe([[0, -3.6], [3.6, -3.3], [5, -1.5], [5.3, 0.6], [4.8, 2.8], [3.4, 4.6], [1.6, 5.5], [0, 5.7]], 12, c);
      k.cyl(5.4, 6.2, 1.8, 12, dark, { at: [0, -4.2, 0] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        k.ball(0.35, tone(c, 0.12), { at: [Math.sin(a) * 6, -4.2, Math.cos(a) * 6] });
      }
      const port = (r: number, at: V3, rot: V3) => {
        k.cyl(r, r, 0.5, 12, "#2b3d48", { at, rot });
        k.ring(r, 0.32, dark, { at, rot: [rot[0] - Math.PI / 2, rot[1], rot[2]] }, 4, 14);
      };
      port(2.4, [0, 0.4, 5], [Math.PI / 2, 0, 0]);
      for (const s of [-1, 1]) port(1.2, [s * 5, 0.8, -0.3], [0, 0, Math.PI / 2]);
      k.cyl(0.6, 0.8, 1.2, 8, dark, { at: [0, 6.1, -0.6] });
      return;
    }
    default: {
      // No hat but a band of cloth round the brow, knotted behind, its two ends hanging.
      const band = look.bandana ?? c;
      // Turned so the knot shows, behind on the right.
      k.within({ rot: [0, 2.3, 0] }, () => {
        k.ring(4.3, 0.55, band, { rot: [Math.PI / 2, 0, 0], scale: [1, 1, 1.9] }, 6, 14);
        k.ball(0.95, tone(band, -0.08), { at: [0, 0, -4.5] }, 1);
        for (const s of [-1, 1]) k.rod([[0, -0.2, -4.6], [s * 0.9, -2, -4.9], [s * 1.5, -3.8, -4.8]], 0.45, s > 0 ? band : tone(band, -0.08), {}, 4);
      });
    }
  }
}

/** A tunic's body, from the collar (y 6) to below the waist: rows of [y, half-width, front, back]. */
type Row = readonly [y: number, halfWidth: number, front: number, back: number];
const TORSO: readonly Row[] = [[6, 4.6, 2.4, 2.4], [3, 5, 3.2, 2.6], [-3, 4.4, 2.6, 2.3], [-6.2, 4.8, 2.7, 2.5]];
function torsoPoints(rows: readonly Row[], grow = 0): V3[] {
  const pts: V3[] = [];
  for (const [y, w0, f0, b0] of rows) {
    const [w, front, back] = [w0 + grow, f0 + grow, b0 + grow];
    pts.push([-w, y, 0], [w, y, 0], [0, y, front], [0, y, -back]);
    for (const sx of [-1, 1]) pts.push([sx * w * 0.72, y, front * 0.85], [sx * w * 0.72, y, -back * 0.9]);
  }
  return pts;
}
/** A tunic's row at height `y`, between the rows either side of it (`rows` from the top down). */
function rowAt(rows: readonly Row[], y: number): Row {
  for (let i = 0; i + 1 < rows.length; i++) {
    const [p, q] = [rows[i], rows[i + 1]];
    if (y <= p[0] && y >= q[0]) {
      const t = (p[0] - y) / (p[0] - q[0]);
      return [y, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t, p[3] + (q[3] - p[3]) * t];
    }
  }
  const end = y > rows[0][0] ? rows[0] : rows[rows.length - 1];
  return [y, end[1], end[2], end[3]];
}
/** The darker line of a course of mail rings. */
const MAIL = "#6f7888";
/** How far forward the tunic's front is at height `y`. */
function frontAt(y: number, rows: readonly Row[] = TORSO): number {
  for (let i = 0; i + 1 < rows.length; i++) {
    const [p, q] = [rows[i], rows[i + 1]];
    if (y <= p[0] && y >= q[0]) return p[2] + ((q[2] - p[2]) * (p[0] - y)) / (p[0] - q[0]);
  }
  return y > rows[0][0] ? rows[0][2] : rows[rows.length - 1][2];
}
/** How far forward the tunic's front is `x` across at height `y`, on the hull torsoPoints makes of `rows`. */
function frontZ(x: number, y: number, rows: readonly Row[] = TORSO): number {
  const [, w, f] = rowAt(rows, y);
  const ax = Math.abs(x);
  if (ax <= 0.72 * w) return f * (1 - 0.15 * (ax / (0.72 * w)));
  return f * 0.85 * Math.max(0, (w - ax) / (0.28 * w));
}

/** A class's tunic: its shirt, and over it the coat or vest the class wears, with its sash, straps and the rest. */
function garbTunic(k: Kit, look: Look) {
  const shirt = look.body;
  const coat = look.coat ? (look.coatColor ?? look.body) : null;
  const outer = coat ?? look.vest ?? null;
  const trim = coat ? (look.coatTrim ?? look.accent) : look.vest ? tone(look.vest, -0.1) : tone(shirt, 0.08);
  if (outer) {
    // Open down the front: the outer garment all round, the shirt in a strip between its fronts, trimmed either
    // side. A coat hangs to the shins; a vest covers the chest, the shirt showing below it.
    if (!coat) k.hull(torsoPoints(TORSO), shirt);
    const rows: readonly Row[] = coat ? [...TORSO.slice(0, 3), [-6.2, 5, 2.8, 2.6], [-11, 5.8, 3.2, 3]] : [TORSO[0], TORSO[1], [-1.6, 4.55, 2.75, 2.35]];
    k.hull(torsoPoints(rows, 0.15), outer);
    const top = 5.8;
    const bottom = coat ? -2.6 : -1.6;
    const strip: V3[] = [];
    for (const y of [top, 3, bottom]) {
      const z = frontAt(y, rows) + 0.2;
      const w = y === top ? 1.1 : 0.6;
      strip.push([-w, y, z], [w, y, z], [-w, y, z - 0.6], [w, y, z - 0.6]);
    }
    k.hull(strip, shirt);
    for (const s of [-1, 1]) {
      const edge: V3[] = [];
      for (const y of [top, 3, bottom]) edge.push([s * (y === top ? 1.25 : 0.75), y, frontAt(y, rows) + 0.28]);
      k.rod(edge, 0.24, trim, {}, 4);
    }
    if (coat) {
      // Below the waist the coat hangs open over the legs: a dark gap between its skirts, edged in the trim.
      k.box(1.2, 8.2, 0.4, tone(coat, -0.25), { at: [0, -6.9, frontAt(-6.9, rows) + 0.05] });
      for (const s of [-1, 1]) k.rod([[s * 0.75, -2.6, frontAt(-2.6, rows) + 0.28], [s * 0.75, -6.2, frontAt(-6.2, rows) + 0.3], [s * 0.9, -11, frontAt(-11, rows) + 0.25]], 0.24, trim, {}, 4);
    } else {
      for (const y of [1.2, 3]) for (const s of [-1, 1]) k.ball(0.28, C.gold, { at: [s * 1.25, y, frontAt(y) + 0.3] });
    }
  } else {
    // A plain tunic: a placket down the front with brass buttons.
    k.hull(torsoPoints(TORSO), shirt);
    k.box(1.2, 6.5, 0.3, tone(shirt, 0.08), { at: [0, 2.2, frontAt(2.2) + 0.05] });
    for (const y of [4, 2.2, 0.4]) k.ball(0.38, C.gold, { at: [0, y, frontAt(y) + 0.25] });
  }
  // The neck, open.
  k.cyl(2, 2.4, 0.5, 8, C.dark, { at: [0, 6.05, 0] });
  // Sleeves, in the outer cloth where there is a coat; none on a sleeveless shirt (a vest's arms are bare).
  if (look.sleeveless) {
    // Only a cap of the shirt over each shoulder.
    for (const s of [-1, 1]) k.cyl(1.7, 1.9, 1.8, 6, shirt, { at: [s * 5, 5.1, 0], rot: [0, 0, s * 0.5] });
  } else {
    for (const s of [-1, 1]) {
      const cloth = coat ?? shirt;
      k.cyl(1.6, 1.9, 4.6, 6, cloth, { at: [s * 5.5, 4, 0], rot: [0, 0, s * 0.5] });
      k.cyl(1.75, 1.75, 0.9, 6, coat ? trim : tone(shirt, -0.08), { at: [s * 6.6, 2.05, 0], rot: [0, 0, s * 0.5] });
    }
  }
  // Bands of colour round the chest (the Paladin's surcoat).
  if (look.stripes) for (const y of [0.6, 2.4]) k.hull(torsoPoints([[y + 0.5, 5, frontAt(y + 0.5), 2.6], [y - 0.5, 4.9, frontAt(y - 0.5), 2.55]], 0.12), look.stripes);
  // Round the waist: the sash, wound twice and knotted on the left hip with its ends hanging; else a belt.
  const waist = -3.8;
  const belt = (h: number, color: string) => k.hull(torsoPoints([[waist + h / 2, 4.5, 2.7, 2.4], [waist - h / 2, 4.5, 2.7, 2.4]], outer ? 0.3 : 0.15), color);
  if (look.sash) {
    belt(1.8, look.sash);
    k.ball(1, tone(look.sash, -0.06), { at: [3.4, waist, 2.2], scale: [1.1, 0.85, 0.7] });
    for (const [dx, len] of [[0.2, 4.2], [-0.4, 3.2]] as const) k.rod([[3.4 + dx, waist - 0.4, 2.4], [3.8 + dx, waist - len * 0.55, 2.6], [3.9 + dx, waist - len, 2.5]], 0.4, look.sash, {}, 4);
  } else {
    belt(1.1, C.leather);
    k.box(1.4, 1.4, 0.5, C.gold, { at: [0, waist, frontAt(waist) + 0.45] }, 0.1);
  }
  if (look.straps) {
    // A strap from the right shoulder across the chest to the left hip, with a buckle.
    const pts: V3[] = [0, 0.5, 1].map((t): V3 => {
      const y = 5.4 - 7.6 * t;
      return [-3 + 6 * t, y, frontAt(y) + (outer ? 0.45 : 0.3)];
    });
    k.rod(pts, 0.42, look.straps, {}, 4);
    k.box(0.8, 0.8, 0.3, C.iron, { at: [-0.1, 1.6, frontAt(1.6) + 0.6] });
  }
  if (look.teeth) {
    // Teeth strung round the throat, pointing down, a stone at the middle.
    for (let i = 0; i < 9; i++) {
      const x = -2 + (4 * i) / 8;
      const y = 5.2 - 0.6 * Math.cos((x / 2) * (Math.PI / 2));
      k.cone(0.24, 0.9, 4, C.bone, { at: [x, y - 0.45, frontAt(y) + 0.4], rot: [Math.PI, 0, 0] });
    }
    k.ball(0.4, { glow: look.teeth }, { at: [0, 4.3, frontAt(4.3) + 0.5] });
  }
  for (const s of [-1, 1]) {
    const shoulder: V3 = [s * 4.4, 6.1, 0];
    if (look.epaulettes) {
      k.box(3, 0.6, 3.2, look.epaulettes, { at: shoulder, rot: [0, 0, -s * 0.25] }, 0.2);
      for (let i = 0; i < 5; i++) k.box(0.22, 1.1, 0.22, tone(look.epaulettes, -0.08), { at: [s * 5.8, 5.3, -1.2 + (2.4 * i) / 4] });
    }
    if (look.shell) {
      // A scallop shell on each shoulder: a fan of ribs.
      k.dome(2.2, 7, look.shell, { at: [s * 4.6, 5.9, 0], rot: [0, 0, -s * 0.5], scale: [1, 0.45, 1.1] });
      for (let i = 0; i < 5; i++) k.rod([[s * 4.6, 6.4, 0], [s * (4.6 + 1.4 * Math.cos(-s * 0.5)), 6.9 - 0.3 * s * s, -1.7 + (3.4 * i) / 4]], 0.09, tone(look.shell, -0.18), {}, 3);
    }
    if (look.barnacles) for (const [dx, dz, r] of [[0, 0.6, 0.55], [0.7, -0.8, 0.45], [-0.6, -0.3, 0.4]] as const) k.cone(r, r * 1.3, 5, "#cfc6b0", { at: [s * (4.4 + dx), 6.5, dz] });
  }
  if (look.corselet) {
    // A brass plate over the shoulders, bolted round, that the diving helmet seats on.
    k.cyl(3.4, 5.2, 1.6, 12, look.corselet, { at: [0, 6, 0] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.ball(0.3, tone(look.corselet, 0.12), { at: [Math.sin(a) * 4.5, 5.6, Math.cos(a) * 4.5] });
    }
  }
  if (look.vines) {
    // Kelp growing up round the torso from the hem, leaves along it.
    for (const s of [-1, 1]) {
      const pts: V3[] = [-5.5, -2, 1.5, 4.5].map((y, i): V3 => [s * (2.6 - i * 0.4 + (i % 2) * 0.8), y, frontAt(y) + 0.3]);
      k.rod(pts, 0.28, look.vines, {}, 4);
      for (const p of pts.slice(1)) k.ball(0.4, tone(look.vines, 0.12), { at: [p[0] + s * 0.4, p[1], p[2] + 0.1], scale: [0.7, 1.7, 0.35] });
    }
  }
}

/** A class's trousers: a waistband and two legs, in its leg colour. */
function garbTrousers(k: Kit, look: Look) {
  const c = look.legs;
  k.box(8.6, 2, 4.2, tone(c, -0.06), { at: [0, 6, 0] }, 0.4);
  k.box(8.2, 3, 4, c, { at: [0, 3.8, 0] }, 0.5);
  for (const sx of [-1, 1]) {
    k.cyl(2, 1.75, 10, 6, c, { at: [sx * 2.3, -2.6, 0], rot: [0, 0, sx * 0.05] });
    k.cyl(1.85, 1.85, 0.8, 6, tone(c, -0.08), { at: [sx * 2.55, -7.2, 0] });
  }
  k.box(0.5, 2.2, 0.3, tone(c, -0.12), { at: [0, 3.9, 2.05] });
}

/** A class's shoes: tall leather sea boots with a band in its boot colour, turned down at the top; or plain dark shoes. */
function garbShoes(k: Kit, look: Look) {
  const pair = (one: () => void) => {
    k.within({ at: [-2.6, 0, -0.6], rot: [0, -0.45, 0] }, one);
    k.within({ at: [2.6, 0, 0.4], rot: [0, -0.3, 0] }, one);
  };
  if (!look.boots) {
    pair(() => {
      k.box(3.8, 2.6, 7, C.dark, { at: [0, -1.6, 1.6] }, 0.9);
      k.box(4, 0.7, 7.6, tone(C.dark, -0.06), { at: [0, -3.2, 1.8] }, 0.25);
    });
    return;
  }
  const band = look.boots;
  pair(() => {
    k.cyl(1.9, 2.1, 6, 6, C.leather, { at: [0, 2, 0] });
    k.cyl(2.35, 2.25, 1.6, 6, tone(C.leather, 0.08), { at: [0, 5.4, 0] });
    k.cyl(2.15, 2.15, 0.8, 6, band, { at: [0, 4.1, 0] });
    k.box(3.8, 2.8, 7, C.leather, { at: [0, -1.5, 1.6] }, 0.9);
    k.box(4, 0.7, 7.6, C.bark, { at: [0, -3.2, 1.8] }, 0.25);
  });
}

const GARB_BUILD: Record<GarbPiece, (k: Kit, look: Look) => void> = { hat: garbHat, tunic: garbTunic, trousers: garbTrousers, shoes: garbShoes };
const GARB_VIEW: Record<GarbPiece, Omit<LowPolyDef, "build">> = { hat: { spin: 0.4, tip: 0.25 }, tunic: { spin: 0.45, tip: 0.2 }, trousers: { spin: 0.45, tip: 0.15 }, shoes: { spin: 0, tip: 0.3 } };

/** The model for a class's own piece of starting clothes ("garb-tunic:staff_sage"), or null for any other icon. */
function garbModel(icon: string): LowPolyDef | null {
  const g = parseGarbIcon(icon);
  const look = g && LOOKS[g.classId];
  if (!g || !look) return null;
  return { ...GARB_VIEW[g.piece], build: (k) => GARB_BUILD[g.piece](k, look) };
}

// ---------- building ----------

const materials = new Map<string, THREE.Material>();

function material(paint: Paint): THREE.Material {
  const glow = typeof paint !== "string";
  const color = glow ? paint.glow : paint;
  const key = `${color}|${glow}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...(glow ? { emissive: color, emissiveIntensity: 0.45 } : {}) });
    m.userData.glow = glow;
    materials.set(key, m);
  }
  return m;
}

/** Darken a #rrggbb colour by a share. */
function darken(hex: string, by = 0.35): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - by)).toString(16).padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function place(o: THREE.Object3D, p: Place = {}) {
  if (p.at) o.position.set(...p.at);
  if (p.rot) o.rotation.set(...p.rot);
  if (p.scale !== undefined) typeof p.scale === "number" ? o.scale.setScalar(p.scale) : o.scale.set(...p.scale);
}

/**
 * The model for an icon, in the accent colour, or null when the icon has none. `inHand` builds what one hand
 * holds of it instead (see LowPolyDef.inHand), where that differs.
 */
export function buildLowPoly(name: string, accent: string, inHand = false): { model: THREE.Object3D; def: LowPolyDef } | null {
  const def = LOW_POLY[name] ?? garbModel(name);
  if (!def) return null;
  const root = new THREE.Group();
  const parents: THREE.Object3D[] = [root];
  const top = () => parents[parents.length - 1];
  let flickers = 0;
  const add: Kit["add"] = (geo, paint, p) => {
    const mesh = new THREE.Mesh(geo, Array.isArray(paint) ? paint.map(material) : material(paint));
    place(mesh, p);
    top().add(mesh);
    return mesh;
  };
  const k: Kit = {
    a: accent,
    s: darken(accent),
    add,
    box: (w, h, d, paint, p, bevel = 0) =>
      add(bevel > 0 ? new ConvexGeometry(chamferPoints(w, h, d, Math.min(bevel, w / 2.2, h / 2.2, d / 2.2)).map(v3)) : new THREE.BoxGeometry(w, h, d), paint, p),
    cyl: (rt, rb, h, sides, paint, p) => add(new THREE.CylinderGeometry(rt, rb, h, sides), paint, p),
    cone: (r, h, sides, paint, p) => add(new THREE.ConeGeometry(r, h, sides), paint, p),
    ball: (r, paint, p, detail = 0) => add(new THREE.IcosahedronGeometry(r, detail), paint, p),
    gem: (r, h, paint, p) => {
      const g = new THREE.OctahedronGeometry(1);
      g.scale(r, h / 2, r);
      return add(g, paint, p);
    },
    dome: (r, sides, paint, p) => add(new THREE.SphereGeometry(r, sides, Math.max(2, Math.round(sides / 3)), 0, Math.PI * 2, 0, Math.PI / 2), paint, p),
    lathe: (profile, sides, paint, p) => add(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), sides), paint, p),
    plate: (outline, depth, paint, p, bevel = 0) => {
      const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
      g.translate(0, 0, -depth / 2);
      return add(g, paint, p);
    },
    rod: (points, r, paint, p, sides = 6) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v3)), Math.max(6, points.length * 3), r, sides, false), paint, p),
    ring: (R, r, paint, p, radial = 6, tubular = 12) => add(new THREE.TorusGeometry(R, r, radial, tubular), paint, p),
    hull: (points, paint, p) => add(new ConvexGeometry(points.map(v3)), paint, p),
    within: (p, build) => {
      const g = new THREE.Group();
      place(g, p);
      top().add(g);
      parents.push(g);
      build();
      parents.pop();
    },
    spin: (pivot, axis, build, speed) => {
      const g = new THREE.Group();
      g.userData.spin = { pivot, axis, speed } satisfies Spin;
      top().add(g);
      parents.push(g);
      build();
      parents.pop();
    },
    dangle: (pivot, bob, build, opts) => {
      const g = new THREE.Group();
      g.userData.dangle = { pivot, bob, ...opts } satisfies Dangle;
      top().add(g);
      parents.push(g);
      build();
      parents.pop();
    },
    flicker: (build) => {
      if (!inHand && flickers++ > 0) return;
      const g = new THREE.Group();
      g.userData.flicker = true;
      top().add(g);
      parents.push(g);
      build();
      parents.pop();
    },
  };
  (inHand && def.inHand ? def.inHand : def.build)(k);
  return { model: root, def };
}

/** Free a model's geometry (the materials are shared and kept). */
export function disposeLowPoly(model: THREE.Object3D) {
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}
