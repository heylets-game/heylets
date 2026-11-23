// The crew's fishing holes on the water (packages/world/src/fishingholes.ts): where the fish are right now.
//
// Not a marker: the fish themselves, as dark shapes just under the surface, nosing about, stopping, turning and
// moving on, the way a fish's shadow shows from a pier. A shoal is a few small ones together; a deep hole one or two
// big ones; storm water big ones moving fast. Night feeders are harder to see, with a faint light at the nose of
// one of them. Now and then one touches the surface and leaves a ring. A hole that moves on fades out where it was
// and in where it now is. Decoration only: where the holes are comes from the rules, and nothing here changes them.

import * as THREE from "three";
import type { HexPos } from "@gantt-quest/core";
import type { HoleKind } from "@gantt-quest/world";
import { addWaterRipple } from "./water";
import { hexToWorld } from "./places/placing";

/** What the renderer is told of a hole. */
export interface HoleMark {
  id: string;
  pos: HexPos;
  kind: HoleKind;
}

/** Just over the water's surface (a water hex's top is drawn at 0.14: WorldRenderer's tileTop). */
const SURFACE_Y = 0.155;
/** How far from the hole's middle a fish wanders, in world units (a hex is about 1.7 across). */
const ROAM = 0.55;
/** Seconds to fade a hole in or out. */
const FADE_S = 2.5;

/** Each kind: how many fish, how big, how fast they swim, how dark they show (by day). */
const LOOK: Record<HoleKind, { count: number; size: [number, number]; speed: number; shade: number }> = {
  shoal: { count: 3, size: [0.4, 0.5], speed: 0.32, shade: 0.45 },
  deep: { count: 2, size: [0.7, 0.85], speed: 0.2, shade: 0.5 },
  night: { count: 2, size: [0.6, 0.7], speed: 0.18, shade: 0.45 },
  storm: { count: 2, size: [0.8, 0.95], speed: 0.45, shade: 0.55 },
};

interface Swimmer {
  mesh: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  x: number;
  z: number;
  yaw: number;
  /** Where it is heading, and how long it rests once there. */
  toX: number;
  toZ: number;
  rest: number;
  speed: number;
  wiggle: number;
}

interface Hole {
  id: string;
  kind: HoleKind;
  root: THREE.Group;
  fish: Swimmer[];
  /** A faint light at the nose of the first fish of night feeders. */
  lure: THREE.Points | null;
  shown: number;
  going: boolean;
  nextRipple: number;
}

/** A fish seen from above, nose toward +x, one unit long: a tapering body and a forked tail. */
const fishShape = (() => {
  const s = new THREE.Shape();
  s.moveTo(0.5, 0);
  s.bezierCurveTo(0.45, 0.13, 0.15, 0.17, -0.12, 0.11);
  s.lineTo(-0.3, 0.04);
  s.lineTo(-0.5, 0.14);
  s.lineTo(-0.44, 0);
  s.lineTo(-0.5, -0.14);
  s.lineTo(-0.3, -0.04);
  s.lineTo(-0.12, -0.11);
  s.bezierCurveTo(0.15, -0.17, 0.45, -0.13, 0.5, 0);
  return new THREE.ShapeGeometry(s, 8).rotateX(-Math.PI / 2);
})();

const rand = (a: number, b: number) => a + (b - a) * Math.random();

function lurePoint(): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  const material = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: "#ffe48a", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const p = new THREE.Points(geometry, material);
  p.frustumCulled = false;
  return p;
}

export class FishingHoleMarks {
  readonly group = new THREE.Group();
  private holes = new Map<string, Hole>();

  /** The holes there are now. New ones fade in; any no longer there fade out. */
  set(marks: HoleMark[]): void {
    const keep = new Set(marks.map((m) => m.id));
    for (const h of this.holes.values()) if (!keep.has(h.id)) h.going = true;
    for (const m of marks) {
      const have = this.holes.get(m.id);
      if (have) have.going = false;
      else this.holes.set(m.id, this.make(m));
    }
  }

  private make(m: HoleMark): Hole {
    const root = new THREE.Group();
    const { x, z } = hexToWorld(m.pos);
    root.position.set(x, SURFACE_Y, z);
    const look = LOOK[m.kind];
    const fish = Array.from({ length: look.count }, (): Swimmer => {
      const mat = new THREE.MeshBasicMaterial({ color: "#06121a", transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(fishShape, mat);
      mesh.renderOrder = 2;
      mesh.scale.setScalar(rand(look.size[0], look.size[1]));
      root.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * ROAM;
      return { mesh, x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: Math.random() * Math.PI * 2, toX: 0, toZ: 0, rest: rand(0, 2), speed: look.speed * rand(0.8, 1.2), wiggle: Math.random() * 6 };
    });
    // A shoal keeps together: its fish start near one another.
    if (m.kind === "shoal") for (const f of fish.slice(1)) (f.x = fish[0].x + rand(-0.25, 0.25), f.z = fish[0].z + rand(-0.25, 0.25));
    const lure = m.kind === "night" ? lurePoint() : null;
    if (lure) root.add(lure);
    this.group.add(root);
    return { id: m.id, kind: m.kind, root, fish, lure, shown: 0, going: false, nextRipple: rand(2, 6) };
  }

  /**
   * Once a frame.
   * @param night how dark it is, 0 to 1: the shapes are harder to make out
   * @param storm how much of a storm it is, 0 to 1: the water is rougher and they show a little less
   * @param fancy fancy graphics are on: a fish touching the surface leaves a ring on the water
   */
  update(dt: number, clock: number, night: number, storm: number, fancy: boolean): void {
    for (const h of [...this.holes.values()]) {
      h.shown = Math.max(0, Math.min(1, h.shown + (h.going ? -dt : dt) / FADE_S));
      if (h.going && h.shown === 0) {
        this.drop(h);
        continue;
      }
      const look = LOOK[h.kind];
      const seen = h.shown * h.shown * (3 - 2 * h.shown);
      const shade = seen * look.shade * (1 - 0.45 * night) * (1 - 0.3 * storm);
      const lead = h.fish[0];
      h.fish.forEach((f, i) => {
        if (f.rest > 0) {
          // Resting: hanging in the water, barely moving, then off somewhere else.
          f.rest -= dt;
          if (f.rest <= 0) {
            // A shoal follows its first fish; the rest go where they like.
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * ROAM;
            const follow = h.kind === "shoal" && i > 0;
            f.toX = follow ? lead.toX + rand(-0.3, 0.3) : Math.cos(a) * r;
            f.toZ = follow ? lead.toZ + rand(-0.3, 0.3) : Math.sin(a) * r;
          }
        } else {
          const dx = f.toX - f.x;
          const dz = f.toZ - f.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.04) f.rest = h.kind === "storm" ? rand(0.3, 1.2) : rand(1.2, 4);
          else {
            // Turn toward where it is going, then swim on, slowing as it arrives.
            const want = Math.atan2(-dz, dx);
            let turn = want - f.yaw;
            turn = Math.atan2(Math.sin(turn), Math.cos(turn));
            f.yaw += turn * Math.min(1, dt * 3);
            const go = Math.min(d, f.speed * dt * Math.min(1, d / 0.25 + 0.3) * Math.max(0.2, Math.cos(turn)));
            f.x += Math.cos(f.yaw) * go;
            f.z -= Math.sin(f.yaw) * go;
          }
        }
        const swimming = f.rest > 0 ? 0.25 : 1;
        f.wiggle += dt * (4 + 6 * swimming);
        f.mesh.position.set(f.x, 0, f.z);
        f.mesh.rotation.y = f.yaw + Math.sin(f.wiggle) * 0.12 * swimming;
        f.mesh.material.opacity = shade;
      });
      if (h.lure) {
        const nose = new THREE.Vector3(0.5 * lead.mesh.scale.x, 0.02, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, lead.yaw);
        (h.lure.geometry.getAttribute("position") as THREE.BufferAttribute).setXYZ(0, lead.x + nose.x, nose.y, lead.z + nose.z).needsUpdate = true;
        (h.lure.material as THREE.PointsMaterial).opacity = seen * night * (0.55 + 0.45 * Math.sin(clock * 2.3) ** 2);
      }
      // Now and then one touches the surface.
      h.nextRipple -= dt;
      if (h.nextRipple <= 0) {
        h.nextRipple = h.kind === "storm" ? rand(2, 4) : rand(4, 9);
        const f = h.fish[Math.floor(Math.random() * h.fish.length)];
        if (fancy && seen > 0.5) addWaterRipple(h.root.position.x + f.x, h.root.position.z + f.z);
      }
    }
  }

  private drop(h: Hole): void {
    this.group.remove(h.root);
    for (const f of h.fish) f.mesh.material.dispose();
    if (h.lure) (h.lure.geometry.dispose(), (h.lure.material as THREE.Material).dispose());
    this.holes.delete(h.id);
  }

  dispose(): void {
    for (const h of [...this.holes.values()]) this.drop(h);
  }
}
