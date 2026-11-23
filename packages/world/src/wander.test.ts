import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { DAWN, DUSK, GAME_DAY_MS, nightAt, timeOfDay } from "./gameclock";
import { generateHarbor, harborPath, HARBOR_PUB } from "./harbor";
import { tileAt } from "./map";
import { pubPath, pubRoom } from "./pub";
import { REGULARS } from "./regulars";
import { WANDER_STEP_MS, regularAbout, regularsAbout } from "./wander";

const CREW = "CREWAA";
/** A game day that starts at a whole number of days on the clock: its midnight. */
const DAY0 = 2_900_000 * GAME_DAY_MS;
const at = (time: number, day = 0) => DAY0 + (day + time) * GAME_DAY_MS;
const harbor = generateHarbor();
const room = pubRoom();
const door = room.pois.find((p) => p.kind === "door")!.pos;

describe("the Harbor's clock", () => {
  it("runs a ten-minute day, dark at midnight and light at noon, turning at dawn and dusk", () => {
    expect(timeOfDay(DAY0)).toBe(0);
    expect(timeOfDay(DAY0 + GAME_DAY_MS / 2)).toBeCloseTo(0.5);
    expect(nightAt(0)).toBe(1);
    expect(nightAt(0.5)).toBe(0);
    expect(nightAt(DAWN)).toBeCloseTo(0.5, 3);
    expect(nightAt(DUSK)).toBeCloseTo(0.5, 3);
    expect(DAWN).toBeGreaterThan(0.2);
    expect(DUSK).toBeLessThan(0.8);
  });
});

describe("the regulars out and about", () => {
  it("are out in the Harbor by day and in the pub by night", () => {
    for (const r of regularsAbout(CREW, at(0.5))) expect(r.place, r.id).toBe("harbor");
    for (const r of regularsAbout(CREW, at(0.02))) expect(r.place, r.id).toBe("pub");
    for (const r of regularsAbout(CREW, at(0.95))) expect(r.place, r.id).toBe("pub");
    expect(regularsAbout(CREW, at(0.5))).toHaveLength(3);
  });

  it("walk a hex at a time on open ground, and come and go by the pub's door", () => {
    // (Each hex is checked for being somewhere a hero could walk the first time it is stood on: finding a path is slow.)
    const checked = new Set<string>();
    for (const { id } of REGULARS) {
      let last = regularAbout(CREW, id, at(0));
      for (let t = at(0) + 250; t < at(1); t += 250) {
        const now = regularAbout(CREW, id, t);
        if (now.place === last.place) expect(hexDistance(now.pos, last.pos), `${id} at ${t - DAY0}`).toBeLessThanOrEqual(1);
        else {
          // Through the door: from the pub's door to the Harbor's, or back.
          expect(now.place === "harbor" ? last.pos : now.pos, `${id} leaving or coming in`).toEqual(door);
          expect(now.place === "harbor" ? now.pos : last.pos, `${id} at the pub's front door`).toEqual(HARBOR_PUB);
        }
        const spot = `${now.place}|${now.pos.q},${now.pos.r}`;
        if (checked.has(spot)) {
          last = now;
          continue;
        }
        checked.add(spot);
        if (now.place === "harbor") {
          const tile = tileAt(harbor, now.pos)!;
          expect(tile.biome === "water" || tile.biome === "rampart" || !!tile.blocker, `${id} on ${tile.biome}`).toBe(false);
          // Somewhere a hero could walk to.
          expect(!!harborPath(harbor, HARBOR_PUB, now.pos) || (now.pos.q === HARBOR_PUB.q && now.pos.r === HARBOR_PUB.r)).toBe(true);
        } else expect(!!pubPath(room, door, now.pos) || (now.pos.q === door.q && now.pos.r === door.r), `${id} in the pub`).toBe(true);
        last = now;
      }
    }
  });

  it("go somewhere during the day, and stop a while at each place", () => {
    for (const { id } of REGULARS) {
      const seen = new Set<string>();
      let walking = 0;
      let samples = 0;
      for (let t = at(0.3); t < at(0.7); t += WANDER_STEP_MS) {
        const r = regularAbout(CREW, id, t);
        seen.add(`${r.pos.q},${r.pos.r}`);
        if (r.walking) walking++;
        samples++;
      }
      expect(seen.size, id).toBeGreaterThan(10);
      // More standing than walking.
      expect(walking / samples, id).toBeLessThan(0.6);
      expect(walking, id).toBeGreaterThan(0);
    }
  });

  it("are in the same place for everyone, and each crew's keep their own hours", () => {
    const t = at(0.41, 3);
    expect(regularAbout(CREW, "gretta", t)).toEqual(regularAbout(CREW, "gretta", t));
    const elsewhere = [0.31, 0.4, 0.5, 0.6].map((k) => regularAbout("CREWBB", "gretta", at(k, 3)).pos);
    const here = [0.31, 0.4, 0.5, 0.6].map((k) => regularAbout(CREW, "gretta", at(k, 3)).pos);
    expect(elsewhere).not.toEqual(here);
  });
});
