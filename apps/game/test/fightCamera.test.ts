// The camera in a fight (render/fightCamera.ts): following whoever's turn it is, and framing a shot whole.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FightCamera, SHOT_BOX as LENS_BOX, SHOT_LINGER, SHOT_MAX, allInView, centreOn, frameEnds, placeEye, spanOf, type Lens, type ShotEnd } from "../src/client/render/fightCamera";

/** The view as it opens on a battle map: from the south, at the usual tilt, on a wide window. */
const LENS: Lens = { fov: 35, aspect: 16 / 9, yaw: 0, pitch: Math.atan2(0.78, 0.72), reach: Math.hypot(0.72, 0.78) };
const NEAR = 24;
const FAR = 40;

const end = (x: number, z: number): ShotEnd => ({ feet: new THREE.Vector3(x, 0, z), height: 1.4 });

const seenFrom = (at: THREE.Vector3, dist: number, ends: ShotEnd[], lens = LENS) => {
  const cam = new THREE.PerspectiveCamera();
  placeEye(cam, at, dist, lens);
  return allInView(cam, ends);
};

describe("framing a shot", () => {
  it("stays at the player's own zoom when both ends already fit", () => {
    const ends = [end(-2, 0), end(2, 0)];
    const { at, dist } = frameEnds(ends, LENS, NEAR, FAR);
    expect(dist).toBe(NEAR);
    expect(seenFrom(at, dist, ends)).toBe(true);
  });

  it("draws back just far enough to take in both ends", () => {
    const ends = [end(-14, 3), end(12, -6)];
    expect(seenFrom(new THREE.Vector3(-1, 0, -1.5), NEAR, ends)).toBe(false);
    const { at, dist } = frameEnds(ends, LENS, NEAR, FAR);
    expect(dist).toBeGreaterThan(NEAR);
    expect(dist).toBeLessThan(FAR);
    expect(seenFrom(at, dist, ends)).toBe(true);
    // And no further back than that, wherever it looks from there.
    const cam = new THREE.PerspectiveCamera();
    centreOn(cam, at, dist - 0.5, LENS, ends);
    expect(allInView(cam, ends)).toBe(false);
  });

  it("puts both ends in the middle of the clear part of the screen", () => {
    const box = { side: 0.7, top: 0.62, bottom: -0.1 };
    const lens = { ...LENS, box };
    const ends = [end(-6, 4), end(5, -7)];
    const { at, dist } = frameEnds(ends, lens, NEAR, FAR);
    const cam = new THREE.PerspectiveCamera();
    placeEye(cam, at, dist, lens);
    const span = spanOf(cam, ends);
    expect((span.minX + span.maxX) / 2).toBeCloseTo(0, 1);
    expect((span.minY + span.maxY) / 2).toBeCloseTo((box.top + box.bottom) / 2, 1);
    expect(allInView(cam, ends, box)).toBe(true);
  });

  it("draws back further when the panels along the bottom take more of the screen", () => {
    const ends = [end(-3, 6), end(3, -6)];
    const wide = frameEnds(ends, LENS, NEAR, FAR).dist;
    const covered = frameEnds(ends, { ...LENS, box: { ...LENS_BOX, bottom: 0 } }, NEAR, FAR).dist;
    expect(covered).toBeGreaterThan(wide);
  });

  it("takes in more on a tall, narrow window by drawing further back", () => {
    const ends = [end(-9, 0), end(9, 0)];
    const wide = frameEnds(ends, LENS, NEAR, FAR).dist;
    const tall = frameEnds(ends, { ...LENS, aspect: 9 / 16 }, NEAR, FAR).dist;
    expect(tall).toBeGreaterThan(wide);
  });

  it("goes no further back than the map allows", () => {
    const { dist } = frameEnds([end(-80, 0), end(80, 0)], LENS, NEAR, FAR);
    expect(dist).toBe(FAR);
  });
});

describe("the fight camera", () => {
  const goal = new THREE.Vector3(-14, 0, 3);

  it("frames a shot from afar until it lands, a moment more, and then goes back", () => {
    const fight = new FightCamera();
    expect(fight.aim(0, LENS, NEAR, FAR)).toBeNull();
    const landed = fight.shoot(() => [end(-14, 3), end(12, -6)], 0, goal, NEAR, LENS);
    expect(fight.framing).toBe(true);
    const framed = fight.aim(0.5, LENS, NEAR, FAR);
    expect(framed?.dist).toBeGreaterThan(NEAR);
    landed();
    expect(fight.aim(0.5 + SHOT_LINGER / 2, LENS, NEAR, FAR)?.dist).toBeGreaterThan(NEAR);
    const back = fight.aim(0.5 + SHOT_LINGER + 0.01, LENS, NEAR, FAR);
    expect(back?.at.toArray()).toEqual(goal.toArray());
    expect(back?.dist).toBe(NEAR);
    expect(fight.framing).toBe(false);
    expect(fight.aim(2, LENS, NEAR, FAR)).toBeNull();
  });

  it("leaves the view alone for a shot already well on screen", () => {
    const fight = new FightCamera();
    fight.shoot(() => [end(-14, 3), end(-11, 3)], 0, goal, NEAR, LENS);
    expect(fight.framing).toBe(false);
    expect(fight.aim(0.5, LENS, NEAR, FAR)).toBeNull();
  });

  it("frames shots in the air together, and goes back once the last is done", () => {
    const fight = new FightCamera();
    const first = fight.shoot(() => [end(-14, 3), end(12, -6)], 0, goal, NEAR, LENS);
    // Already framing: the second is taken in with it, even though it alone would be on screen.
    const second = fight.shoot(() => [end(-14, 3), end(-11, 3)], 0.1, new THREE.Vector3(), 30, LENS);
    first();
    fight.aim(0.2, LENS, NEAR, FAR);
    expect(fight.aim(0.2 + SHOT_LINGER + 0.01, LENS, NEAR, FAR)?.at.toArray()).not.toEqual(goal.toArray());
    expect(fight.framing).toBe(true);
    second();
    expect(fight.aim(0.3 + SHOT_LINGER * 2, LENS, NEAR, FAR)?.at.toArray()).toEqual(goal.toArray());
  });

  it("gives up on a shot nobody says has landed", () => {
    const fight = new FightCamera();
    fight.shoot(() => [end(-14, 3), end(12, -6)], 0, goal, NEAR, LENS);
    expect(fight.aim(SHOT_MAX - 0.1, LENS, NEAR, FAR)?.dist).toBeGreaterThan(NEAR);
    expect(fight.aim(SHOT_MAX + 0.01, LENS, NEAR, FAR)?.at.toArray()).toEqual(goal.toArray());
  });

  it("lets every shot land when what showed them is cut short", () => {
    const fight = new FightCamera();
    fight.shoot(() => [end(-14, 3), end(12, -6)], 0, goal, NEAR, LENS);
    fight.aim(1, LENS, NEAR, FAR);
    fight.landAll();
    expect(fight.aim(1 + SHOT_LINGER + 0.01, LENS, NEAR, FAR)?.at.toArray()).toEqual(goal.toArray());
  });

  it("follows whoever's turn it is until the player takes the camera, and again once they set off", () => {
    const fight = new FightCamera();
    expect(fight.following).toBe(false);
    fight.watch("goblin");
    expect(fight.following).toBe(true);
    fight.takeOver();
    expect(fight.following).toBe(false);
    // Somebody else setting off does not bring it back.
    fight.setOff("hero");
    expect(fight.following).toBe(false);
    fight.setOff("goblin");
    expect(fight.following).toBe(true);
    // The next turn is followed whatever the player did in this one.
    fight.takeOver();
    fight.watch("hero");
    expect(fight.watched).toBe("hero");
    expect(fight.following).toBe(true);
    fight.watch(null);
    expect(fight.following).toBe(false);
  });

  it("lets go of a shot, without going back, when the player takes the camera", () => {
    const fight = new FightCamera();
    fight.watch("goblin");
    fight.shoot(() => [end(-14, 3), end(12, -6)], 0, goal, NEAR, LENS);
    fight.takeOver();
    expect(fight.framing).toBe(false);
    expect(fight.aim(0.1, LENS, NEAR, FAR)).toBeNull();
  });
});
