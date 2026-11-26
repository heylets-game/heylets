// Cracks in the ground (a Guardian's Earthquake): jagged lines running out from a point, forking as they go, each
// widest where it starts and narrowing to nothing, laid flat on the ground as thin ribbons. The move's own animation
// (signatureMoves.ts) draws them spreading out from its feet; the map (TacticsLayer) keeps a few on each hex of the
// cracked ground until it heaves.

import * as THREE from "three";

/** One crack: the points it runs through on the ground (x, z), from where it starts, and how wide it is there. */
export interface Crack {
  pts: { x: number; z: number }[];
  width: number;
}

export interface CrackOpts {
  /** How many run out from the middle. */
  count: number;
  /** How far out they run, in world units (each a little more or less). */
  reach: number;
  /** How wide each is where it starts. */
  width: number;
  /** How far each step of one goes: shorter is more jagged. */
  step?: number;
  /** How much each step may turn, in radians. */
  wander?: number;
  /** The chance at each step that it forks. */
  fork?: number;
  /** How far out from the middle they start. */
  start?: number;
}

/** Cracks running out from (0, 0), at random (`rand`: 0 to 1, Math.random if none). */
export function crackPaths(o: CrackOpts, rand: () => number = Math.random): Crack[] {
  const step = o.step ?? 0.22;
  const wander = o.wander ?? 0.45;
  const fork = o.fork ?? 0.12;
  const out: Crack[] = [];
  const run = (x: number, z: number, a: number, length: number, width: number, forks: number) => {
    const pts = [{ x, z }];
    let gone = 0;
    while (gone < length) {
      a += (rand() - 0.5) * 2 * wander;
      const d = step * (0.6 + rand() * 0.8);
      x += Math.cos(a) * d;
      z += Math.sin(a) * d;
      gone += d;
      pts.push({ x, z });
      if (forks > 0 && rand() < fork && length - gone > step * 2) {
        const side = rand() < 0.5 ? -1 : 1;
        run(x, z, a + side * (0.5 + rand() * 0.5), (length - gone) * (0.35 + rand() * 0.3), width * (1 - gone / length) * 0.7, forks - 1);
      }
    }
    out.push({ pts, width });
  };
  for (let i = 0; i < o.count; i++) {
    const a = (i / o.count) * Math.PI * 2 + (rand() - 0.5) * (Math.PI / o.count);
    const s = o.start ?? 0;
    run(Math.cos(a) * s, Math.sin(a) * s, a, o.reach * (0.75 + rand() * 0.35) - s, o.width * (0.7 + rand() * 0.5), 2);
  }
  return out;
}

/**
 * The cracks as flat ribbons on the ground (y = 0), each narrowing from its width to nothing at its end. `lift`:
 * a height for each point, over where it is (the map's ground rises and falls from hex to hex), 0 if none.
 */
export function crackGeometry(cracks: readonly Crack[], lift?: (x: number, z: number) => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (const c of cracks) {
    const n = c.pts.length;
    if (n < 2) continue;
    const first = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const p = c.pts[i];
      const q = c.pts[Math.min(n - 1, i + 1)];
      const r = c.pts[Math.max(0, i - 1)];
      // Across the line here: square to the way it runs.
      let dx = q.x - r.x;
      let dz = q.z - r.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const w = (c.width / 2) * (1 - i / (n - 1)) + 0.004;
      const y = lift?.(p.x, p.z) ?? 0;
      positions.push(p.x - dz * w, y, p.z + dx * w, p.x + dz * w, y, p.z - dx * w);
      if (i > 0) {
        const k = first + 2 * i;
        index.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/** What cracks are drawn in: near black, the dark of the deep ground. */
export const CRACK_DARK = "#1c140e";
/** The pale broken edge either side of a crack, drawn under it a little wider. */
export const CRACK_EDGE = "#b59a76";
