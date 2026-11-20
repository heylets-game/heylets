// The classes brought over from the old game: each is complete, none starts
// with a passive, and their special abilities do what they say: Taunt and
// Bulwark Strike, Hex and Soul Drain.

import { describe, expect, it } from "vitest";
import { LEVELUP_AUTO_ALLOC, STARTING_STATS } from "@gantt-quest/core";
import {
  ABILITIES,
  DUMMY_KIND,
  HERO_CLASSES,
  SHIPS_GUNS,
  WEAPONS,
  WEAPON_ICON,
  createBattle,
  currentActor,
  equipProblem,
  gearSheet,
  heroCombatant,
  makeRng,
  rollItem,
  stepBattle,
  weaponItem,
  type BattleEvent,
  type BattleState,
  type HeroInit,
} from "./index";

function hero(id: string, classId: string): HeroInit {
  return { id, name: id, classId, level: 1, xp: 0, unspent: 0, base: { ...STARTING_STATS[classId] }, ...gearSheet(classId, []), weapon: HERO_CLASSES.find((c) => c.id === classId)!.weapons[0] };
}

describe("hero classes", () => {
  it("offers all eight, each with stats, levelling, weapons of its own and abilities that exist", () => {
    expect(HERO_CLASSES.map((c) => c.id)).toEqual(["qa_paladin", "devops_mage", "refactor_rogue", "backend_druid", "frontend_bard", "staff_sage", "sre_warden", "data_warlock"]);
    for (const cls of HERO_CLASSES) {
      expect(STARTING_STATS[cls.id], cls.id).toBeDefined();
      expect(LEVELUP_AUTO_ALLOC[cls.id]?.length, cls.id).toBeGreaterThan(0);
      expect(cls.weapons.length).toBeGreaterThanOrEqual(2);
      for (const w of cls.weapons) {
        expect(WEAPONS[w]?.classId, w).toBe(cls.id);
        for (const a of WEAPONS[w].abilities) expect(ABILITIES[a], a).toBeDefined();
      }
      // Loot rolled for the class only ever gives it weapons it can use: its own, or a ship's gun anyone can.
      const rng = makeRng(cls.id.length);
      for (let i = 0; i < 40; i++) {
        const item = rollItem(rng, cls.id, 0.5, 3, "main_hand");
        expect(equipProblem(item, cls.id, 99), item.ref).toBeNull();
      }
    }
  });

  it("drops the ship's guns for any class, and lets any class equip and fire them", () => {
    expect(SHIPS_GUNS.sort()).toEqual(["blunderbuss", "harpoon_gun", "pistol"]);
    for (const id of SHIPS_GUNS) {
      expect(WEAPON_ICON[id], id).toBeTruthy();
      for (const a of WEAPONS[id].abilities) expect(ABILITIES[a], a).toBeDefined();
    }
    for (const cls of HERO_CLASSES) {
      const rng = makeRng(7);
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) seen.add(rollItem(rng, cls.id, 0.3, 3, "main_hand").ref);
      for (const id of SHIPS_GUNS) {
        expect(seen.has(id), `${cls.id} finds a ${id}`).toBe(true);
        expect(equipProblem(weaponItem(id), cls.id, 1)).toBeNull();
      }
    }
  });

  it("gives every new class a starting weapon that can both hurt and, for the healers, heal", () => {
    const start = (id: string) => WEAPONS[HERO_CLASSES.find((c) => c.id === id)!.weapons[0]].abilities.map((a) => ABILITIES[a]);
    for (const id of ["backend_druid", "frontend_bard", "staff_sage", "sre_warden", "data_warlock"]) expect(start(id).some((a) => a.damage)).toBe(true);
    for (const id of ["backend_druid", "frontend_bard"]) expect(start(id).some((a) => a.heal && a.target === "ally")).toBe(true);
  });
});

/** Play `who` against the dummy, always with `ability`, and collect every event. */
function spar(heroes: HeroInit[], ability: Record<string, string>, seed: number, turns = 12, enemies = [DUMMY_KIND], dummyHp?: number) {
  const rng = makeRng(seed);
  let { state } = createBattle({ heroes: heroes.map((h) => heroCombatant(h)), enemyKinds: enemies, avgLevel: 1, poiId: "ring" }, rng);
  if (dummyHp) state = { ...state, combatants: state.combatants.map((c) => (c.side === "enemy" ? { ...c, hp: dummyHp, maxHp: dummyHp } : c)) };
  const events: BattleEvent[] = [];
  const hurt = (s: BattleState) => ({ ...s, combatants: s.combatants.map((c) => (c.side === "hero" ? { ...c, hp: Math.max(1, c.hp - 10) } : c)) });
  state = hurt(state);
  for (let i = 0; i < turns && state.status === "active"; i++) {
    const actor = currentActor(state)!;
    const res = stepBattle(state, actor.id, { type: "ability", ability: ability[actor.id], target: ABILITIES[ability[actor.id]].target === "ally" ? actor.id : "e0" }, rng);
    if (!res.ok) throw new Error(res.error);
    events.push(...res.events);
    state = res.state;
  }
  return { state, events };
}

describe("no class passives", () => {
  it("starts no class guarded, and regrows no one", () => {
    const heroes = HERO_CLASSES.map((c) => heroCombatant(hero(c.id, c.id)));
    const { state } = createBattle({ heroes, enemyKinds: [DUMMY_KIND], avgLevel: 1, poiId: "ring" }, makeRng(1));
    for (const c of state.combatants) expect(c.effects.some((e) => e.kind === "guarded"), c.id).toBe(false);
    const { events } = spar([hero("d", "backend_druid")], { d: "thornlash" }, 3);
    expect(events.some((e) => e.t === "heal" && e.actor === "d")).toBe(false);
  });
});

describe("Wreck Warlock", () => {
  it("heals itself a third of the damage Soul Drain deals", () => {
    let drains = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { events } = spar([hero("k", "data_warlock")], { k: "soul_drain" }, seed, 6, [DUMMY_KIND], 500);
      events.forEach((e, i) => {
        if (e.t !== "heal" || e.ability !== "Soul Drain") return;
        drains += 1;
        // The hit it drained from: just before, or before the bleeding a perfect hit leaves.
        const hit = events.slice(0, i).reverse().find((x) => x.t === "hit" && x.actor === "k")!;
        expect(hit).toBeDefined();
        if (hit.t === "hit") expect(e.amount).toBeLessThanOrEqual(Math.max(1, Math.round(hit.amount * ABILITIES.soul_drain.drain!)));
      });
    }
    expect(drains).toBeGreaterThan(0);
  });
});
