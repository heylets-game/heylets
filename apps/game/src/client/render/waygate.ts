// The old waygate's ring: the pieces the Harbor's fountain is built from.
//
// The gate was the crew's way out to the atlas until they had a ship: a lens
// of light hung in the air inside the three broken rings of a navigator's
// armillary, one of old stone cut with signs that burned cold, two of brass.
// The gate is gone (the crew sails now, and a map is reached by longboat),
// but its ring stands mended in the square as a fountain (fountain.ts), and
// this file keeps what that is made of: the rings' measures, a piece of a
// broken ring with its signs, and the soft round of light it threw.

import * as THREE from "three";

export interface RingDef {
  /** How far out, how thick across, and how deep along its axis. */
  r: number;
  thick: number;
  deep: number;
  /** Each piece's sweep, in degrees: what is missing between them is as much the look of it as what is left. */
  arcs: number[];
  /** How fast it turns in its own plane, radians a second. */
  spin: number;
  metal: boolean;
  /** How its plane lies at a moment: turned about the upright (y), then tipped (x), then rolled (z). */
  lie(t: number): [x: number, y: number, z: number];
}
/** The gate's three rings, the stone one first. (The Harbor's fountain is built on the same shapes: fountain.ts.) */
export const RINGS: RingDef[] = [
  // The gate itself: old stone, upright, leaning back a little as if it looked at the sky, rocking slowly.
  { r: 1.3, thick: 0.27, deep: 0.2, arcs: [52, 32, 60, 38, 30], spin: 0.09, metal: false, lie: (t) => [-0.26 + Math.sin(t * 0.31) * 0.06, Math.sin(t * 0.23) * 0.26, 0] },
  // A band of brass tipped nearly flat, wheeling round the upright.
  { r: 1.07, thick: 0.05, deep: 0.15, arcs: [104, 62, 80], spin: -0.21, metal: true, lie: (t) => [1.12 + Math.sin(t * 0.19) * 0.12, t * 0.17, 0.2] },
  // And a thin hoop inside both, tumbling the other way.
  { r: 0.9, thick: 0.045, deep: 0.045, arcs: [142, 94], spin: 0.36, metal: true, lie: (t) => [-0.78 + Math.sin(t * 0.27) * 0.2, 1 - t * 0.26, 0.6] },
];

/** A fixed 0..1 value for a pair of numbers: the same gate every time. */
const hash = (a: number, b: number, salt: number) => {
  const n = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

/** Several shapes' triangles as one, faceted. */
export function mergedFacets(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of parts) {
    const flat = g.index ? g.toNonIndexed() : g;
    const at = flat.getAttribute("position");
    for (let i = 0; i < at.count; i++) pos.push(at.getX(i), at.getY(i), at.getZ(i));
    if (flat !== g) flat.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/**
 * A piece of a broken ring: an arc from `a0` to `a1` in the plane of x and y, its ends snapped off askew, made
 * about its own middle (`at`) so it can bob and tilt where it hangs. `signs`: marks cut into both its faces.
 */
export function arcPiece(def: RingDef, a0: number, a1: number, seed: number): { body: THREE.BufferGeometry; signs: THREE.BufferGeometry | null; at: THREE.Vector2 } {
  const n = (k: number) => hash(seed, k, 14);
  const { r, thick, deep } = def;
  const [r0, r1] = [r - thick / 2, r + thick / 2];
  const mid = (a0 + a1) / 2;
  const at = new THREE.Vector2(Math.cos(mid) * r, Math.sin(mid) * r);
  // The breaks: each end is cut on a slant, so no two pieces would fit back together. (Metal snaps cleaner than stone.)
  const slant = def.metal ? 0.05 : 0.16;
  const [b0, b1] = [(n(1) - 0.5) * slant, (n(2) - 0.5) * slant];
  const steps = Math.max(2, Math.round((a1 - a0) / 0.2));
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const a = a0 - b0 + ((a1 + b1 - (a0 - b0)) * i) / steps;
    const rr = r1 * (1 + (def.metal ? 0 : (n(10 + i) - 0.5) * 0.03));
    if (i === 0) shape.moveTo(Math.cos(a) * rr - at.x, Math.sin(a) * rr - at.y);
    else shape.lineTo(Math.cos(a) * rr - at.x, Math.sin(a) * rr - at.y);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + b0 + ((a1 - b1 - (a0 + b0)) * i) / steps;
    shape.lineTo(Math.cos(a) * r0 - at.x, Math.sin(a) * r0 - at.y);
  }
  const body = mergedFacets([new THREE.ExtrudeGeometry(shape, { depth: deep, bevelEnabled: false }).translate(0, 0, -deep / 2)]);
  const marks: THREE.BufferGeometry[] = [];
  const put = (w: number, h: number, a: number, out: number, turn: number, face: number) => {
    const g = new THREE.BoxGeometry(w, h, 0.012);
    g.rotateZ(a - Math.PI / 2 + turn);
    g.translate(Math.cos(a) * (r + out) - at.x, Math.sin(a) * (r + out) - at.y, face * (deep / 2 + 0.005));
    marks.push(g);
  };
  if (def.metal) {
    // A band of brass is marked off in degrees along its edge: every few, a tick that holds the gate's light.
    if (deep > 0.1) {
      const count = Math.max(2, Math.round((a1 - a0) / 0.2));
      for (let i = 0; i < count; i++) {
        const a = a0 + ((i + 0.5) / count) * (a1 - a0);
        const g = new THREE.BoxGeometry(0.012, 0.02, deep * (i % 3 === 0 ? 0.8 : 0.4));
        g.rotateZ(a - Math.PI / 2);
        g.translate(Math.cos(a) * (r1 + 0.004) - at.x, Math.sin(a) * (r1 + 0.004) - at.y, 0);
        marks.push(g);
      }
    }
  } else {
    const count = Math.max(1, Math.round((a1 - a0) / 0.32));
    for (let i = 0; i < count; i++) {
      const a = a0 + ((i + 0.5) / count) * (a1 - a0);
      const kind = Math.floor(n(30 + i) * 3.99);
      for (const face of [-1, 1]) {
        if (kind === 0) {
          put(thick * 0.2, thick * 0.62, a, 0, 0, face);
          put(thick * 0.56, thick * 0.16, a, thick * 0.14, 0, face);
        } else if (kind === 1) put(thick * 0.4, thick * 0.4, a, 0, Math.PI / 4, face);
        else if (kind === 2) {
          put(thick * 0.18, thick * 0.66, a, 0, 0.5, face);
          put(thick * 0.18, thick * 0.66, a, 0, -0.5, face);
        } else {
          put(thick * 0.6, thick * 0.14, a, -thick * 0.18, 0, face);
          put(thick * 0.6, thick * 0.14, a, thick * 0.18, 0, face);
          put(thick * 0.14, thick * 0.5, a, 0, 0, face);
        }
      }
    }
  }
  return { body, signs: marks.length > 0 ? mergedFacets(marks) : null, at };
}

let haloDot: THREE.CanvasTexture | null = null;
/** A soft round of light, for the glow at a gate's heart and the pool it throws on the ground. Made once and shared. */
export function haloTexture(): THREE.CanvasTexture {
  if (haloDot) return haloDot;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.52)");
  g.addColorStop(0.5, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  haloDot = new THREE.CanvasTexture(canvas);
  haloDot.colorSpace = THREE.SRGBColorSpace;
  return haloDot;
}
