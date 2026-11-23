// A hut's herb garden, tended in the Harbor itself: the camera flies down over the beds by the hut's door and the
// garden's own model (places/garden.ts) is what you work on. Not a scene of its own: a minigame played in the
// Harbor's renderer (WorldRenderer.startMinigame), like the quarry's rock face.
//
// It draws only what tending adds to the garden: a glowing frame round the bed under the pointer and the one
// picked, and what each thing done looks like as it happens (a watering can's shower, a scatter of bonemeal,
// seed dropping into the furrows, herbs leaping up out of a picked bed with a burst of glints). The beds
// themselves grow in the place's model, which the Harbor redraws as the board says what grows. The view
// (Garden.tsx) asks where each bed is on the screen to hang its tag there.

import * as THREE from "three";
import { bedLayout, PATCH } from "./places/garden";
import type { WorldMinigame, WorldRenderer } from "./WorldRenderer";

const VFOV = 40;
/** Seconds to fly down to the beds, and back out. */
const IN_S = 1.3;
const OUT_S = 1.0;
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export type GardenEffect = "water" | "feed" | "plant" | "pick";

export interface GardenHooks {
  /** A bed was pressed (null: the press was off the beds). */
  onBed(bed: number | null): void;
}

/** A bit of something thrown about by an effect: it flies, falls, spins and fades. */
interface Bit {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  grav: number;
  age: number;
  life: number;
  spin: number;
  /** Where it stops falling (the earth of the bed). */
  floor: number;
  /** Its scale at full size; it shrinks to nothing over its last moments. */
  size: number;
  /** A delay before it shows. */
  wait: number;
}

/** A watering can tipped over a bed for a moment. */
interface Can {
  obj: THREE.Group;
  age: number;
  bed: number;
}

export class GardenStage implements WorldMinigame {
  /** Everything the stage adds, in the patch's own space (set each frame from where the garden's model stands). */
  private root = new THREE.Group();
  private inT = 0;
  private leaving = false;
  private disposed = false;
  private hits: THREE.Mesh[] = [];
  private frames: THREE.Group[] = [];
  private hovered: number | null = null;
  private picked: number | null = null;
  private bits: Bit[] = [];
  private cans: Can[] = [];
  private clock = 0;
  private count = 0;
  private raycaster = new THREE.Raycaster();
  /** The patch's space in the world, as last worked out. */
  private patch = new THREE.Matrix4();

  constructor(private world: WorldRenderer, private group: THREE.Group, private poiId: string, beds: number, private hooks: GardenHooks) {
    this.root.matrixAutoUpdate = false;
    this.group.add(this.root);
    this.setBeds(beds);
    // The grass round the garden is not drawn while it is tended up close: it would stand in front of the beds.
    if (this.place()) world.clearGrass(this.out(0, 0, 0.3));
  }

  /** How many beds the garden has (it grows with the hut). */
  setBeds(count: number) {
    if (count === this.count) return;
    this.count = count;
    for (const o of [...this.hits, ...this.frames]) {
      this.root.remove(o);
      o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    }
    this.hits = [];
    this.frames = [];
    const { bw, bd, cx } = bedLayout(count);
    const unseen = new THREE.MeshBasicMaterial({ visible: false });
    for (let i = 0; i < count; i++) {
      // What a press on the bed hits: the bed and the air over its plants.
      const hit = new THREE.Mesh(new THREE.BoxGeometry(bw + PATCH.gap * 0.9, 0.3, bd + 0.04), unseen);
      hit.position.set(cx(i), 0.15, 0);
      hit.userData.bed = i;
      this.root.add(hit);
      this.hits.push(hit);
      // A frame of light round the bed's edging, lit while it is pointed at or picked.
      const frame = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: "#ffe08a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const t = 0.014, w = bw + 0.03, d = bd + 0.03;
      // The long bars run the whole way across, corners and all; the end bars fit between them, so no corner is
      // lit twice over (the glow adds up where pieces overlap).
      for (const [x, z, sx, sz] of [[0, -d / 2, w + t, t], [0, d / 2, w + t, t], [-w / 2, 0, t, d - t], [w / 2, 0, t, d - t]] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.012, sz), mat);
        m.position.set(x, 0.09, z);
        m.raycast = () => {};
        frame.add(m);
      }
      frame.position.x = cx(i);
      frame.userData.mat = mat;
      this.root.add(frame);
      this.frames.push(frame);
    }
  }

  /** The bed whose actions are showing, lit brighter than the one only pointed at. */
  select(bed: number | null) {
    this.picked = bed;
  }

  // ---------- where things are ----------

  /** Work out where the patch stands in the world from the garden's model (redrawn as the beds grow). */
  private place(): boolean {
    const g = this.world.poiObject(this.poiId);
    if (!g) return false;
    g.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, false);
    this.patch.copy(g.matrixWorld).multiply(new THREE.Matrix4().makeRotationY(PATCH.turn));
    this.root.matrix.copy(this.group.matrixWorld).invert().multiply(this.patch);
    this.root.matrixWorldNeedsUpdate = true;
    return true;
  }

  /** A point in the patch's space, out in the world. */
  private out(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.patch);
  }

  /** Where a bed's tag hangs on the screen: over its plants. Null off screen, or before the camera has come down. */
  bedScreen(bed: number): { x: number; y: number } | null {
    if (this.inT < 0.85 || this.leaving || bed >= this.count) return null;
    const { cx } = bedLayout(this.count);
    const at = this.world.screenOfPoint(this.out(cx(bed), 0.27, -0.02));
    return at?.on ? at : null;
  }

  /** The camera has come all the way down. */
  get arrived(): boolean {
    return this.inT >= 1 && !this.leaving;
  }

  // ---------- the camera ----------

  frame(dt: number, _now: number, aspect: number): { eye: THREE.Vector3; look: THREE.Vector3; blend: number; fov: number } {
    this.clock += dt;
    this.inT = this.leaving ? Math.max(0, this.inT - dt / OUT_S) : Math.min(1, this.inT + dt / IN_S);
    if (this.leaving && this.inT <= 0) setTimeout(() => this.finish(), 0);
    this.place();
    this.animate(dt);
    // Far enough back to see every bed with room over them for their tags, whatever the shape of the window.
    const t = Math.tan(THREE.MathUtils.degToRad(VFOV / 2));
    const halfW = PATCH.w / 2 + 0.1;
    const halfH = 0.36;
    const dist = Math.max(halfH / t, halfW / (t * Math.max(0.3, aspect)));
    // From in front and well above, looking down into the beds: steep enough that nothing growing round the patch
    // stands between the eye and them.
    const dir = new THREE.Vector3(0.1, 1.05, 0.85).normalize();
    const look = this.out(0, 0.1, 0.02);
    const eye = this.out(dir.x * dist, 0.1 + dir.y * dist, 0.02 + dir.z * dist);
    return { eye, look, blend: smoother(this.inT), fov: VFOV };
  }

  // ---------- pointing and pressing ----------

  private bedAt(ndc: THREE.Vector2, camera: THREE.Camera): number | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects(this.hits, false)[0];
    return hit ? (hit.object.userData.bed as number) : null;
  }

  press(ndc: THREE.Vector2, camera: THREE.Camera) {
    if (this.inT < 0.6 || this.leaving) return;
    this.hooks.onBed(this.bedAt(ndc, camera));
  }

  hover(ndc: THREE.Vector2, camera: THREE.Camera) {
    this.hovered = this.inT < 0.6 ? null : this.bedAt(ndc, camera);
    this.world.setCursor(this.hovered === null ? "" : "pointer");
  }

  // ---------- what tending looks like ----------

  /** Play what was just done to a bed. */
  play(effect: GardenEffect, bed: number) {
    const { bw, bd, cx } = bedLayout(this.count);
    const x0 = cx(bed);
    const r = () => Math.random() - 0.5;
    const add = (geo: THREE.BufferGeometry, color: string, at: THREE.Vector3, vel: THREE.Vector3, o: Partial<Bit> & { glow?: boolean } = {}) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: !o.glow, blending: o.glow ? THREE.AdditiveBlending : THREE.NormalBlending }));
      mesh.position.copy(at);
      mesh.raycast = () => {};
      const size = o.size ?? 1;
      mesh.scale.setScalar(o.wait ? 0 : size);
      this.root.add(mesh);
      this.bits.push({ mesh, vel, grav: o.grav ?? 2.2, age: 0, life: o.life ?? 1, spin: o.spin ?? 0, floor: o.floor ?? PATCH.top + 0.005, size, wait: o.wait ?? 0 });
    };
    if (effect === "water") {
      // Held over the back of the bed, its rose over the middle, so the shower falls on the plants.
      const canX = x0 + bw * 0.35, canZ = -bd * 0.3;
      this.cans.push({ obj: this.makeCan(canX, canZ), age: 0, bed });
      for (let i = 0; i < 46; i++) {
        add(new THREE.BoxGeometry(0.006, 0.018, 0.006), i % 3 ? "#8fd0ff" : "#d6f0ff", new THREE.Vector3(canX - 0.085 + r() * 0.03, 0.27, canZ + r() * 0.03), new THREE.Vector3(-0.25 + r() * 0.3, -0.05, 0.12 + r() * 0.3), { wait: 0.25 + i * 0.022, life: 0.8, grav: 2.4 });
      }
    } else if (effect === "feed") {
      for (let i = 0; i < 34; i++) {
        add(new THREE.BoxGeometry(0.008, 0.008, 0.008), i % 4 ? "#f3ecd8" : "#d8ccb0", new THREE.Vector3(x0 + r() * bw * 0.7, 0.26 + Math.random() * 0.06, r() * bd * 0.6), new THREE.Vector3(r() * 0.12, -0.05, r() * 0.12), { wait: i * 0.018, life: 1.4, grav: 0.55, spin: 6 });
      }
      for (let i = 0; i < 8; i++) add(new THREE.IcosahedronGeometry(0.02, 0), "#fffbe9", new THREE.Vector3(x0 + r() * bw * 0.5, PATCH.top + 0.02, r() * bd * 0.5), new THREE.Vector3(r() * 0.15, 0.12, r() * 0.15), { wait: 0.6 + i * 0.04, life: 0.8, grav: 0, glow: true, floor: -1 });
    } else if (effect === "plant") {
      for (let i = 0; i < 9; i++) {
        const row = (i % 3) - 1;
        add(new THREE.BoxGeometry(0.012, 0.01, 0.012), "#d0a95e", new THREE.Vector3(x0 + r() * bw * 0.5, 0.22, (row * bd) / 3), new THREE.Vector3(0, 0, 0), { wait: i * 0.07, life: 1.6, grav: 2.4 });
      }
      for (let i = 0; i < 10; i++) add(new THREE.BoxGeometry(0.014, 0.014, 0.014), "#6b5238", new THREE.Vector3(x0 + r() * bw * 0.6, PATCH.top + 0.01, r() * bd * 0.6), new THREE.Vector3(r() * 0.5, 0.45 + Math.random() * 0.3, r() * 0.5), { wait: 0.7, life: 0.55, spin: 8 });
    } else {
      // Picked: sprigs of herb leap up out of the bed and away toward you, with a burst of glints.
      for (let i = 0; i < 12; i++) {
        add(new THREE.IcosahedronGeometry(0.015, 0), i % 3 === 0 ? "#c9a3e6" : i % 2 ? "#7cc24f" : "#5ea53f", new THREE.Vector3(x0 + r() * bw * 0.6, PATCH.top + 0.06, r() * bd * 0.6), new THREE.Vector3(r() * 0.4, 1.0 + Math.random() * 0.5, 0.45 + Math.random() * 0.4), { wait: i * 0.03, life: 1.1, grav: 1.6, spin: 7, floor: -1 });
      }
      for (let i = 0; i < 14; i++) {
        add(new THREE.OctahedronGeometry(0.016, 0), i % 2 ? "#fff3b0" : "#d9ffb8", new THREE.Vector3(x0 + r() * bw * 0.8, PATCH.top + 0.1 + Math.random() * 0.12, r() * bd * 0.7), new THREE.Vector3(r() * 0.3, 0.35 + Math.random() * 0.3, r() * 0.3), { wait: Math.random() * 0.25, life: 0.9, grav: 0, spin: 9, glow: true, floor: -1 });
      }
    }
  }

  /** A watering can, held tipped over a bed. */
  private makeCan(x: number, z: number): THREE.Group {
    const can = new THREE.Group();
    const tin = new THREE.MeshLambertMaterial({ color: "#8fa3ad", flatShading: true, transparent: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.09, 12), tin);
    body.position.y = 0.045;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.13, 6), tin);
    spout.position.set(-0.075, 0.08, 0);
    spout.rotation.z = Math.PI / 3;
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.018, 8), tin);
    rose.position.set(-0.13, 0.115, 0);
    rose.rotation.z = Math.PI / 3;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 5, 10, Math.PI), tin);
    handle.position.set(0.02, 0.09, 0);
    for (const m of [body, spout, rose, handle]) {
      m.raycast = () => {};
      can.add(m);
    }
    can.position.set(x, 0.2, z);
    can.scale.setScalar(0.6);
    can.userData.tin = tin;
    this.root.add(can);
    return can;
  }

  private animate(dt: number) {
    // The frames of light: steady on the picked bed, softer on the one pointed at, each with a slow breath.
    this.frames.forEach((f, i) => {
      const mat = f.userData.mat as THREE.MeshBasicMaterial;
      const want = i === this.picked ? 0.75 + Math.sin(this.clock * 3) * 0.2 : i === this.hovered ? 0.4 : 0;
      mat.opacity += (want - mat.opacity) * Math.min(1, dt * 10);
    });
    for (const c of this.cans) {
      c.age += dt;
      // Swung in and tipped, held while the shower falls, then set upright and gone.
      const tip = c.age < 0.25 ? c.age / 0.25 : c.age < 1.35 ? 1 : Math.max(0, 1 - (c.age - 1.35) / 0.3);
      c.obj.rotation.z = smoother(Math.min(1, tip)) * 0.75;
      c.obj.position.y = 0.19 + smoother(Math.min(1, tip)) * 0.05;
      (c.obj.userData.tin as THREE.MeshLambertMaterial).opacity = Math.min(1, c.age * 6, Math.max(0, (1.75 - c.age) * 4));
    }
    this.cans = this.cans.filter((c) => {
      if (c.age < 1.8) return true;
      this.drop(c.obj);
      return false;
    });
    for (const b of this.bits) {
      if (b.wait > 0) {
        b.wait -= dt;
        if (b.wait <= 0) b.mesh.scale.setScalar(b.size);
        continue;
      }
      b.age += dt;
      b.vel.y -= b.grav * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.mesh.position.y < b.floor) {
        b.mesh.position.y = b.floor;
        b.vel.set(0, 0, 0);
        b.grav = 0;
      }
      b.mesh.rotation.x += b.spin * dt;
      b.mesh.rotation.y += b.spin * 0.7 * dt;
      const left = b.life - b.age;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, left / 0.3));
    }
    this.bits = this.bits.filter((b) => {
      if (b.age < b.life) return true;
      this.drop(b.mesh);
      return false;
    });
  }

  private drop(o: THREE.Object3D) {
    this.root.remove(o);
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }

  // ---------- going ----------

  /** Fly back out to the Harbor, then take the stage down and give the view back. */
  leave() {
    this.leaving = true;
    this.hovered = null;
    this.picked = null;
    this.world.setCursor("");
  }

  private finish() {
    if (this.disposed) return;
    this.disposed = true;
    this.world.clearGrass(null);
    if (this.world.playing === this) this.world.endMinigame();
  }
}
