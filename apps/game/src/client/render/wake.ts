// A boat's wake, drawn the way a cartoon sea draws one: bold bands of flat white foam with hard edges, no
// specks and no soft glow, a little see-through so it sits on the water rather than over it. As a boat moves it lays a trail of points behind its stern. From them three bands
// are drawn: one churned stripe straight behind the boat, short-lived and scalloped, and two arms that start at
// either side of the stern and drift outward as they age, so they open behind the boat in a V. Nothing fades:
// each band narrows to nothing as it ages and so ends in a point, and the arms break into dashes toward their
// tails. The foam is flat colour, not lit (lit, it came out darker than the water's own shading); it is
// dimmed toward a moonlit grey by night instead (`setNight`).

import * as THREE from "three";

/** How long a point of the trail lasts, in seconds: the arms' length. */
const LIFE = 1.8;
/** The stripe straight behind the boat lasts this share of that. */
const WASH_LIFE = 0.45;
/** How far a boat moves between points of its trail, in world units (a hex is about 1.7 across). */
export const WAKE_STEP = 0.14;
/** How fast the arms drift out to either side, world units a second (for a rowboat; scaled by `size`). */
const SPREAD = 0.45;
/** How wide an arm is when laid, and the stripe behind the boat. */
const ARM_WIDTH = 0.13;
const WASH_WIDTH = 0.32;
/** Most points any one trail keeps. */
const MAX_POINTS = 64;

const FOAM = new THREE.Color("#f2fbff");
/** The foam at the dead of night: still the brightest thing on the water, but no lamp. */
const NIGHT_FOAM = new THREE.Color("#8fa3c4");

interface Point {
  x: number;
  z: number;
  /** The boat's heading when it was laid: 0 toward +z. */
  yaw: number;
  born: number;
  /** Counts up along the trail, for the scallops and the dashes. */
  n: number;
}

interface Trail {
  points: Point[];
  size: number;
  top: number;
  count: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** A band's half-width, for a point aged `t` (0 new, 1 gone): full for a moment, then narrowing to nothing. */
const taper = (t: number) => (t >= 1 ? 0 : Math.min(1, t * 14) * Math.pow(1 - t, 0.4));

export class BoatWake {
  readonly group = new THREE.Group();
  private trails = new Map<string, Trail>();
  private material = new THREE.MeshBasicMaterial({ color: FOAM.clone(), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  /** How far into the night it is, 0 (day) to 1. */
  setNight(night: number) {
    this.material.color.copy(FOAM).lerp(NIGHT_FOAM, night);
  }

  /**
   * The boat `id` has moved on: a point of its trail laid at its stern `x, z` on water whose top is `top`, the boat
   * heading `yaw`. `size` is 1 for a rowboat; a barrel churns less.
   */
  lay(id: string, x: number, top: number, z: number, yaw: number, size: number, now: number) {
    let trail = this.trails.get(id);
    if (!trail) {
      const geometry = new THREE.BufferGeometry();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      trail = { points: [], size, top, count: 0, mesh };
      this.trails.set(id, trail);
    }
    trail.size = size;
    trail.top = top;
    trail.points.push({ x, z, yaw, born: now, n: trail.count++ });
    if (trail.points.length > MAX_POINTS) trail.points.shift();
  }

  /** Age every trail to `now` and draw it again; a trail whose points have all gone is put away. */
  update(now: number) {
    for (const [id, trail] of this.trails) {
      while (trail.points.length && now - trail.points[0].born > LIFE) trail.points.shift();
      if (trail.points.length < 2) {
        if (now - (trail.points[0]?.born ?? -Infinity) > LIFE) {
          this.group.remove(trail.mesh);
          trail.mesh.geometry.dispose();
          this.trails.delete(id);
        } else trail.mesh.visible = false;
        continue;
      }
      trail.mesh.visible = true;
      this.draw(trail, now);
    }
  }

  private draw(trail: Trail, now: number) {
    const { points, size } = trail;
    const y = trail.top + 0.03;
    const pos: number[] = [];
    const index: number[] = [];
    // One band: a strip of quads along the trail, each point's two edge vertices `half` either side of `mid`.
    const band = (edge: (p: Point, t: number) => { mx: number; mz: number; half: number; rx: number; rz: number } | null) => {
      let prev = -1;
      for (const p of points) {
        const e = edge(p, (now - p.born) / LIFE);
        if (!e || e.half <= 0.004) {
          prev = -1;
          continue;
        }
        const v = pos.length / 3;
        pos.push(e.mx - e.rx * e.half, y, e.mz - e.rz * e.half, e.mx + e.rx * e.half, y, e.mz + e.rz * e.half);
        if (prev >= 0) index.push(prev, prev + 1, v, prev + 1, v + 1, v);
        prev = v;
      }
    };
    // The two arms, drifting outward to either side of where they were laid, breaking into dashes as they age.
    for (const side of [-1, 1]) {
      band((p, t) => {
        if (t > 0.3 && Math.sin(p.n * 0.9 + side) < (t - 0.3) * 2 - 0.45) return null;
        const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        const out = (0.16 + SPREAD * t * LIFE) * size * side;
        return { mx: p.x + rx * out, mz: p.z + rz * out, half: (ARM_WIDTH / 2) * size * taper(t) * (1 + 0.6 * t) * (1 + 0.2 * Math.sin(p.n * 1.9 + side)), rx, rz };
      });
    }
    // The churned stripe straight behind the boat: wide and scalloped, gone quickly.
    band((p, t) => {
      const w = t / WASH_LIFE;
      if (w >= 1) return null;
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const scallop = 1 + 0.22 * Math.sin(p.n * 2.3);
      return { mx: p.x, mz: p.z, half: (WASH_WIDTH / 2) * size * taper(w) * scallop, rx, rz };
    });
    const geometry = trail.mesh.geometry;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setIndex(index);
  }

  /** Every trail off the water at once (a new place is being drawn). */
  clear() {
    for (const trail of this.trails.values()) {
      this.group.remove(trail.mesh);
      trail.mesh.geometry.dispose();
    }
    this.trails.clear();
  }
}
