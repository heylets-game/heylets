// The crew's ship at her pier, and the slipway where the next one is built.
//
// One place (`ship`, on the pier head a hero boards from) draws both, since
// both are the crew's ships and change together: the ship afloat beyond the
// pier head (which one is `poi.tier`, an index into the world's SHIPS), and
// on the slipway beside the pier the next ship in the catalogue, as far
// built as the crew has paid for her (`poi.fill`). When she is finished the
// crew's ship is that one, the ways stand empty, and the next keel is laid.
// Every ship is drawn by ship.ts from her catalogue entry, so nothing here
// knows one ship from another.

import * as THREE from "three";
import { HARBOR_BERTHS, HARBOR_SLIPWAY, SHIPS } from "@gantt-quest/world";
import type { BuildingGlow } from "../ambience";
import { beam } from "../rowboat";
import { shipModel, shipSize } from "../ship";
import { foldByLook, type PlaceModel } from "./kit";

/** The crew's ship, moored, and the slipway. */
export const ship: PlaceModel = (poi, kit) => {
  const { g, lambert } = kit;
  const index = Math.max(0, Math.min(SHIPS.length - 1, Math.round(poi.tier ?? 0)));
  const def = SHIPS[index];
  const next = SHIPS[index + 1];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const timber = lambert("#7a5634");
  const dark = lambert("#4a3524");
  const pale = lambert("#b5895a");
  const rope = lambert("#c9b383");
  const iron = lambert("#2b2a33");
  /**
   * Two things stand here, and only one of them is the place: the ship at her berth (with her gangplank and her
   * lines) is what a pointer means and what lights up under it; the yard (the slipway and the hull on it) is
   * scenery beside her. What does not move in each is folded into a few meshes at the end.
   */
  const berth = new THREE.Group();
  const yard = new THREE.Group();
  const moored = new THREE.Group();
  const ways = new THREE.Group();
  berth.add(moored);
  yard.add(ways);
  g.add(berth, yard);
  let put = (o: THREE.Object3D) => moored.add(o);

  // ---- the ship afloat: stern to the pier head, bow to the open sea, riding the swell ----
  // (The model's +z is the way the pier runs out: the pier head has no facing, so that is due south.)
  const sea = kit.groundAt(poi, HARBOR_BERTHS[0]).y;
  const afloat = shipModel(def);
  const size = afloat.size;
  const rider = new THREE.Group();
  const sternZ = 1.2;
  rider.position.set(0, sea, sternZ + size.length / 2);
  rider.add(afloat.group);
  berth.add(rider);
  // A gangplank from the planking up over her stern, with a rope rail on one hand.
  const aboard = v(0, sea + size.rail + 0.34, sternZ + 0.12);
  put(beam(v(0, 0.02, 0.62), aboard, 0.34, 0.035, pale));
  for (let k = 1; k < 5; k++) {
    const p = v(0, 0.02, 0.62).lerp(aboard, k / 5);
    put(beam(v(-0.17, p.y + 0.025, p.z), v(0.17, p.y + 0.025, p.z), 0.03, 0.02, timber));
  }
  put(beam(v(0.2, 0.36, 0.62), v(0.2, aboard.y + 0.3, aboard.z), 0.014, 0.014, rope));
  put(beam(v(0.2, 0, 0.62), v(0.2, 0.38, 0.62), 0.04, 0.04, timber));
  // Two bollards at the corners of the pier head, and her stern lines made fast to them.
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.26, 7), iron);
    post.position.set(s * 0.62, 0.13, 0.42);
    put(post);
    put(beam(v(s * 0.62, 0.2, 0.42), v(s * size.beam * 0.3, sea + size.rail + 0.3, sternZ + 0.05), 0.016, 0.016, rope));
  }
  // Riding the swell: a slow heave, a slower roll. (Still, for anyone who asked for less motion.)
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  kit.live.push({
    update(time) {
      if (still) return;
      rider.position.y = sea + Math.sin(time * 0.7) * 0.03;
      rider.rotation.z = Math.sin(time * 0.5) * 0.014;
      rider.rotation.x = Math.sin(time * 0.6 + 1) * 0.008;
    },
    dispose() {},
  });
  const glows: BuildingGlow[] = [];
  if (afloat.lantern) glows.push({ pos: afloat.lantern.clone().add(rider.position), size: 0.5 });

  // ---- the slipway: the ways running down from the quay into the water, and the next hull on them ----
  put = (o) => ways.add(o);
  const slip = kit.groundAt(poi, HARBOR_SLIPWAY);
  const quay = kit.groundAt(poi, { q: HARBOR_SLIPWAY.q, r: HARBOR_SLIPWAY.r - 1 }).y;
  // The ways are as long as the biggest hull there is to build, so the yard is the same yard whoever lies on it.
  const longest = Math.max(...SHIPS.map((s) => shipSize(s).length));
  const head = v(slip.x, Math.max(quay, slip.y) + 0.06, slip.z - 0.8);
  const foot = v(slip.x, slip.y - 0.22, slip.z - 0.8 + longest + 0.9);
  const run = foot.clone().sub(head);
  const slope = Math.atan2(-run.y, run.z);
  const onWays = (along: number) => head.clone().addScaledVector(run, along / run.length());
  for (const s of [-1, 1]) put(beam(v(head.x + s * 0.42, head.y, head.z), v(foot.x + s * 0.42, foot.y, foot.z), 0.12, 0.12, dark));
  // Planked between the ways, so it is a ramp and not a ladder: bare boards, greyed by the tide at the foot.
  put(beam(v(head.x, head.y - 0.05, head.z), v(foot.x, foot.y - 0.05, foot.z), 0.78, 0.04, lambert("#8f7450")));
  for (let d = 0.3; d < run.length(); d += 0.7) {
    const p = onWays(d);
    put(beam(v(p.x - 0.62, p.y - 0.07, p.z), v(p.x + 0.62, p.y - 0.07, p.z), 0.1, 0.08, timber));
    // Piles under every other tie, down into the harbour floor.
    if (Math.round(d / 0.7) % 2 === 0) for (const s of [-1, 1]) put(beam(v(p.x + s * 0.56, p.y - 0.1, p.z), v(p.x + s * 0.56, p.y - 1.3, p.z), 0.09, 0.09, dark));
  }
  // The yard's own clutter on the quay at the head of the ways: a stack of planking, a tar barrel, a coil of line.
  for (let i = 0; i < 4; i++) put(beam(v(head.x - 1.15, head.y + 0.02 + i * 0.05, head.z - 0.5), v(head.x - 1.15 + 0.06 * i, head.y + 0.02 + i * 0.05, head.z + 0.75), 0.3 - i * 0.03, 0.045, i % 2 ? pale : timber));
  {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.3, 8), dark);
    barrel.position.set(head.x + 1.0, head.y + 0.1, head.z - 0.25);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 4, 10).rotateX(Math.PI / 2), rope);
    coil.position.set(head.x + 0.95, head.y - 0.02, head.z + 0.3);
    put(barrel);
    put(coil);
  }
  const fill = Math.max(0, Math.min(1, poi.fill ?? 0));
  if (next) {
    const building = shipSize(next);
    const depth = 0.3 + building.beam * 0.1;
    // Her stern at the head of the ways, her bow toward the water, lying to the slope with her keel on the blocks.
    const cradle = new THREE.Group();
    const mid = onWays(0.5 + building.length / 2);
    cradle.position.set(mid.x, mid.y + depth + 0.16, mid.z);
    cradle.rotation.x = slope;
    yard.add(cradle);
    // Keel blocks along the ways, there from the day the ways are cleared for her.
    for (let d = 0.6; d < building.length; d += 0.8) {
      const p = onWays(0.5 + d);
      put(beam(v(p.x - 0.2, p.y + 0.05, p.z), v(p.x + 0.2, p.y + 0.05, p.z), 0.16, 0.1, pale));
    }
    if (fill > 0) {
      cradle.add(shipModel(next, { built: fill }).group);
      // Shores against her bilges, each side, and a builder's ladder up to her rail once her sides are planked.
      for (let k = 0; k < 3; k++) {
        const z = (k - 1) * building.length * 0.28;
        for (const s of [-1, 1]) cradle.add(beam(v(s * (building.beam / 2 + 0.55), -depth - 0.12, z), v(s * building.beam * 0.4, -depth * 0.2, z), 0.06, 0.06, timber));
      }
      if (fill >= 0.34) {
        const x = building.beam / 2 + 0.2;
        for (const dz of [-0.13, 0.13]) cradle.add(beam(v(x + 0.35, -depth - 0.1, dz), v(x - 0.12, building.rail + 0.15, dz), 0.03, 0.03, pale));
        for (let r = 1; r < 6; r++) {
          const p = v(x + 0.35, -depth - 0.1, 0).lerp(v(x - 0.12, building.rail + 0.15, 0), r / 6);
          cradle.add(beam(v(p.x, p.y, -0.13), v(p.x, p.y, 0.13), 0.025, 0.025, pale));
        }
      }
      // Scaffold poles standing round her while she is in frame.
      if (fill < 0.67) for (const s of [-1, 1]) for (const f of [-0.3, 0.3]) cradle.add(beam(v(s * (building.beam / 2 + 0.3), -depth - 0.15, f * building.length), v(s * (building.beam / 2 + 0.3), building.rail + 0.5, f * building.length), 0.045, 0.045, dark));
      foldByLook(cradle);
    }
  }

  foldByLook(moored);
  foldByLook(ways);
  g.userData.glows = glows;
  // Pointing anywhere on her, or on the gangplank, is pointing at the pier head she is boarded from; and she is
  // what lights up under the pointer. The yard answers no pointer: what is behind it is what is pointed at.
  g.userData.door = poi.pos;
  g.userData.lit = berth;
  yard.traverse((o) => {
    o.raycast = () => {};
  });
};
