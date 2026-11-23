// Flotsam bobbing in the Harbor's water (packages/world/src/flotsam.ts): driftwood, ship's crates, bottles with a note
// inside, and odds and ends. Every piece rides low in the water, bobbing and turning slowly on the swell, now and then
// leaving a ring, and catches the light: a glint over it twinkles every so often, by day or night, so a piece can be
// spotted from across the water. Pieces fade in as a tide brings them and out as one is taken or the tide takes it
// back. Decoration only: where they are and what they are comes from the rules, and nothing here changes them.

import * as THREE from "three";
import type { HexPos } from "@gantt-quest/core";
import type { FlotsamKind, JunkDef } from "@gantt-quest/world";
import { addWaterRipple } from "./water";
import { hexToWorld } from "./places/placing";

/** What the renderer is told of a piece. */
export interface FlotsamMark {
  id: string;
  pos: HexPos;
  kind: FlotsamKind;
  /** For junk: how it looks. */
  look?: JunkDef["look"];
}

/** Just under the water's surface, so a piece sits in it (a water hex's top is drawn at 0.14). */
const WATER_Y = 0.12;
/** Seconds to fade a piece in or out. */
const FADE_S = 1.2;
/** How high over a piece its glint hangs, and how big it is at its brightest, in pixels. */
const GLINT_Y = 0.32;
const GLINT_PX = 30;

interface Piece {
  id: string;
  root: THREE.Group;
  glint: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  yaw: number;
  phase: number;
  shown: number;
  going: boolean;
  nextRipple: number;
  /** Seconds to the next twinkle, and how far into the one under way. */
  nextTwinkle: number;
  twinkle: number;
}

/** A four-pointed star of light, soft at the middle: drawn once, shared by every glint. */
let starTexture: THREE.Texture | null = null;
function star(): THREE.Texture {
  if (starTexture) return starTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 18);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.35, "rgba(255,248,210,0.55)");
  glow.addColorStop(1, "rgba(255,240,200,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  // The points of the star: thin bright rays across and up and down.
  for (const [w, h] of [[60, 3], [3, 60]]) {
    const ray = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    ray.addColorStop(0, "rgba(255,255,255,0.95)");
    ray.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = ray;
    g.fillRect(32 - w / 2, 32 - h / 2, w, h);
  }
  return (starTexture = new THREE.CanvasTexture(c));
}

function glintPoint(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, GLINT_Y, 0]), 3));
  const material = new THREE.PointsMaterial({ map: star(), size: GLINT_PX, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const p = new THREE.Points(geometry, material);
  p.frustumCulled = false;
  p.renderOrder = 3;
  return p;
}

const rand = (a: number, b: number) => a + (b - a) * Math.random();
const lambert = (color: string, opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

/** One mesh of a model, placed and turned. */
function part(geometry: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

/** A piece's model, lying along +x, its middle at the origin and its bottom at y = 0. */
function model(mark: FlotsamMark): THREE.Group {
  const g = new THREE.Group();
  const add = (...m: THREE.Object3D[]) => g.add(...m);
  if (mark.kind === "driftwood") {
    // Sea-silvered: a bent log with a broken-off branch.
    const wood = lambert("#a99d8a");
    add(part(new THREE.CylinderGeometry(0.07, 0.085, 0.8, 7), wood, [0, 0.07, 0], [0, 0, Math.PI / 2 + 0.06]));
    add(part(new THREE.CylinderGeometry(0.03, 0.045, 0.28, 6), wood, [0.12, 0.13, 0.08], [0.9, 0.4, 0.5]));
    add(part(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 7), lambert("#cfc4ae"), [0.4, 0.07, 0], [0, 0, Math.PI / 2]));
  } else if (mark.kind === "crate") {
    // Planks and two bands, a stencil of a ship's mark on the side.
    const wood = lambert("#9a7444");
    const band = lambert("#5b4128");
    add(part(new THREE.BoxGeometry(0.36, 0.3, 0.3), wood, [0, 0.15, 0]));
    for (const x of [-0.12, 0.12]) add(part(new THREE.BoxGeometry(0.03, 0.31, 0.31), band, [x, 0.15, 0]));
    add(part(new THREE.BoxGeometry(0.1, 0.06, 0.005), lambert("#2e2418"), [0, 0.17, 0.152]));
  } else if (mark.kind === "bottle") {
    // Green glass lying on its side, a cork in it and a rolled note showing through.
    const glass = lambert("#4f9a6a", { transparent: true, opacity: 0.7 });
    add(part(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 10), glass, [0, 0.055, 0], [0, 0, Math.PI / 2]));
    add(part(new THREE.CylinderGeometry(0.022, 0.05, 0.07, 10), glass, [0.13, 0.055, 0], [0, 0, -Math.PI / 2]));
    add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), lambert("#b08a5a"), [0.18, 0.055, 0], [0, 0, Math.PI / 2]));
    add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), lambert("#efe6cf"), [-0.01, 0.05, 0], [0, 0, Math.PI / 2]));
  } else {
    junk(g, mark.look ?? "boot");
  }
  return g;
}

function junk(g: THREE.Group, look: NonNullable<FlotsamMark["look"]>) {
  const add = (...m: THREE.Object3D[]) => g.add(...m);
  if (look === "boot") {
    const leather = lambert("#4a3424");
    add(part(new THREE.BoxGeometry(0.1, 0.22, 0.1), leather, [-0.05, 0.11, 0]), part(new THREE.BoxGeometry(0.22, 0.08, 0.1), leather, [0.04, 0.04, 0]));
  } else if (look === "lantern") {
    const iron = lambert("#6b5a4c");
    add(part(new THREE.BoxGeometry(0.14, 0.18, 0.14), iron, [0, 0.09, 0]), part(new THREE.ConeGeometry(0.1, 0.07, 4), iron, [0, 0.215, 0], [0, Math.PI / 4, 0]), part(new THREE.TorusGeometry(0.04, 0.008, 4, 10), iron, [0, 0.27, 0]));
  } else if (look === "oar") {
    const wood = lambert("#b48a58");
    add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), wood, [-0.1, 0.03, 0], [0, 0, Math.PI / 2]), part(new THREE.BoxGeometry(0.22, 0.02, 0.1), wood, [0.25, 0.03, 0]));
  } else if (look === "kettle") {
    const copper = lambert("#b8733e");
    const body = part(new THREE.SphereGeometry(0.1, 10, 7), copper, [0, 0.08, 0]);
    body.scale.set(1, 0.8, 1);
    add(body, part(new THREE.CylinderGeometry(0.012, 0.02, 0.12, 6), copper, [0.1, 0.11, 0], [0, 0, -0.9]), part(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), copper, [0, 0.15, 0]));
  } else if (look === "bones") {
    const bone = lambert("#e6e0cc");
    add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 5), bone, [0, 0.02, 0], [0, 0, Math.PI / 2]));
    for (let i = 0; i < 5; i++) add(part(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 4), bone, [-0.1 + i * 0.05, 0.02, 0], [Math.PI / 2, 0, 0]));
    add(part(new THREE.ConeGeometry(0.04, 0.09, 5), bone, [0.21, 0.03, 0], [0, 0, -Math.PI / 2]));
  } else if (look === "weed") {
    const weed = lambert("#3f6b33");
    for (let i = 0; i < 5; i++) {
      const blob = part(new THREE.SphereGeometry(0.06, 6, 4), weed, [rand(-0.12, 0.12), 0.03, rand(-0.1, 0.1)]);
      blob.scale.set(1.4, 0.4, 1);
      add(blob);
    }
  } else if (look === "rope") {
    const rope = lambert("#b59a6a");
    for (let i = 0; i < 3; i++) add(part(new THREE.TorusGeometry(0.1 - i * 0.025, 0.015, 5, 14), rope, [0, 0.015 + i * 0.02, 0], [Math.PI / 2, 0, 0]));
  } else {
    const iron = lambert("#8c8f94");
    add(part(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5), iron, [-0.04, 0.02, 0], [0, 0, Math.PI / 2 - 0.4]));
    const bowl = part(new THREE.SphereGeometry(0.04, 8, 5), iron, [0.08, 0.05, 0]);
    bowl.scale.set(1.3, 0.4, 1);
    add(bowl);
  }
}

export class FlotsamMarks {
  readonly group = new THREE.Group();
  private pieces = new Map<string, Piece>();

  /** The pieces bobbing there now. New ones fade in; any no longer there fade out. */
  set(marks: FlotsamMark[]): void {
    const keep = new Set(marks.map((m) => m.id));
    for (const p of this.pieces.values()) if (!keep.has(p.id)) p.going = true;
    for (const m of marks) {
      const have = this.pieces.get(m.id);
      if (have) have.going = false;
      else this.pieces.set(m.id, this.make(m));
    }
  }

  private make(m: FlotsamMark): Piece {
    const root = model(m);
    const { x, z } = hexToWorld(m.pos);
    // Not dead in the middle of the hex: a little off to one side, as the water left it.
    root.position.set(x + rand(-0.3, 0.3), WATER_Y, z + rand(-0.3, 0.3));
    const yaw = rand(0, Math.PI * 2);
    root.rotation.y = yaw;
    root.scale.setScalar(0.001);
    // The glint rides with the piece but is not turned or shrunk with it: a sibling, kept over it.
    const glint = glintPoint();
    this.group.add(root, glint);
    return { id: m.id, root, glint, yaw, phase: rand(0, Math.PI * 2), shown: 0, going: false, nextRipple: rand(1, 4), nextTwinkle: rand(0.2, 1.5), twinkle: -1 };
  }

  /** Once a frame. `fancy`: fancy graphics are on, and a piece leaves rings on the water. */
  update(dt: number, clock: number, fancy: boolean): void {
    for (const p of this.pieces.values()) {
      p.shown = Math.max(0, Math.min(1, p.shown + (p.going ? -dt : dt) / FADE_S));
      if (p.going && p.shown <= 0) {
        this.group.remove(p.root, p.glint);
        dispose(p.root);
        p.glint.geometry.dispose();
        p.glint.material.dispose();
        this.pieces.delete(p.id);
        continue;
      }
      p.root.scale.setScalar(Math.max(0.001, p.shown));
      // On the swell: up and down, rocking, and turning slowly as it drifts.
      const t = clock + p.phase;
      p.root.position.y = WATER_Y + Math.sin(t * 1.3) * 0.03;
      p.root.rotation.set(Math.sin(t * 0.9) * 0.12, p.yaw + Math.sin(t * 0.15) * 0.6, Math.sin(t * 1.1) * 0.1);
      if (fancy && (p.nextRipple -= dt) <= 0) {
        p.nextRipple = rand(2.5, 6);
        addWaterRipple(p.root.position.x, p.root.position.z);
      }
      // The glint: a soft shimmer always, and every second or two a quick bright twinkle as it turns to the light.
      p.glint.position.set(p.root.position.x, p.root.position.y, p.root.position.z);
      if (p.twinkle < 0 && (p.nextTwinkle -= dt) <= 0) p.twinkle = 0;
      let flash = 0;
      if (p.twinkle >= 0) {
        p.twinkle += dt / 0.45;
        flash = Math.sin(Math.min(1, p.twinkle) * Math.PI);
        if (p.twinkle >= 1) (p.twinkle = -1), (p.nextTwinkle = rand(0.8, 2.2));
      }
      const shimmer = 0.25 + 0.12 * Math.sin(t * 3.1);
      p.glint.material.opacity = p.shown * Math.min(1, shimmer + flash);
      p.glint.material.size = GLINT_PX * (0.45 + 0.55 * flash);
    }
  }

  dispose(): void {
    for (const p of this.pieces.values()) {
      dispose(p.root);
      p.glint.geometry.dispose();
      p.glint.material.dispose();
    }
    this.pieces.clear();
    this.group.clear();
  }
}

function dispose(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
