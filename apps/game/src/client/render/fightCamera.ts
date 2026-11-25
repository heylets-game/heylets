// The camera in a fight. Whoever's turn it is is followed wherever they go (watch), and a shot from
// further off than a blow reaches has the view draw back until both ends of it are on screen, the one who
// lets it go and whoever or wherever it is aimed at (shoot), coming back once it has landed.
//
// The player can always take the camera: a pan, or sending it somewhere, stops it following until the one
// being watched next sets off (or the next turn begins), and lets go of any shot being framed.

import * as THREE from "three";

/**
 * Where on screen a framed shot may reach, in normalised device coordinates (-1 to 1 across and up): `side` in
 * from either edge, no higher than `top` and no lower than `bottom`.
 */
export interface Box {
  side: number;
  top: number;
  bottom: number;
}

/** How the camera is set up to look, apart from where and from how far. */
export interface Lens {
  fov: number;
  aspect: number;
  /** Which way round it looks from, and how steeply down (see WorldRenderer). */
  yaw: number;
  pitch: number;
  /** How far the camera stands from what it looks at, per unit of zoom. */
  reach: number;
  /** Where on screen what is framed must fit: SHOT_BOX unless the fight's panels say otherwise. */
  box?: Box;
}

/** Something a shot takes in: where its feet are, and how tall it stands there. */
export interface ShotEnd {
  feet: THREE.Vector3;
  height: number;
}

/**
 * Where on screen a framed shot may reach unless told otherwise: in from the sides, under the turn order along
 * the top and over the turn bar along the bottom (as they sit on a wide window).
 */
export const SHOT_BOX: Box = { side: 0.7, top: 0.62, bottom: -0.3 };

/** The lowest and highest a box's bottom edge is taken to be, however much (or little) the panels cover. */
export const FLOOR_RANGE = { min: -0.6, max: 0.1 };

/** Seconds a framed shot stays framed after it has landed, to see what it did. */
export const SHOT_LINGER = 0.55;

/** The longest a shot is framed for, in seconds, if it is never said to have landed (a hidden tab draws nothing). */
export const SHOT_MAX = 4;

/** Stand `cam` where the view would put it, looking at `target` from `dist` away. */
export function placeEye(cam: THREE.PerspectiveCamera, target: THREE.Vector3, dist: number, lens: Lens) {
  cam.fov = lens.fov;
  cam.aspect = lens.aspect;
  cam.updateProjectionMatrix();
  const reach = dist * lens.reach;
  const flat = reach * Math.cos(lens.pitch);
  cam.position.set(target.x + Math.sin(lens.yaw) * flat, target.y + reach * Math.sin(lens.pitch), target.z + Math.cos(lens.yaw) * flat);
  cam.lookAt(target);
  cam.updateMatrixWorld();
}

const seen = new THREE.Vector3();

/** Whether every one of `ends`, feet and head, is inside `box` as `cam` sees it. */
export function allInView(cam: THREE.PerspectiveCamera, ends: ShotEnd[], box: Box = SHOT_BOX): boolean {
  for (const end of ends) {
    for (const lift of [0, end.height]) {
      seen.copy(end.feet).setY(end.feet.y + lift).project(cam);
      if (seen.z > 1 || seen.z < -1 || Math.abs(seen.x) > box.side || seen.y > box.top || seen.y < box.bottom) return false;
    }
  }
  return true;
}

/** What `ends` (feet and heads) cover on screen as `cam` sees them, in normalised device coordinates. */
export function spanOf(cam: THREE.PerspectiveCamera, ends: ShotEnd[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const span = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const end of ends) {
    for (const lift of [0, end.height]) {
      seen.copy(end.feet).setY(end.feet.y + lift).project(cam);
      span.minX = Math.min(span.minX, seen.x);
      span.maxX = Math.max(span.maxX, seen.x);
      span.minY = Math.min(span.minY, seen.y);
      span.maxY = Math.max(span.maxY, seen.y);
    }
  }
  return span;
}

const caster = new THREE.Raycaster();
const level = new THREE.Plane();
const up = new THREE.Vector3(0, 1, 0);
const onScreen = new THREE.Vector2();

/** The point on the ground at height `y` that `cam` sees at (x, y) on screen, into `out`; null if it looks over it. */
function groundAt(cam: THREE.PerspectiveCamera, x: number, sy: number, y: number, out: THREE.Vector3): THREE.Vector3 | null {
  caster.setFromCamera(onScreen.set(x, sy), cam);
  return caster.ray.intersectPlane(level.set(up, -y), out);
}

const was = new THREE.Vector3();
const goes = new THREE.Vector3();

/**
 * Where to look from `dist` away to have `ends` in the middle of the lens's box: from `from`, slid along the ground
 * till the middle of what they cover on screen is the middle of the box (which is not the middle of the screen
 * when the panels take more off the bottom than the top). Leaves `cam` placed there.
 */
export function centreOn(cam: THREE.PerspectiveCamera, from: THREE.Vector3, dist: number, lens: Lens, ends: ShotEnd[]): THREE.Vector3 {
  const box = lens.box ?? SHOT_BOX;
  const look = from.clone();
  const wantY = (box.top + box.bottom) / 2;
  for (let i = 0; i < 4; i++) {
    placeEye(cam, look, dist, lens);
    const span = spanOf(cam, ends);
    const x = (span.minX + span.maxX) / 2;
    const y = (span.minY + span.maxY) / 2;
    if (Math.abs(x) < 0.005 && Math.abs(y - wantY) < 0.005) break;
    // The ground seen where their middle is now, and where it should be: the view moves by the difference.
    if (!groundAt(cam, x, y, look.y, was) || !groundAt(cam, 0, wantY, look.y, goes)) break;
    look.add(was.sub(goes));
  }
  placeEye(cam, look, dist, lens);
  return look;
}

/**
 * Where to look, and from how far (no nearer than `near`, no further than `far`), to have all of `ends` in the
 * lens's box: from as close as takes them all in, with them in the middle of it.
 */
export function frameEnds(ends: ShotEnd[], lens: Lens, near: number, far: number, cam = new THREE.PerspectiveCamera()): { at: THREE.Vector3; dist: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let y = 0;
  for (const { feet } of ends) {
    minX = Math.min(minX, feet.x);
    maxX = Math.max(maxX, feet.x);
    minZ = Math.min(minZ, feet.z);
    maxZ = Math.max(maxZ, feet.z);
    y += feet.y;
  }
  const middle = new THREE.Vector3((minX + maxX) / 2, ends.length > 0 ? y / ends.length : 0, (minZ + maxZ) / 2);
  const box = lens.box ?? SHOT_BOX;
  let at = middle;
  const fits = (dist: number) => {
    at = centreOn(cam, middle, dist, lens, ends);
    return allInView(cam, ends, box);
  };
  if (far <= near || fits(near)) return { at, dist: near };
  if (!fits(far)) return { at, dist: far };
  // Fits at `hi`, not at `lo`: halve the gap till it is too small to see.
  let lo = near;
  let hi = far;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fits(hi);
  return { at, dist: hi };
}

interface Shot {
  ends: () => ShotEnd[];
  /** When it stops being framed, on the render clock: SHOT_MAX after it began, or SHOT_LINGER after it landed. */
  until: number;
}

export class FightCamera {
  /** Whose turn the camera is following, or null when none is (out of a fight). */
  watched: string | null = null;
  /** The player has taken the camera this turn: the one being watched is not followed until they next set off. */
  held = false;
  private shots = new Set<Shot>();
  /** Where the camera was going when the first of the shots now being framed took it, to go back to after. */
  private before: THREE.Vector3 | null = null;
  private eye = new THREE.PerspectiveCamera();
  /** The render clock as of the last frame (see aim), in seconds. */
  private clock = 0;

  /** Follow this one from now on (a new turn), or nobody. */
  watch(id: string | null) {
    this.watched = id;
    this.held = false;
  }

  /** Whether the camera is keeping the watched one centred now. */
  get following(): boolean {
    return this.watched !== null && !this.held;
  }

  /** Whether a shot is being framed now. */
  get framing(): boolean {
    return this.shots.size > 0;
  }

  /** The player took the camera (a pan, or sending it to look at something): stop following, and let any shot go. */
  takeOver() {
    this.held = this.watched !== null;
    this.shots.clear();
    this.before = null;
  }

  /** Every shot being framed has landed, as far as anyone will say (what was showing them was cut short). */
  landAll() {
    for (const shot of this.shots) shot.until = Math.min(shot.until, this.clock + SHOT_LINGER);
  }

  /** A unit sets off (a walk, a jump): the one being watched is followed again, whatever the player did before. */
  setOff(id: string) {
    if (id === this.watched) this.held = false;
  }

  /**
   * A shot from one end to the other(s), starting now (`clock`, in seconds). Unless the view already has every end
   * of it in SHOT_BOX (`goal` and `dist`: where the camera is going, and from how far), it is framed until the
   * function returned is called (it has landed) and SHOT_LINGER after. Several shots at once are framed together.
   */
  shoot(ends: () => ShotEnd[], clock: number, goal: THREE.Vector3, dist: number, lens: Lens): () => void {
    if (this.shots.size === 0) {
      const now = ends();
      if (now.length < 2) return () => {};
      placeEye(this.eye, goal, dist, lens);
      if (allInView(this.eye, now, lens.box)) return () => {};
      this.before = goal.clone();
    }
    const shot: Shot = { ends, until: clock + SHOT_MAX };
    this.shots.add(shot);
    let landed = false;
    return () => {
      if (landed) return;
      landed = true;
      // Framed a little longer, counted from the last frame drawn (it lands between frames).
      shot.until = Math.min(shot.until, Math.max(clock, this.clock) + SHOT_LINGER);
    };
  }

  /**
   * Where the camera should look this frame, and from how far, while shots are being framed (null when none are).
   * As the last of them is done, once, where the camera was going before they took it, from `near` (the player's
   * own zoom): whoever is being followed takes it from there.
   */
  aim(clock: number, lens: Lens, near: number, far: number): { at: THREE.Vector3; dist: number } | null {
    this.clock = clock;
    if (this.shots.size === 0) return null;
    for (const shot of this.shots) if (clock >= shot.until) this.shots.delete(shot);
    if (this.shots.size === 0) {
      const back = this.before;
      this.before = null;
      return back ? { at: back, dist: near } : null;
    }
    const ends = [...this.shots].flatMap((s) => s.ends());
    if (ends.length === 0) return null;
    return frameEnds(ends, lens, near, far, this.eye);
  }
}
