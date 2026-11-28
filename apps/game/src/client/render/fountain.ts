// The fountain in the Harbor's square: the old waygate's ring of stone, set
// upright over a basin, with water falling through it.
//
// The crew goes out by ship now, and the gate that hung here is a fountain:
// its stone ring (the same pieces, waygate.ts `arcPiece` and `RINGS`) stands
// mended on a carved pedestal, each break closed with a collar of brass, the
// brass band of the armillary fixed level about it. Water wells from the
// crown of the ring and falls in a sheet through the middle of it into a
// round basin of dressed stone with a brass lip, spills from four spouts in
// the pedestal, and rings spread across the pool where it lands. The signs
// cut in the stone still hold a little of the gate's cold light, and after
// dark the falling water is lit by it.
//
// It moves (the water, the spray, the light), so it is made as a thing of its
// own, like the gate was, and whoever stands it calls `update` every frame.

import * as THREE from "three";
import { moteField, type Mote } from "./motes";
import { RINGS, arcPiece, haloTexture, mergedFacets } from "./waygate";

/** Something of a scene that moves by itself: turned once a frame, and let go with whatever it stands in. */
export interface Fountain {
  /** Add this to the scene. Its origin is the ground under its middle; the ring faces along its z, both ways. */
  readonly object: THREE.Group;
  /** Once a frame. `time` is a clock in seconds; `dark` is how dark it is, 0 in broad day to 1 at night. */
  update(time: number, dark?: number): void;
  dispose(): void;
}

export interface FountainOptions {
  /** The cold light left in the ring's signs, and the stone and brass it is made of. */
  color?: THREE.ColorRepresentation;
  stone?: THREE.ColorRepresentation;
  brass?: THREE.ColorRepresentation;
  /** Give it a light of its own (one point light), as the gate had. */
  light?: boolean;
}

/** How tall and how wide it stands. */
export const FOUNTAIN_SIZE = { tall: 3.0, wide: 2.3 };

/** How much smaller than the gate's the fountain's ring is, how high its middle stands, and how far out the basin's wall is. */
const RING_SCALE = 0.62;
const MID = 1.72;
const BASIN = 1.08;
const POOL_Y = 0.3;

const hash = (a: number, b: number, salt: number) => {
  const n = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

const WATER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const WATER_COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uLit;
  uniform vec3 uColor;
  uniform vec3 uGlow;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;
/** Falling water: streaks running down it, thin at the edges, breaking into white as it nears the pool. */
const FALL_FRAG = /* glsl */ `${WATER_COMMON}
  void main() {
    float down = vUv.y + uTime * 0.9;
    float streak = noise(vec2(vUv.x * 14.0, down * 3.0)) * 0.6 + noise(vec2(vUv.x * 31.0, down * 7.0)) * 0.4;
    float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x);
    float foam = smoothstep(0.3, 0.0, vUv.y);
    float a = edge * (0.3 + 0.5 * streak) * smoothstep(1.0, 0.94, vUv.y) + foam * edge * 0.35;
    vec3 c = mix(uColor, vec3(1.0), clamp(streak * 0.55 + foam * 0.6, 0.0, 1.0)) + uGlow * uLit * (0.25 + 0.5 * streak);
    gl_FragColor = vec4(c, clamp(a, 0.0, 0.9));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
/** The pool: rings spreading from where the water lands, and a slow shimmer over the rest. */
const POOL_FRAG = /* glsl */ `${WATER_COMMON}
  void main() {
    vec2 at = vUv * 2.0 - 1.0;
    float r = length(at);
    float rings = 0.5 + 0.5 * sin(r * 26.0 - uTime * 4.2);
    rings *= smoothstep(0.95, 0.1, r);
    float shimmer = noise(at * 6.0 + vec2(uTime * 0.3, -uTime * 0.22));
    float foam = smoothstep(0.34, 0.12, r) * (0.5 + 0.5 * noise(at * 18.0 + uTime * 1.6));
    vec3 c = mix(uColor * 0.72, uColor * 1.15, shimmer) + vec3(1.0) * (rings * 0.14 + foam * 0.5) + uGlow * uLit * (0.12 + 0.25 * rings);
    gl_FragColor = vec4(c, 0.86);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** A fountain. Add `object` to the scene where it should stand, call `update` once a frame, and `dispose` when it is done with. */
export function makeFountain(opts: FountainOptions = {}): Fountain {
  const color = new THREE.Color(opts.color ?? "#7fe4ff");
  const rock = new THREE.Color(opts.stone ?? "#8a8f99");
  const brassTone = new THREE.Color(opts.brass ?? "#c79a3e");
  const object = new THREE.Group();
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };
  const stoneOf = (shade: number) => keep(new THREE.MeshLambertMaterial({ color: rock.clone().multiplyScalar(shade), flatShading: true }));
  const stones = [stoneOf(1), stoneOf(0.8), stoneOf(1.14)];
  const brass = keep(new THREE.MeshLambertMaterial({ color: brassTone, emissive: brassTone.clone().multiplyScalar(0.12), flatShading: true }));
  const lit = keep(new THREE.MeshBasicMaterial({ color: color.clone() }));
  const litBase = lit.color.clone();
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(keep(geometry), material);
    m.position.set(x, y, z);
    object.add(m);
    return m;
  };
  /** A piece that is light or water, not a solid: it throws no shadow and takes none. */
  const glow = <T extends THREE.Object3D>(o: T): T => {
    o.userData.glow = true;
    return o;
  };

  // ---- the basin: a step, a round wall of dressed stone with a brass lip, and the floor under the water ----
  mesh(new THREE.CylinderGeometry(BASIN + 0.16, BASIN + 0.2, 0.08, 28), stones[1], 0, 0.04, 0);
  const wall = new THREE.LatheGeometry(
    [[BASIN - 0.2, 0.08], [BASIN + 0.06, 0.08], [BASIN + 0.1, 0.2], [BASIN + 0.02, 0.36], [BASIN + 0.05, 0.42], [BASIN - 0.1, 0.42], [BASIN - 0.14, 0.1]].map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  );
  mesh(mergedFacets([wall]), stones[0]);
  mesh(new THREE.TorusGeometry(BASIN - 0.03, 0.022, 5, 44).rotateX(Math.PI / 2), brass, 0, 0.43, 0);
  mesh(new THREE.CylinderGeometry(BASIN - 0.12, BASIN - 0.12, 0.04, 28), stones[1], 0, 0.1, 0);
  // Eight carved panels round the wall, each with a sign of the old gate's cut in it.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const panel = mesh(new THREE.BoxGeometry(0.3, 0.16, 0.03), stones[2], Math.sin(a) * (BASIN + 0.085), 0.25, Math.cos(a) * (BASIN + 0.085));
    panel.rotation.y = a;
    const sign = glow(mesh(new THREE.BoxGeometry(i % 2 ? 0.1 : 0.03, i % 2 ? 0.03 : 0.1, 0.012), lit, Math.sin(a) * (BASIN + 0.105), 0.25, Math.cos(a) * (BASIN + 0.105)));
    sign.rotation.y = a;
  }

  // ---- the pedestal the ring stands on: stepped and waisted, a brass collar at its neck, four spouts in it ----
  const foot = MID - RINGS[0].r * RING_SCALE - 0.1;
  const pedestal = new THREE.LatheGeometry(
    [[0.46, 0.1], [0.46, 0.34], [0.36, 0.42], [0.24, 0.52], [0.2, foot - 0.16], [0.3, foot - 0.06], [0.32, foot], [0, foot]].map(([r, y]) => new THREE.Vector2(r, y)),
    8,
  );
  mesh(mergedFacets([pedestal]), stones[2]);
  mesh(new THREE.TorusGeometry(0.23, 0.03, 5, 16).rotateX(Math.PI / 2), brass, 0, 0.56, 0);
  // A cradle of brass under the ring, holding it upright.
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.1, 0.2, 0.3), brass, s * 0.2, foot + 0.07, 0).rotation.z = -s * 0.5;

  // ---- the ring: the gate's own stone pieces, set back in their places and mended with brass ----
  const ring = new THREE.Group();
  ring.position.y = MID;
  ring.scale.setScalar(RING_SCALE);
  object.add(ring);
  const def = RINGS[0];
  const PIECES = 6;
  for (let i = 0; i < PIECES; i++) {
    // Six pieces, close to even, a narrow break between each where the collar goes.
    const a0 = (i / PIECES) * Math.PI * 2 + 0.05 + Math.PI / 2;
    const a1 = ((i + 1) / PIECES) * Math.PI * 2 - 0.05 + Math.PI / 2;
    const made = arcPiece(def, a0, a1, 400 + i);
    const root = new THREE.Group();
    root.position.set(made.at.x, made.at.y, 0);
    root.add(new THREE.Mesh(keep(made.body), stones[i % 3]));
    if (made.signs) root.add(glow(new THREE.Mesh(keep(made.signs), lit)));
    ring.add(root);
    const at = (i / PIECES) * Math.PI * 2 + Math.PI / 2;
    const collar = new THREE.Mesh(keep(new THREE.BoxGeometry(def.thick * 1.25, 0.16, def.deep * 1.25)), brass);
    collar.position.set(Math.cos(at) * def.r, Math.sin(at) * def.r, 0);
    collar.rotation.z = at;
    ring.add(collar);
  }
  // The armillary's brass band, fixed level about the ring's middle, with a finial on the crown where the water wells.
  {
    const band = RINGS[1];
    const hoop = new THREE.Mesh(keep(new THREE.TorusGeometry(def.r + 0.24, band.thick * 0.9, 5, 44).rotateX(Math.PI / 2)), brass);
    ring.add(hoop);
    const finial = new THREE.Mesh(keep(new THREE.OctahedronGeometry(0.2, 0)), brass);
    finial.position.y = def.r + def.thick / 2 + 0.2;
    finial.scale.set(1, 1.5, 1);
    ring.add(finial);
  }

  // ---- the water: a sheet falling through the ring, four spouts from the pedestal, and the pool ----
  const waterColor = new THREE.Color("#8fc9d8");
  const waterMat = (fragment: string) =>
    keep(new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uLit: { value: 0 }, uColor: { value: waterColor }, uGlow: { value: color } }, vertexShader: WATER_VERT, fragmentShader: fragment, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const fallMat = waterMat(FALL_FRAG);
  const poolMat = waterMat(POOL_FRAG);
  const inner = (def.r - def.thick / 2) * RING_SCALE;
  const fallTop = MID + inner;
  const fall = glow(mesh(new THREE.PlaneGeometry(0.62, fallTop - foot + 0.02), fallMat, 0, (fallTop + foot) / 2, 0));
  fall.renderOrder = 2;
  // (And the same water seen from the side: a second sheet across the first, narrower, so it has some body.)
  const across = glow(mesh(new THREE.PlaneGeometry(0.16, fallTop - foot + 0.02).rotateY(Math.PI / 2), fallMat, 0, (fallTop + foot) / 2, 0));
  across.renderOrder = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    mesh(new THREE.BoxGeometry(0.07, 0.07, 0.14), brass, Math.sin(a) * 0.5, 0.72, Math.cos(a) * 0.5).rotation.y = a;
    const spill = glow(mesh(new THREE.PlaneGeometry(0.09, 0.72 - POOL_Y), fallMat, Math.sin(a) * 0.6, (0.72 + POOL_Y) / 2, Math.cos(a) * 0.6));
    spill.rotation.y = a;
    spill.renderOrder = 2;
  }
  const pool = glow(mesh(new THREE.CircleGeometry(BASIN - 0.11, 36).rotateX(-Math.PI / 2), poolMat, 0, POOL_Y, 0));
  pool.renderOrder = 1;

  // ---- spray where the sheet lands, and a few motes of the old light still rising through the ring ----
  const drops: Mote[] = [];
  const white = new THREE.Color("#ffffff");
  for (let i = 0; i < 26; i++) {
    const spray = i % 3 !== 0;
    const a = hash(i, 1, 310) * Math.PI * 2;
    const d = spray ? 0.2 + hash(i, 2, 310) * 0.45 : hash(i, 2, 310) * 0.5;
    drops.push({
      x: Math.cos(a) * d, y: spray ? POOL_Y + 0.02 : MID - 0.5 + hash(i, 3, 310) * 0.7, z: Math.sin(a) * d * (spray ? 1 : 0.4),
      color: spray ? white : color, rise: spray ? 0.25 + hash(i, 5, 310) * 0.3 : 0.6 + hash(i, 5, 310) * 0.6, sway: 0.05 + hash(i, 6, 310) * 0.1,
      rate: spray ? 0.5 + hash(i, 7, 310) * 0.5 : 0.12 + hash(i, 7, 310) * 0.15, phase: hash(i, 8, 310), size: spray ? 0.3 + hash(i, 9, 310) * 0.3 : 0.4 + hash(i, 9, 310) * 0.5,
    });
  }
  const motes = moteField(drops, 0.1);
  motes.points.raycast = () => {};
  object.add(motes.points);

  // ---- its light: a soft pool of it on the paving after dark, and one lamp in the ring ----
  const groundMat = keep(new THREE.MeshBasicMaterial({ map: haloTexture(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ground = glow(mesh(new THREE.PlaneGeometry(5.6, 5.6).rotateX(-Math.PI / 2), groundMat, 0, 0.03, 0));
  ground.renderOrder = 1;
  ground.raycast = () => {};
  const lamp = opts.light ? new THREE.PointLight(color, 0, 8, 1.6) : null;
  if (lamp) {
    lamp.position.set(0, MID - 0.2, 0.3);
    object.add(lamp);
  }

  const update = (time: number, dark = 0) => {
    // (For anyone who asked for less motion: the same water, at a crawl.)
    const t = time * (still ? 0.15 : 1);
    fallMat.uniforms.uTime.value = t;
    poolMat.uniforms.uTime.value = t;
    fallMat.uniforms.uLit.value = dark;
    poolMat.uniforms.uLit.value = dark;
    motes.tick(t);
    // The signs keep an ember of the gate's light by day, and more of it after dark, breathing slowly.
    lit.color.copy(litBase).multiplyScalar(0.3 + 0.7 * dark + 0.06 * Math.sin(t * 0.9));
    groundMat.opacity = 0.3 * dark * (0.9 + 0.1 * Math.sin(t * 1.1));
    if (lamp) lamp.intensity = (0.3 + 3.2 * dark) * (1 + Math.sin(t * 1.3) * 0.06);
  };
  update(0);
  return {
    object,
    update,
    dispose() {
      for (const thing of owned) thing.dispose();
      motes.dispose();
      object.clear();
    },
  };
}
