// The crew's ship: a Sloop, a Brig or a Galleon, drawn low-poly from her
// catalogue entry (packages/world/src/voyage/ships.ts). Nothing here is
// drawn for one ship alone: her length and beam come from her deck's rows
// and columns, how many masts she steps from her length, and whether she
// has a quarterdeck, a poop and a forecastle from how many masts that is.
// So a ship added to the catalogue, or one whose deck is changed, is drawn
// without a line being written here.
//
// Her hull is lofted from stations as the rowboat's is (rowboat.ts
// `hullSkin`), and painted as the crew's boats are. She is modelled with
// her bow toward +z, her middle on her own origin and her waterline at
// y = 0, in the world's units (a hex is a unit to its corner).
//
// `built` draws her part built instead, for the slipway: the keel and
// frames first, then her lower planking, then the whole hull decked and
// railed with no masts stepped yet.

import * as THREE from "three";
import type { ShipDef } from "@gantt-quest/world";
import { foldByLook } from "./places/kit";
import { BOAT_PAINT, beam, hullSection, hullSkin, type HullStation } from "./rowboat";

/** How long a ship is drawn for each row of her deck, and how wide for each column. */
const ROW = 0.7;
const COL = 0.55;

/** A hull's shape at each fraction of its length, stern (0) to bow (1): how wide (of the beam), how high the rail (over the lowest), how deep the keel (of the deepest). */
const LINES: { f: number; wide: number; sheer: number; deep: number }[] = [
  { f: 0, wide: 0.66, sheer: 0.3, deep: 0.55 },
  { f: 0.1, wide: 0.86, sheer: 0.22, deep: 0.85 },
  { f: 0.28, wide: 1, sheer: 0.06, deep: 1 },
  { f: 0.52, wide: 1, sheer: 0, deep: 1 },
  { f: 0.74, wide: 0.84, sheer: 0.06, deep: 0.9 },
  { f: 0.89, wide: 0.48, sheer: 0.16, deep: 0.6 },
  { f: 1, wide: 0, sheer: 0.28, deep: 0.1 },
];

const lambert = (color: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export interface ShipSize {
  /** Stern to bow, and across at her widest. */
  length: number;
  beam: number;
  /** Above her waterline: her main deck, and the top of her rail amidships. */
  deck: number;
  rail: number;
  /** How many masts she steps. */
  masts: number;
  /** The top of her tallest mast. */
  tall: number;
}

/** How big a ship is drawn, from her deck: the model is made to these, and whoever moors her reads them. */
export function shipSize(def: ShipDef): ShipSize {
  const length = def.deck.rows * ROW;
  const beam = def.deck.cols * COL;
  const rail = 0.62 + def.deck.rows * 0.035;
  // A mast for every two rows of deck past six: one on a Sloop, two on a Brig, three on a Galleon.
  const masts = Math.max(1, Math.floor((def.deck.rows - 6) / 2));
  return { length, beam, deck: rail - 0.24, rail, masts, tall: rail + length * 0.62 };
}

/** Her lines as stations for the hull's loft. */
function stationsOf(size: ShipSize): HullStation[] {
  const depth = 0.3 + size.beam * 0.1;
  return LINES.map((l) => ({ z: (l.f - 0.5) * size.length, half: (l.wide * size.beam) / 2, top: size.rail + l.sheer * size.length * 0.085, keel: -depth * l.deep }));
}

/** A value of her lines at any fraction of her length, between the stations. */
function at(stations: HullStation[], size: ShipSize, f: number): HullStation {
  const z = (f - 0.5) * size.length;
  const next = stations.findIndex((s) => s.z > z);
  const i = next < 0 ? stations.length - 2 : Math.max(0, next - 1);
  const [a, b] = [stations[i], stations[i + 1]];
  const k = Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z)));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { z, half: mix(a.half, b.half), top: mix(a.top, b.top), keel: mix(a.keel, b.keel) };
}

export interface ShipModel {
  group: THREE.Group;
  size: ShipSize;
  /** Her stern lantern, in her own frame: lit after dark. Absent on a hull still building. */
  lantern?: THREE.Vector3;
}

/**
 * A ship's model. `built` (0 to 1) draws her on the stocks, that far along: frames, then lower planking, then
 * the hull whole and decked. Without it she is finished and rigged, as she lies afloat.
 */
export function shipModel(def: ShipDef, opts: { built?: number } = {}): ShipModel {
  const size = shipSize(def);
  const stations = stationsOf(size);
  const group = new THREE.Group();
  const afloat = opts.built === undefined;
  const stage = afloat ? 4 : opts.built! >= 0.67 ? 3 : opts.built! >= 0.34 ? 2 : 1;
  const timber = lambert(BOAT_PAINT.timber);
  const dark = lambert("#4a3524");
  const pale = lambert("#b5895a");
  const add = <T extends THREE.Object3D>(o: T): T => {
    group.add(o);
    return o;
  };
  const put = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = add(new THREE.Mesh(geometry, material));
    mesh.position.set(x, y, z);
    return mesh;
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const stem = stations[stations.length - 1];
  const stern = stations[0];

  // ---- her backbone: keel, stem and sternpost. On the stocks from the first day. ----
  for (let i = 0; i < stations.length - 1; i++) add(beam(v(0, stations[i].keel - 0.03, stations[i].z), v(0, stations[i + 1].keel - 0.03, stations[i + 1].z), 0.09, 0.1, dark));
  add(beam(v(0, stem.keel - 0.05, stem.z - 0.02), v(0, stem.top + 0.16, stem.z + 0.07), 0.09, 0.1, dark));
  add(beam(v(0, stern.keel - 0.05, stern.z), v(0, stern.top + 0.04, stern.z - 0.03), 0.08, 0.09, dark));

  // ---- her frames: ribs from keel to rail, while her planking does not yet hide them ----
  if (stage < 3) {
    const ribs = Math.round(size.length / 0.42);
    for (let k = 1; k < ribs; k++) {
      const pts = hullSection(at(stations, size, k / ribs), 0.03, 0.06);
      for (let j = 0; j < pts.length - 1; j++) add(beam(v(pts[j][0], pts[j][1], pts[j][2]), v(pts[j + 1][0], pts[j + 1][1], pts[j + 1][2]), 0.05, 0.05, k % 2 ? timber : pale));
    }
    // A ribband along the heads of the frames, each side, holding them fair.
    for (const side of [1, -1]) for (let i = 0; i < stations.length - 1; i++) add(beam(v(side * stations[i].half, stations[i].top, stations[i].z), v(side * stations[i + 1].half, stations[i + 1].top, stations[i + 1].z), 0.035, 0.04, pale));
  }

  // ---- her planking: the lower strakes first, then all of it, painted as the crew's boats are ----
  if (stage >= 2) {
    const bands = [BOAT_PAINT.stripe, BOAT_PAINT.topside, BOAT_PAINT.bottom, BOAT_PAINT.bottom, BOAT_PAINT.topside, BOAT_PAINT.stripe];
    const lines = { stations, bands, inside: BOAT_PAINT.inside, thick: 0.04, stripe: 0.09, ...(stage === 2 ? { only: [2, 3] } : {}) };
    const skin = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    add(new THREE.Mesh(hullSkin(false, lines), skin));
    add(new THREE.Mesh(hullSkin(true, lines), skin));
  }

  if (stage >= 3) {
    // ---- her deck, planked from rail to rail, and the rail capping her sides ----
    const deckAt = (s: HullStation) => Math.max(0, s.half - 0.05);
    {
      const pos: number[] = [];
      for (let i = 0; i < stations.length - 1; i++) {
        const [a, b] = [stations[i], stations[i + 1]];
        const [wa, wb] = [deckAt(a), deckAt(b)];
        // (Wound to face up.)
        pos.push(-wa, size.deck, a.z, wb, size.deck, b.z, wa, size.deck, a.z, -wa, size.deck, a.z, -wb, size.deck, b.z, wb, size.deck, b.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      // (A uv, as every box has one: pieces of one colour are folded into one mesh, and must carry the same attributes.)
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
      geo.computeVertexNormals();
      add(new THREE.Mesh(geo, lambert("#c19463")));
    }
    for (const side of [1, -1]) for (let i = 0; i < stations.length - 1; i++) add(beam(v(side * stations[i].half, stations[i].top + 0.02, stations[i].z), v(side * stations[i + 1].half, stations[i + 1].top + 0.02, stations[i + 1].z), 0.07, 0.05, timber));
    add(beam(v(-stern.half, stern.top + 0.02, stern.z), v(stern.half, stern.top + 0.02, stern.z), 0.07, 0.05, timber));
    // Hatches down the middle of the deck, one between each pair of masts and one aft of the first.
    for (let k = 0; k < size.masts; k++) put(new THREE.BoxGeometry(size.beam * 0.3, 0.07, 0.42), dark, 0, size.deck + 0.035, (0.44 + k * 0.17 - (size.masts - 1) * 0.1 - 0.5) * size.length);

    // ---- her castles: a quarterdeck on a two-master, and a poop over it and a forecastle on a three-master ----
    const castle = (from: number, to: number, rise: number) => {
      const [a, b] = [at(stations, size, from), at(stations, size, to)];
      const wide = Math.min(a.half, b.half) * 2 - 0.08;
      const y = size.deck + rise;
      put(new THREE.BoxGeometry(wide, rise, Math.abs(b.z - a.z)), lambert("#8a6440"), 0, size.deck + rise / 2, (a.z + b.z) / 2);
      put(new THREE.BoxGeometry(wide + 0.06, 0.03, Math.abs(b.z - a.z) + 0.05), lambert("#c19463"), 0, y + 0.015, (a.z + b.z) / 2);
      // A rail of turned posts across the end that looks down on the main deck.
      const inboard = from < 0.5 ? b.z : a.z;
      for (let x = -wide / 2 + 0.06; x <= wide / 2 - 0.05; x += 0.16) put(new THREE.BoxGeometry(0.03, 0.16, 0.03), timber, x, y + 0.1, inboard);
      put(new THREE.BoxGeometry(wide, 0.03, 0.05), timber, 0, y + 0.19, inboard);
      return y;
    };
    if (size.masts >= 2) castle(0.02, 0.24, 0.3);
    if (size.masts >= 3) {
      castle(0.02, 0.13, 0.56);
      castle(0.84, 0.97, 0.26);
    }
    // Her rudder, and the lights of the great cabin across her stern where she has one.
    put(new THREE.BoxGeometry(0.05, size.rail * 0.9, 0.2), dark, 0, size.rail * 0.2, stern.z - 0.12);
    if (size.masts >= 2) for (let x = -stern.half * 0.55; x <= stern.half * 0.56; x += stern.half * 0.55) put(new THREE.BoxGeometry(stern.half * 0.34, 0.13, 0.02), lambert("#e9c873"), x, stern.top - 0.2, stern.z - 0.012);
  }

  let lantern: THREE.Vector3 | undefined;
  if (afloat) {
    // ---- her rig: masts, yards with the sails furled along them, shrouds to the rail, a bowsprit, and her colours ----
    const spar = lambert("#3a2414");
    const canvas = lambert("#efe4c8");
    const rope = lambert("#c9b383");
    const tall = size.tall - size.deck;
    for (let k = 0; k < size.masts; k++) {
      const f = size.masts === 1 ? 0.54 : 0.3 + (k * 0.46) / (size.masts - 1);
      const z = (f - 0.5) * size.length;
      // The mainmast (the middle one of three, the after one of two) is the tallest.
      const main = k === Math.floor((size.masts - 1) / 2);
      const h = tall * (main ? 1 : 0.82);
      put(new THREE.CylinderGeometry(0.035, 0.06, h, 6), spar, 0, size.deck + h / 2, z);
      const here = at(stations, size, f);
      for (const [up, wide] of [[0.5, 1.5], [0.82, 1.05]] as const) {
        const y = size.deck + h * up;
        const yard = size.beam * wide;
        put(new THREE.CylinderGeometry(0.022, 0.022, yard, 5).rotateZ(Math.PI / 2), spar, 0, y, z + 0.05);
        // The sail furled along its yard, in a few bunts.
        for (let b = 0; b < 4; b++) put(new THREE.SphereGeometry(1, 5, 4).scale(yard * 0.12, 0.045, 0.05), canvas, (b - 1.5) * yard * 0.22, y - 0.05, z + 0.05);
      }
      // Shrouds: two a side, from under the top down to the rail.
      for (const side of [1, -1]) for (const dz of [-0.22, 0.2]) add(beam(v(0, size.deck + h * 0.78, z), v(side * here.half, here.top, z + dz), 0.012, 0.012, rope));
      if (main) {
        // A top to keep a lookout from, and her pennant over it.
        put(new THREE.CylinderGeometry(0.13, 0.1, 0.1, 7), timber, 0, size.deck + h * 0.66, z);
        const flag = put(new THREE.BoxGeometry(0.34, 0.11, 0.012), lambert("#b9433d"), 0.19, size.deck + h + 0.02, z);
        flag.rotation.y = 0.25;
      }
    }
    add(beam(v(0, stem.top - 0.02, stem.z - 0.25), v(0, stem.top + 0.34, stem.z + size.length * 0.16), 0.045, 0.045, spar));
    // Her forestay, from the head of the foremost mast down to the bowsprit's end.
    const fore = ((size.masts === 1 ? 0.54 : 0.76) - 0.5) * size.length;
    add(beam(v(0, size.deck + tall * 0.74, fore), v(0, stem.top + 0.3, stem.z + size.length * 0.14), 0.012, 0.012, rope));
    // Her stern lantern, on an iron crook over the taffrail.
    const top = stern.top + (size.masts >= 3 ? 0.62 : size.masts >= 2 ? 0.36 : 0.06);
    put(new THREE.BoxGeometry(0.03, 0.26, 0.03), lambert("#2b2a33"), 0, top + 0.13, stern.z + 0.04);
    const lamp = put(new THREE.BoxGeometry(0.09, 0.11, 0.09), new THREE.MeshBasicMaterial({ color: "#ffd77a" }), 0, top + 0.31, stern.z + 0.04);
    lamp.userData.glow = true;
    put(new THREE.ConeGeometry(0.08, 0.06, 4).rotateY(Math.PI / 4), lambert("#2b2a33"), 0, top + 0.4, stern.z + 0.04);
    lantern = v(0, top + 0.31, stern.z + 0.04);
  }

  foldByLook(group);
  return { group, size, ...(lantern ? { lantern } : {}) };
}
