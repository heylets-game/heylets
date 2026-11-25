import { describe, expect, it } from "vitest";
import { at, flatBoard, must, standEnemy as enemy } from "../test/zoneBoard";
import { createZone, growGroups, standInHero } from "./zone";
import { zoneOptions } from "./gen";
import { SITE_IDS } from "./sites";
import type { ZoneOptions, ZoneState } from "./types";

const HEROES = ["ann", "bo", "cy", "di"];
const join = (state: ZoneState, id: string) => must(state, { type: "join", hero: standInHero("qa_paladin", id, 1)! });
const kindsIn = (state: ZoneState, group: string) => state.units.filter((u) => u.side === "enemy" && u.group === group).map((u) => u.kind);
const sorted = (kinds: readonly string[]) => [...kinds].sort();

/** Every kind of map there is: each site laid out, the open caves, and a delve. */
const MAPS: [string, Partial<ZoneOptions>][] = [
  ...SITE_IDS.map((site): [string, Partial<ZoneOptions>] => [site, { site, groups: 4 }]),
  ["caves", { biome: "caves", groups: 4 }],
  ["delve", { biome: "caves", delve: true }],
];

describe("more heroes on a map than it was made for", () => {
  // Every kind of place is made three times over: it takes a while.
  it("makes every band not yet met what a map made for that many would have had", { timeout: 60_000 }, () => {
    for (const [name, more] of MAPS) {
      for (const seed of ["a"]) {
        const made = (party: number) => createZone("G", `${name}-${seed}`, zoneOptions({ size: "medium", biome: "meadow", level: 1, ...more, party }));
        const first = made(1);
        let solo = first;
        for (const id of HEROES) solo = join(solo, id);
        const full = made(4);
        for (const [id, group] of Object.entries(solo.groups)) {
          const label = `${name} ${seed} ${id}`;
          expect(group.bands, label).toHaveLength(4);
          // The band for four keeps everyone the band for one was made with, and is the size a map made for four makes it.
          const one = group.bands![0];
          const four = group.bands![3];
          for (const kind of new Set(one)) expect(four.filter((k) => k === kind).length, label).toBeGreaterThanOrEqual(one.filter((k) => k === kind).length);
          if (full.groups[id]?.bands) expect(four.length, label).toBe(full.groups[id].bands![3].length);
          // What stands there now is that band, but for any the ground had no room for when the map was made.
          const now = kindsIn(solo, id);
          const short = one.length - kindsIn(first, id).length;
          expect(now.length, label).toBe(four.length - short);
        }
      }
    }
  });

  it("is the very band a map made for four has, where nothing about the band is left to the dice", () => {
    for (const [name, more] of MAPS.filter(([n]) => n === "caves" || n === "delve")) {
      for (const seed of ["a", "b", "c"]) {
        const made = (party: number) => createZone("G", `${name}-${seed}`, zoneOptions({ size: "medium", level: 1, groups: 4, ...more, party }));
        let solo = made(1);
        for (const id of HEROES) solo = join(solo, id);
        const full = made(4);
        // Groups are numbered as their enemies are, so they are matched in turn.
        const mine = Object.values(solo.groups);
        Object.values(full.groups).forEach((g, i) => expect(sorted(mine[i].bands![3]), `${name} ${seed} ${i}`).toEqual(sorted(g.bands![3])));
        expect(mine.length).toBe(Object.keys(full.groups).length);
      }
    }
  });

  it("comes to the same whether heroes come one at a time or all at once, and two then four is four", () => {
    const made = () => createZone("G", "keep-a", zoneOptions({ size: "medium", biome: "meadow", level: 1, site: "keep", groups: 4, party: 1 }));
    let oneByOne = made();
    for (const id of HEROES) oneByOne = join(oneByOne, id);
    const atOnce = made();
    for (const id of HEROES) atOnce.units.push({ ...oneByOne.units.find((u) => u.id === id)! });
    growGroups(atOnce);
    for (const id of Object.keys(atOnce.groups)) expect(sorted(kindsIn(atOnce, id)), id).toEqual(sorted(kindsIn(oneByOne, id)));
    expect(oneByOne.sizedFor).toBe(4);
  });

  it("leaves alone a band that is beaten or in a fight, and a map saved before bands knew what they would grow to", () => {
    const state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 1 }, flags: { aiOff: true } });
    const bands = [["bandit"], ["bandit", "archer"], ["bandit", "archer"], ["bandit", "archer", "bandit"]];
    enemy(state, "bandit", at(12, 2), "beaten", { down: true, hp: 0 });
    enemy(state, "bandit", at(5, 6), "fighting");
    enemy(state, "bandit", at(8, 10), "fresh");
    enemy(state, "bandit", at(12, 9), "old");
    for (const g of ["beaten", "fighting", "fresh"]) state.groups[g].bands = bands;
    let s = join(state, "ann");
    s = must(s, { type: "dev", by: "ann", dev: { op: "start_fight" } });
    expect(s.encounter?.order).toContain(s.units.find((u) => u.group === "fighting")!.id);
    expect(s.encounter?.order).not.toContain(s.units.find((u) => u.group === "fresh")!.id);
    s = join(s, "bo");
    expect(s.units.filter((u) => u.group === "beaten" && !u.down)).toEqual([]);
    expect(kindsIn(s, "fighting")).toEqual(["bandit"]);
    expect(kindsIn(s, "fresh")).toEqual(["bandit", "archer"]);
    expect(kindsIn(s, "old")).toEqual(["bandit"]);
    // Two heroes then four: from the band for two to the band for four, not from one again.
    s = join(join(s, "cy"), "di");
    expect(kindsIn(s, "fresh")).toEqual(["bandit", "archer", "bandit"]);
  });

  it("does nothing while no more heroes are on it than it was made for, nor for a hero coming back", () => {
    let state = createZone("G", "keep-a", zoneOptions({ size: "medium", biome: "meadow", level: 1, site: "keep", groups: 4, party: 2 }));
    const before = state.units.filter((u) => u.side === "enemy").length;
    state = join(join(join(state, "ann"), "bo"), "ann");
    expect(state.units.filter((u) => u.side === "enemy").length).toBe(before);
    expect(state.sizedFor).toBeUndefined();
  });
});
