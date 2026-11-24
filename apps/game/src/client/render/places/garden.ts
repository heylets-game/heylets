// A hut's garden, in the corner of its doorstep: a patch of turned earth behind a run of pickets, split into
// beds (two by a Shack, three by a Cottage, four by a Lodge). Each bed is drawn as it has grown (garden.ts in the
// world says how): bare tilled earth, seed just in with a marker stick, the first shoots, young plants, a full
// bush, and a bush in flower with glints over it when it is ready to pick. A bed of mushrooms is dark bark mulch
// instead, with pale buttons pushing up through it that open into clusters of red-brown caps. A watered bed's
// earth is dark and wet; a fed one is flecked with bonemeal. A garden nobody tends (no hut on the plot yet) is the old patch of greens.
//
// The model is set down on the doorstep's corner (PLACE.garden: back 1, turned the corner's way), and laid out
// here a further third of a turn round, as the town's dressing laid the patch out before it was a place.

import * as THREE from "three";
import type { BedLook } from "@gantt-quest/world";
import { foldByLook, type PlaceModel } from "./kit";

const SOIL = "#5a4430";
const SOIL_WET = "#3a2819";
const TILTH = "#6b5238";
const EDGE = "#7a5230";
const PICKET = "#d8c9a6";
const PICKET_DARK = "#a98a5e";
const TIMBER = "#6b4a2c";
const LEAF = "#4f8a3f";
const LEAF_LIGHT = "#6fae4a";
const LEAF_RIPE = "#7cc24f";
const BLOOMS = ["#c9a3e6", "#e9e3cf", "#e8c14a", "#b06fd0"];
const BONEMEAL = "#efe8d4";
const MULCH = "#3e2c1f";
const MULCH_WET = "#2a1c12";
const BARK = "#7a5a3a";
const STEM = "#efe3c6";
const GILLS = "#dcc9a2";
const CAPS = ["#c94f31", "#b97a44", "#d56a3c"];
const CAP_SPOT = "#f6efe0";
const CAN = "#8fa3ad";

/** A fixed 0..1 value for a garden and an index, so each garden is drawn the same every time. */
function noise(id: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const cone = (r: number, h: number, seg = 5) => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0);
const blob = (r: number) => new THREE.IcosahedronGeometry(r, 0);
/** A mushroom's cap: the top half of a ball, its rim at y = 0. */
const capShape = (r: number) => new THREE.SphereGeometry(r, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
const sparkleShape = new THREE.OctahedronGeometry(1, 0);
/** Not pointed at: a glint over a bed is light, and pointing there means the ground behind it. */
const unpickable = <T extends THREE.Object3D>(o: T): T => {
  o.raycast = () => {};
  return o;
};

/**
 * How the patch is laid out, in its own space (the beds along x, the pickets behind them at -z and down the left
 * at -x, the front of it +z): what the model is built in, and what the garden's stage (GardenStage.ts) finds the
 * beds by. `turn` is how far the patch is turned within the model.
 */
export const PATCH = { w: 0.66, d: 0.46, gap: 0.035, turn: -(2 * Math.PI) / 3, top: 0.075 };

/** Where each of `count` beds lies across the patch: its middle (x), and how wide and deep it is. */
export function bedLayout(count: number): { bw: number; bd: number; cx: (i: number) => number } {
  const bw = (PATCH.w - 0.04 - PATCH.gap * (count - 1)) / count;
  return { bw, bd: PATCH.d - 0.06, cx: (i) => -PATCH.w / 2 + 0.02 + bw / 2 + i * (bw + PATCH.gap) };
}

export const garden: PlaceModel = (poi, kit) => {
  const { g, lambert } = kit;
  // Built in a group of its own turned the third of a turn the patch is laid out at, then baked into the model.
  const patch = new THREE.Group();
  patch.rotation.y = PATCH.turn;
  const put = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(geo, lambert(color));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    patch.add(m);
    return m;
  };
  const box = (color: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => put(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, ry);
  const n = (i: number) => noise(poi.id, i);

  const W = PATCH.w, D = PATCH.d;
  const beds = poi.beds;
  // The pickets along the back and the left, as there always were.
  for (let i = 0; i < 7; i++) box(i % 2 ? PICKET : PICKET_DARK, 0.045, 0.28 + n(60 + i) * 0.05, 0.02, -0.33 + i * 0.11, 0, -D / 2 - 0.04);
  box(TIMBER, W + 0.06, 0.022, 0.02, 0, 0.16, -D / 2 - 0.055);
  for (let i = 0; i < 4; i++) box(i % 2 ? PICKET_DARK : PICKET, 0.02, 0.28, 0.045, -W / 2 - 0.05, 0, -0.18 + i * 0.12);
  box(TIMBER, 0.02, 0.022, D + 0.02, -W / 2 - 0.065, 0.16, 0);

  if (!beds) {
    // Nobody's: rows of greens with a few flowers in a bed of turned earth, and a pail left out.
    box(SOIL, W - 0.04, 0.05, D - 0.02, 0, 0, 0);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        const x = -0.24 + i * 0.12, z = -0.14 + row * 0.14;
        const h = 0.07 + n(row * 5 + i) * 0.09;
        put(cone(0.045, h, 4), row === 1 ? LEAF_LIGHT : LEAF, x, 0.05, z, i);
        if (row === 2 && n(40 + i) < 0.6) put(blob(0.03), BLOOMS[Math.floor(n(50 + i) * 3.99)], x, 0.07 + h, z);
      }
    }
    put(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 8).translate(0, 0.06, 0), PICKET_DARK, 0.42, 0, 0.14);
  } else {
    // A path of trodden earth round the beds, and the beds themselves, each in its own timber edging.
    box("#6e5a42", W, 0.03, D, 0, 0, 0);
    const { bw, bd, cx: middle } = bedLayout(beds.length);
    const cols = bw > 0.2 ? 2 : 1;
    beds.forEach((bed, b) => {
      const cx = middle(b);
      const wet = bed.watered && bed.stage !== "empty" && bed.stage !== "ready";
      const shrooms = bed.crop === "mushrooms";
      box(EDGE, bw, 0.06, 0.02, cx, 0.02, -bd / 2);
      box(EDGE, bw, 0.06, 0.02, cx, 0.02, bd / 2);
      box(EDGE, 0.02, 0.06, bd, cx - bw / 2, 0.02, 0);
      box(EDGE, 0.02, 0.06, bd, cx + bw / 2, 0.02, 0);
      box(shrooms ? (wet ? MULCH_WET : MULCH) : wet ? SOIL_WET : SOIL, bw - 0.03, 0.055, bd - 0.03, cx, 0.02, 0);
      const top = PATCH.top;
      /** Glints over a bed ready to pick: the renderer turns and pulses them, each on its own beat. */
      const glints = () => {
        for (let s = 0; s < cols + 1; s++) {
          const m = unpickable(new THREE.Mesh(sparkleShape, new THREE.MeshBasicMaterial({ color: s % 2 ? "#fff3b0" : "#d9ffb8", transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })));
          const size = 0.024 + n(b * 9 + s) * 0.01;
          m.position.set(cx + (n(b * 9 + s + 3) - 0.5) * bw * 0.8, top + 0.2 + n(b * 9 + s + 5) * 0.1, (n(b * 9 + s + 6) - 0.5) * bd * 0.7);
          m.scale.setScalar(size);
          m.userData.twinkle = b * 1.7 + s * 2.3;
          m.userData.size = size;
          m.userData.glow = true;
          patch.add(m);
        }
      };
      if (shrooms) {
        // Chips of bark through the mulch.
        for (let f = 0; f < 7; f++) box(BARK, 0.026, 0.008, 0.012, cx + (n(b * 30 + f) - 0.5) * (bw - 0.07), top, (n(b * 30 + f + 9) - 0.5) * (bd - 0.07), n(b * 30 + f + 4) * Math.PI);
        if (bed.fed) for (let f = 0; f < 6; f++) box(BONEMEAL, 0.014, 0.008, 0.014, cx + (n(b * 20 + f) - 0.5) * (bw - 0.06), top, (n(b * 20 + f + 7) - 0.5) * (bd - 0.06));
        if (bed.stage === "sown") {
          // A marker stick with a russet tag, and pale threads of spawn worked into the mulch.
          box(TIMBER, 0.012, 0.11, 0.012, cx + bw / 2 - 0.035, top, bd / 2 - 0.035);
          box(CAPS[0], 0.045, 0.03, 0.006, cx + bw / 2 - 0.035, top + 0.07, bd / 2 - 0.028);
          for (let f = 0; f < 8; f++) box(STEM, 0.02, 0.006, 0.006, cx + (n(b * 50 + f) - 0.5) * (bw - 0.08), top + 0.004, (n(b * 50 + f + 3) - 0.5) * (bd - 0.08), n(b * 50 + f + 6) * Math.PI);
          return;
        }
        // Clusters of mushrooms in a grid on the bed, three to a cluster, each a little different.
        const grow = { sprout: 0.35, young: 0.6, leafy: 0.85, ready: 1 }[bed.stage as "sprout" | "young" | "leafy" | "ready"];
        for (let rr = 0; rr < 3; rr++) {
          for (let cc = 0; cc < cols; cc++) {
            const k = b * 40 + rr * 4 + cc;
            const px = cx + (cols === 1 ? 0 : (cc - 0.5) * (bw / 2)) + (n(k) - 0.5) * 0.02;
            const pz = -bd / 3 + (rr * bd) / 3 + (n(k + 1) - 0.5) * 0.02;
            for (let m = 0; m < 3; m++) {
              const a = n(k + 5 + m) * Math.PI * 2;
              const off = m === 0 ? 0 : 0.022 + n(k + 8 + m) * 0.01;
              const x = px + Math.cos(a) * off, z = pz + Math.sin(a) * off;
              const s = grow * (m === 0 ? 1 : 0.62 + n(k + 11 + m) * 0.2) * (cols === 1 ? 1 : 0.85);
              const cap = CAPS[Math.floor(n(k + 14 + m) * CAPS.length) % CAPS.length];
              if (bed.stage === "sprout") {
                // Pale buttons just pushing up through the mulch.
                const btn = put(blob(0.016 * s / 0.35), STEM, x, top + 0.004, z);
                btn.scale.y = 0.8;
                continue;
              }
              const r = 0.034 * s, h = 0.062 * s;
              put(new THREE.CylinderGeometry(r * 0.28, r * 0.36, h, 6).translate(0, h / 2, 0), STEM, x, top, z);
              // A young cap is still closed round its stem; an open one shows its gills underneath.
              const c = put(capShape(r), cap, x, top + h * 0.92, z);
              c.scale.y = bed.stage === "young" ? 1.05 : 0.68;
              if (bed.stage !== "young") {
                const g = put(new THREE.CylinderGeometry(r * 0.96, r * 0.4, 0.004, 8), GILLS, x, top + h * 0.9, z);
                g.rotation.y = a;
              }
              if (bed.stage === "ready" && m === 0) {
                // Pale flecks on the big cap of each cluster.
                for (let f = 0; f < 3; f++) {
                  const fa = a + (f * 2 * Math.PI) / 3, up = 0.55 + f * 0.1;
                  put(blob(r * 0.16), CAP_SPOT, x + Math.cos(fa) * r * Math.cos(up), top + h * 0.92 + r * 0.68 * Math.sin(up), z + Math.sin(fa) * r * Math.cos(up));
                }
              }
            }
          }
        }
        if (bed.stage === "ready") glints();
        return;
      }
      // Furrows in the earth: three ridges along each bed.
      if (bed.stage === "empty" || bed.stage === "sown") {
        for (let f = 0; f < 3; f++) box(wet ? "#4a3522" : TILTH, bw - 0.06, 0.012, 0.022, cx, top, -bd / 3 + (f * bd) / 3);
      }
      if (bed.fed) for (let f = 0; f < 6; f++) box(BONEMEAL, 0.014, 0.008, 0.014, cx + (n(b * 20 + f) - 0.5) * (bw - 0.06), top, (n(b * 20 + f + 7) - 0.5) * (bd - 0.06));
      if (bed.stage === "sown") {
        // A marker stick at the bed's front with a white tag, and seed dots along the furrows.
        box(TIMBER, 0.012, 0.11, 0.012, cx + bw / 2 - 0.035, top, bd / 2 - 0.035);
        box("#f4efe2", 0.045, 0.03, 0.006, cx + bw / 2 - 0.035, top + 0.07, bd / 2 - 0.028);
        for (let f = 0; f < 3; f++) for (let s = 0; s < 3; s++) box("#c8a25a", 0.012, 0.01, 0.012, cx - bw / 4 + s * (bw / 4), top + 0.01, -bd / 3 + (f * bd) / 3);
        return;
      }
      if (bed.stage === "empty") return;
      // Plants in a grid on the bed, growing with each stage.
      const rows = 3;
      for (let rr = 0; rr < rows; rr++) {
        for (let cc = 0; cc < cols; cc++) {
          const k = b * 40 + rr * 4 + cc;
          const px = cx + (cols === 1 ? 0 : (cc - 0.5) * (bw / 2)) + (n(k) - 0.5) * 0.02;
          const pz = -bd / 3 + (rr * bd) / 3 + (n(k + 1) - 0.5) * 0.02;
          const j = 0.85 + n(k + 2) * 0.3;
          const spin = n(k + 3) * Math.PI;
          /** A leaf: a flattened, pointed blob laid out from the stem at `a`, tipped up by `lift`, `len` long. */
          const leaf = (a: number, len: number, lift: number, y: number, color: string) => {
            const m = put(blob(1), color, px + Math.cos(a) * len * 0.55, y, pz + Math.sin(a) * len * 0.55);
            m.scale.set(len * 0.62, len * 0.12, len * 0.26);
            m.rotation.set(0, -a, lift, "YXZ");
          };
          if (bed.stage === "sprout") {
            put(cone(0.008, 0.03 * j, 4), LEAF_LIGHT, px, top, pz, spin);
            leaf(spin, 0.035 * j, 0.5, top + 0.03 * j, LEAF_LIGHT);
            leaf(spin + Math.PI, 0.035 * j, 0.5, top + 0.03 * j, LEAF_LIGHT);
          } else if (bed.stage === "young") {
            // A low rosette of leaves round a short stem.
            put(cone(0.01, 0.05 * j, 4), LEAF, px, top, pz, spin);
            for (let l = 0; l < 5; l++) leaf(spin + (l * 2 * Math.PI) / 5, 0.06 * j, 0.45, top + 0.025 + (l % 2) * 0.012, l % 2 ? LEAF_LIGHT : LEAF);
            leaf(spin + 0.6, 0.04 * j, 0.9, top + 0.055 * j, LEAF_LIGHT);
          } else {
            // A full bush: tiers of leaves fanned round the stem, the top ones lighter and more upright.
            const ripe = bed.stage === "ready";
            const r = (ripe ? 0.075 : 0.065) * j * (cols === 1 ? 1 : 0.85);
            put(cone(0.012, r * 1.3, 4), LEAF, px, top, pz, spin);
            for (let l = 0; l < 7; l++) leaf(spin + (l * 2 * Math.PI) / 7, r * 1.05, 0.35, top + r * 0.35, LEAF);
            for (let l = 0; l < 5; l++) leaf(spin + 0.4 + (l * 2 * Math.PI) / 5, r * 0.85, 0.7, top + r * 0.75, ripe ? LEAF_RIPE : LEAF_LIGHT);
            for (let l = 0; l < 3; l++) leaf(spin + 1.1 + (l * 2 * Math.PI) / 3, r * 0.6, 1.05, top + r * 1.1, ripe ? LEAF_RIPE : LEAF_LIGHT);
            if (ripe) {
              // In flower: small blooms on stalks above each bush.
              for (let f = 0; f < 3; f++) {
                const a = spin + (f * 2 * Math.PI) / 3;
                const fx = px + Math.cos(a) * r * 0.35, fz = pz + Math.sin(a) * r * 0.35;
                put(cone(0.004, r * 0.6, 3), LEAF, fx, top + r * 1.1, fz);
                put(blob(0.016), BLOOMS[(b + f + rr) % BLOOMS.length], fx, top + r * 1.75, fz);
              }
            }
          }
        }
      }
      if (bed.stage === "ready") glints();
    });
    // A watering can left by the gate, its spout toward the beds.
    put(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10).translate(0, 0.04, 0), CAN, W / 2 + 0.08, 0, 0.16);
    const spout = put(new THREE.CylinderGeometry(0.007, 0.01, 0.09, 6), CAN, W / 2 + 0.035, 0.08, 0.16);
    spout.rotation.z = Math.PI / 3.2;
    box("#6f828b", 0.012, 0.05, 0.05, W / 2 + 0.1, 0.07, 0.16);
  }

  // Baked into the model's own group, so its pieces fold together by colour.
  patch.updateMatrix();
  for (const child of [...patch.children]) {
    child.applyMatrix4(patch.matrix);
    g.add(child);
  }
  foldByLook(g);
};

/** The beds as they look, as one short string: what the renderer compares to know when to draw a garden again. */
export const bedsSig = (beds: readonly BedLook[] | undefined): string => (beds ? beds.map((b) => `${b.crop[0]}${b.stage[0]}${b.stage[1]}${b.watered ? "w" : ""}${b.fed ? "f" : ""}`).join(",") : "");
