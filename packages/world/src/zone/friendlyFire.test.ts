import { describe, expect, it } from "vitest";
import { hexNeighbors, posKey, type HexPos } from "@gantt-quest/core";
import { GRID, at, flatBoard, standEnemy as enemy, standHero } from "../test/zoneBoard";
import { enemyStrikes } from "./kit";
import { BEHAVIOURS } from "./behaviours";
import { spreadHexes } from "./combat";
import { covers } from "./geometry";
import { clusterHexes } from "./weather";
import type { Unit, ZoneState } from "./types";

// A Cultist's Immolate lands on a clump of four hexes and leaves fire on all of them, which burns its own side as much
// as anyone's. It is aimed so as to keep its allies out of the fire, unless the gain is plain.

const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };
const immolate = enemyStrikes("cultist", 1).find((s) => s.name === "Immolate")!;
const cultAt = at(3, 6);

function board(heroes: HexPos[], allies: HexPos[]) {
  const state = flatBoard({ rng: 1, start: at(1, 1) });
  state.aiOff = true;
  const cultist = enemy(state, "cultist", cultAt);
  const targets = heroes.map((p, i) => Object.assign(standHero(state, `h${i}`, p, hero), { hp: 900, maxHp: 900 }));
  const own = allies.map((p) => enemy(state, "skeleton", p));
  return { state, cultist, targets, own };
}

/** Where it would throw it, and who of each side that clump covers. */
function thrown(state: ZoneState, cultist: Unit, targets: Unit[], own: Unit[]) {
  const use = BEHAVIOURS.strike.value({ state, enemy: cultist } as never, cultist.pos, immolate, targets);
  if (!use?.at) return null;
  const hexes = spreadHexes(state, immolate.kit, cultist.pos, use.at)!;
  const on = (us: Unit[]) => us.filter((u) => hexes.some((p) => covers(u, p))).length;
  return { heroes: on(targets), allies: on(own) };
}

describe("Immolate's fire and the Cultist's own side", () => {
  it("keeps an ally beside its target out of the fire", () => {
    // Where it throws with nobody of its own about; then an ally stands on one of those hexes, beside the hero.
    const alone = board([at(7, 6)], []);
    const use = BEHAVIOURS.strike.value({ state: alone.state, enemy: alone.cultist } as never, cultAt, immolate, alone.targets)!;
    const spot = spreadHexes(alone.state, immolate.kit, cultAt, use.at!)!.find((p) => posKey(p) !== posKey(at(7, 6)))!;
    const { state, cultist, targets, own } = board([at(7, 6)], [spot]);
    expect(thrown(state, cultist, targets, own)).toEqual({ heroes: 1, allies: 0 });
  });

  it("will not burn an ally for one hero", () => {
    const ann = at(7, 6);
    const { state, cultist, targets, own } = board([ann], hexNeighbors(ann, GRID));
    expect(thrown(state, cultist, targets, own)).toBeNull();
  });

  it("will for three heroes packed together, when one ally is all it costs", () => {
    // Three heroes on three hexes of a clump it can throw, allies all round them: the fourth hex of it among them.
    const clump = clusterHexes(flatBoard({ rng: 1, start: at(1, 1) }), cultAt, at(7, 6), 4);
    const three = clump.slice(0, 3);
    const keys = new Set(three.map(posKey));
    const round = [...new Map(three.flatMap((p) => hexNeighbors(p, GRID)).filter((p) => !keys.has(posKey(p))).map((p) => [posKey(p), p])).values()];
    const { state, cultist, targets, own } = board(three, round);
    expect(thrown(state, cultist, targets, own)).toEqual({ heroes: 3, allies: 1 });
  });
});
