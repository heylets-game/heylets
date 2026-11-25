import { hexDistance } from "@gantt-quest/core";
import { describe, expect, it } from "vitest";
import { BELL_CHANCE, liveBell } from "./bell";
import { siteInside } from "./sites";
import { createZone } from "./zone";
import { zoneOptions } from "./gen";

const make = (seed: string, site: string, groups = 4) => createZone("BELL", seed, zoneOptions({ size: "medium", biome: "meadow", groups, party: 2, site }));

describe("the alarm bell", () => {
  it("is put up in most open places with groups, and is the same every time", () => {
    let bells = 0;
    const seeds = 40;
    for (let i = 0; i < seeds; i++) {
      const a = liveBell(make(`bell-${i}`, "keep"));
      expect(liveBell(make(`bell-${i}`, "keep"))?.pos).toEqual(a?.pos);
      if (a) bells += 1;
    }
    expect(bells / seeds).toBeGreaterThan(BELL_CHANCE - 0.25);
    expect(bells).toBeLessThan(seeds);
  });

  it("stands near the middle of the groups, on open ground, clear of everyone", () => {
    for (let i = 0; i < 30; i++) {
      const state = make(`mid-${i}`, "keep");
      const bell = liveBell(state);
      if (!bell) continue;
      const posts = Object.keys(state.groups).map((g) => state.units.find((u) => u.group === g)!.pos);
      const mid = { q: posts.reduce((n, p) => n + p.q, 0) / posts.length, r: posts.reduce((n, p) => n + p.r, 0) / posts.length };
      const farthest = Math.max(...posts.map((p) => hexDistance(p, mid)));
      expect(hexDistance(bell.pos, mid), `seed ${i}`).toBeLessThanOrEqual(farthest);
      expect(state.units.some((u) => u.pos.q === bell.pos.q && u.pos.r === bell.pos.r), `seed ${i}`).toBe(false);
      // Not beside any enemy.
      expect(Math.min(...state.units.filter((u) => u.side === "enemy").map((u) => hexDistance(u.pos, bell.pos))), `seed ${i}`).toBeGreaterThan(1);
    }
  });

  it("is not put up with a single group, or under a roof or under ground", () => {
    for (let i = 0; i < 20; i++) {
      expect(liveBell(make(`one-${i}`, "keep", 1)), `one ${i}`).toBeUndefined();
      const inside = createZone("BELL", `in-${i}`, zoneOptions({ size: "medium", biome: "meadow", groups: 4, party: 2, site: "citadel" }));
      expect(siteInside(inside.scene!.site)).toBe(true);
      expect(liveBell(inside), `citadel ${i}`).toBeUndefined();
    }
  });
});
