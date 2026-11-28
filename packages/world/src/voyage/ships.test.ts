// The crew's ships: the catalogue, which one a crew sails, how far she goes
// and how many she carries, and mending her hull.

import { describe, expect, it } from "vitest";
import { HULL_PER_WOOD, MAX_PARTY, SHIPS, STARTING_SHIP, checkMend, cleanHull, crewShip, mendCost, nextShip, reachProblem, shipById, shipForRing, shipReaches } from "../index";

const [sloop, brig, galleon] = SHIPS;

describe("the ships", () => {
  it("are a Sloop, a Brig and a Galleon, each bigger, further-reaching and roomier than the last", () => {
    expect(SHIPS.map((s) => s.id)).toEqual(["sloop", "brig", "galleon"]);
    expect(SHIPS.map((s) => [s.deck.cols, s.deck.rows])).toEqual([[3, 8], [3, 10], [3, 12]]);
    expect(SHIPS.map((s) => s.heroes)).toEqual([4, 5, 6]);
    expect(SHIPS.map((s) => s.reach)).toEqual([3, 7, null]);
    for (let i = 1; i < SHIPS.length; i++) {
      for (const k of ["stations", "hull", "hold", "heroes"] as const) expect(SHIPS[i][k], `${SHIPS[i].id} ${k}`).toBeGreaterThan(SHIPS[i - 1][k]);
    }
    // No ship carries more than a map takes.
    for (const s of SHIPS) expect(s.heroes).toBeLessThanOrEqual(MAX_PARTY);
    expect(STARTING_SHIP).toBe(sloop);
    expect(shipById("brig")).toBe(brig);
    expect(shipById("raft")).toBeUndefined();
  });

  it("gives every crew the Sloop, and the best ship it has built after that", () => {
    expect(crewShip([])).toBe(sloop);
    expect(crewShip(["apothecary", "smithy"])).toBe(sloop);
    expect(crewShip(["brig"])).toBe(brig);
    expect(crewShip(["brig", "galleon"])).toBe(galleon);
    // (A Galleon given without the Brig is still a Galleon.)
    expect(crewShip(["galleon"])).toBe(galleon);
    expect(nextShip([])).toBe(brig);
    expect(nextShip(["brig"])).toBe(galleon);
    expect(nextShip(["brig", "galleon"])).toBeNull();
  });

  it("sails only as far out as her reach: the Sloop to ring 3, the Brig to ring 7, the Galleon anywhere", () => {
    expect([1, 3, 4, 7, 8, 400].map((ring) => shipReaches(sloop, ring))).toEqual([true, true, false, false, false, false]);
    expect([1, 3, 4, 7, 8, 400].map((ring) => shipReaches(brig, ring))).toEqual([true, true, true, true, false, false]);
    expect([1, 3, 4, 7, 8, 400].map((ring) => shipReaches(galleon, ring))).toEqual([true, true, true, true, true, true]);
    expect([1, 3, 4, 7, 8, 400].map((ring) => shipForRing(ring).id)).toEqual(["sloop", "sloop", "brig", "brig", "galleon", "galleon"]);
  });

  it("says why a place is out of reach in words a player can act on", () => {
    expect(reachProblem(sloop, 3, "Gull Rock")).toBeNull();
    expect(reachProblem(sloop, 4, "Gull Rock")).toBe("Gull Rock lies too far out for the Sloop: she sails no further than 3 landfalls from the Harbor. The Brig will reach it, once the crew has built her at the works.");
    expect(reachProblem(sloop, 9, "Gull Rock")).toMatch(/The Galleon will reach it/);
    expect(reachProblem(brig, 8, "Gull Rock")).toMatch(/too far out for the Brig: she sails no further than 7 landfalls.*The Galleon will reach it/);
    expect(reachProblem(galleon, 499, "Gull Rock")).toBeNull();
  });
});

describe("a ship's hull", () => {
  it("is sound unless it was stored as something less, and never more than she has", () => {
    expect(cleanHull(sloop, undefined)).toBe(sloop.hull);
    expect(cleanHull(sloop, null)).toBe(sloop.hull);
    expect(cleanHull(sloop, 999)).toBe(sloop.hull);
    expect(cleanHull(sloop, -4)).toBe(0);
    expect(cleanHull(sloop, 12.4)).toBe(12);
  });

  it("is mended with wood: as much as it needs, or as far as the wood goes", () => {
    expect(mendCost(sloop, sloop.hull)).toBe(0);
    expect(mendCost(sloop, sloop.hull - 1)).toBe(1);
    expect(mendCost(sloop, sloop.hull - 2 * HULL_PER_WOOD)).toBe(2);
    expect(checkMend(sloop, sloop.hull, 50)).toEqual({ ok: false, error: "The Sloop's hull is sound: there is nothing to mend." });
    expect(checkMend(sloop, 10, 0)).toEqual({ ok: false, error: "Mending takes wood, and you have none." });
    // Plenty of wood: only what she needs is taken.
    expect(checkMend(sloop, sloop.hull - 12, 50)).toEqual({ ok: true, wood: 3, hull: sloop.hull });
    // Not enough: every piece goes in, and she is the better for it.
    expect(checkMend(sloop, 10, 4)).toEqual({ ok: true, wood: 4, hull: 10 + 4 * HULL_PER_WOOD });
  });
});
