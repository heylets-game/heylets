import { describe, expect, it } from "vitest";
import { BESTIARY_KINDS, bestiaryEntry, bestiaryMarks, bestiaryMet, bestiaryProgress, type BestiaryRecord } from "./bestiary";
import { ENEMIES } from "./content";
import { ENEMY_ABILITIES } from "./zone/enemyabilities";
import { enemyHp } from "./zone/kit";
import { hiddenEnemies } from "./zone/light";
import { at, flatBoard, must, standEnemy, standHero } from "./test/zoneBoard";
import type { ZoneEvent, ZoneState } from "./zone/types";

const hero = { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} };

/** Ann and Bo (and `more`) beside two wolves and a level 4 bandit, not yet fighting. */
function board(more: (state: ZoneState) => void = () => {}) {
  const state = flatBoard({ rng: 7, start: at(3, 6), options: { party: 3 } });
  state.aiOff = true;
  standHero(state, "ann", at(3, 6), hero);
  standHero(state, "bo", at(3, 7), hero);
  more(state);
  standEnemy(state, "wolf", at(5, 6));
  standEnemy(state, "wolf", at(5, 7));
  standEnemy(state, "bandit", at(6, 6), "g1", { level: 4 });
  return state;
}

function fight(before: ZoneState) {
  const events: ZoneEvent[] = [];
  const after = must(before, { type: "dev", by: "ann", dev: { op: "start_fight" } }, events);
  return { after, events };
}

const sorted = (marks: ReturnType<typeof bestiaryMarks>) => [...marks].sort((a, b) => `${a.hero}${a.kind}`.localeCompare(`${b.hero}${b.kind}`));

describe("the bestiary", () => {
  it("writes every kind up from the enemy table: its numbers at the level asked, and a line for all it can do", () => {
    expect(BESTIARY_KINDS).toEqual(Object.keys(ENEMIES));
    for (const kind of BESTIARY_KINDS) {
      const e = bestiaryEntry(kind)!;
      expect(e).toMatchObject({ name: ENEMIES[kind].name, hp: ENEMIES[kind].hp, defence: ENEMIES[kind].defence, level: 1 });
      // Every ability it has is on the page, by its own name, with something said of it.
      for (const id of ENEMIES[kind].abilities) expect(e.moves.find((m) => m.id === id), `${kind} ${id}`).toMatchObject({ name: ENEMY_ABILITIES[id].name, text: expect.stringMatching(/\S/) });
    }
    expect(bestiaryEntry("wolf", 5)!.hp).toBe(enemyHp("wolf", 5));
    expect(bestiaryEntry("nothing")).toBeUndefined();
  });

  it("says what an ability does from its own entry", () => {
    const move = (kind: string, id: string) => bestiaryEntry(kind)!.moves.find((m) => m.id === id)!;
    expect(move("wolf", "wolf_lunge").text).toMatch(/damage · leaps from up to 3 hexes off · save or Prone for 1 turn · 2 AP · 2 turns to ready again/);
    expect(move("bandit", "shove").text).toBe("Up close · knocks back 1 hex · 1 AP · 1 turn to ready again");
    expect(move("troll", "regen")).toMatchObject({ passive: true, text: expect.stringMatching(/3 HP.*Burning/) });
    expect(move("haunt", "terror_aura")).toMatchObject({ passive: true });
    expect(move("broodmother", "brood_swarm").text).toMatch(/^Calls to its side: 2 × Spiderling, /);
  });

  it("has the training dummy from the first day, and counts what is met and killed", () => {
    const book = new Map<string, BestiaryRecord>();
    expect(bestiaryMet(book, "dummy")).toBe(true);
    expect(bestiaryMet(book, "wolf")).toBe(false);
    expect(bestiaryProgress(book)).toEqual({ met: 1, of: BESTIARY_KINDS.length, kills: 0 });
    book.set("wolf", { kind: "wolf", faced: 3, kills: 2, topLevel: 2, firstAt: 1 });
    expect(bestiaryMet(book, "wolf")).toBe(true);
    expect(bestiaryProgress(book)).toMatchObject({ met: 2, kills: 2 });
  });

  it("marks everyone in a fight as having faced each enemy in it, once, at the highest level met", () => {
    const before = board();
    const { after, events } = fight(before);
    expect(sorted(bestiaryMarks(before, after, events))).toEqual([
      { hero: "ann", kind: "bandit", level: 4, faced: 1, kills: 0 },
      { hero: "ann", kind: "wolf", level: 1, faced: 2, kills: 0 },
      { hero: "bo", kind: "bandit", level: 4, faced: 1, kills: 0 },
      { hero: "bo", kind: "wolf", level: 1, faced: 2, kills: 0 },
    ]);
    // Nothing more for a step that brings nobody new into it.
    expect(bestiaryMarks(after, after, [])).toEqual([]);
  });

  it("gives everyone in the fight the kill when an enemy goes down, the last of the fight too", () => {
    const { after } = fight(board());
    const wolf = after.units.find((u) => u.kind === "wolf")!;
    const down: ZoneEvent[] = [{ t: "down", id: wolf.id }, { t: "down", id: "ann" }];
    const felled = structuredClone(after);
    felled.units.find((u) => u.id === wolf.id)!.down = true;
    expect(sorted(bestiaryMarks(after, felled, down))).toEqual([
      { hero: "ann", kind: "wolf", level: 1, faced: 0, kills: 1 },
      { hero: "bo", kind: "wolf", level: 1, faced: 0, kills: 1 },
    ]);
    // The blow that ends the fight: there is no fight after it, and the kill still counts.
    const over = structuredClone(felled);
    over.encounter = null;
    expect(bestiaryMarks(after, over, down)).toHaveLength(2);
  });

  it("counts nothing again for one who fled the fight and is back in it, and nothing already down for one who comes late", () => {
    const { after } = fight(board());
    // Ann has fled: out of the order, and on the list of those who did.
    const fled = structuredClone(after);
    fled.encounter!.order = fled.encounter!.order.filter((id) => id !== "ann");
    fled.encounter!.fled = ["ann"];
    expect(bestiaryMarks(fled, after, [])).toEqual([]);
    // Cal walks into it after one wolf has gone down: he faces the other wolf and the bandit.
    const wolf = after.units.find((u) => u.kind === "wolf")!;
    const before = structuredClone(after);
    before.units.find((u) => u.id === wolf.id)!.down = true;
    const late = structuredClone(before);
    standHero(late, "cal", at(2, 5), hero);
    late.encounter!.order.push("cal");
    expect(sorted(bestiaryMarks(before, late, []))).toEqual([
      { hero: "cal", kind: "bandit", level: 4, faced: 1, kills: 0 },
      { hero: "cal", kind: "wolf", level: 1, faced: 1, kills: 0 },
    ]);
  });

  it("does not write up an enemy the dark still hides until the heroes can make it out", () => {
    const dark = (state: ZoneState) => {
      state.options = { ...state.options, biome: "caves" };
    };
    const before = board(dark);
    const { after, events } = fight(before);
    // Whatever the dark hides is left out; when nothing hides it any more, it is faced then.
    const hidden = new Set(hiddenEnemies(after));
    const marks = bestiaryMarks(before, after, events);
    const facedNow = marks.filter((m) => m.hero === "ann").reduce((n, m) => n + m.faced, 0);
    expect(facedNow).toBe(3 - hidden.size);
    const lit = structuredClone(after);
    lit.options = { ...lit.options, biome: "meadow" };
    expect(bestiaryMarks(after, lit, []).filter((m) => m.hero === "ann").reduce((n, m) => n + m.faced, 0)).toBe(hidden.size);
  });

  it("keeps one book for a party, none for a stand-in, and nothing in the combat sandbox", () => {
    const before = board((state) => {
      // Ann's party: two of one account's heroes. And a stand-in Bo plays.
      state.units.find((u) => u.id === "ann")!.party = "ann";
      standHero(state, "ann2", at(2, 6), hero).party = "ann";
      standHero(state, "s1", at(2, 7), { ...hero, controller: "bo" });
    });
    const { after, events } = fight(before);
    const marks = bestiaryMarks(before, after, events);
    expect([...new Set(marks.map((m) => m.hero))].sort()).toEqual(["ann", "bo"]);
    expect(marks.find((m) => m.hero === "ann" && m.kind === "wolf")).toMatchObject({ faced: 2 });
    expect(bestiaryMarks(before, { ...after, sandbox: true }, events)).toEqual([]);
  });
});
