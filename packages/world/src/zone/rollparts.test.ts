import { describe, expect, it } from "vitest";
import { at, flatBoard, inAFight, standEnemy, standHero } from "../test/zoneBoard";
import { posKey } from "@gantt-quest/core";
import { makeRng } from "../rng";
import { addShield, attackRoll, defenceMods, defenceOf, regrow, saveRoll, shieldUnit, type Ctx } from "./engine";
import { AQUEOUS } from "./kit";
import { rollShown, swingsOf } from "./rules";
import type { ZoneEvent, ZoneState } from "./types";

// What of the moment a roll carries (Roll mods, vsMods, advWhy), as the rolls of a real fight make them.

const ctxOf = (state: ZoneState, seed = 7): Ctx => ({ state, rng: makeRng(seed), events: [] as ZoneEvent[], effects: [] });

/** Ann on a rise at (2,6) and a wolf three hexes off at (5,6), both in a fight. `edit` changes the ground under the wolf. */
function setUp(o: { wolfIn?: "forest" } = {}) {
  const annAt = at(2, 6);
  const wolfAt = at(5, 6);
  const state = flatBoard({
    rng: 1, start: annAt,
    edit: (t) => {
      if (posKey(t) === posKey(annAt)) t.elev = 1;
      if (o.wolfIn && posKey(t) === posKey(wolfAt)) t.biome = o.wolfIn;
    },
  });
  const ann = standHero(state, "ann", annAt, { classId: "qa_paladin", level: 1, armor: 0, power: 1, abilities: ["bash"], items: {} });
  const wolf = standEnemy(state, "wolf", wolfAt);
  inAFight(state, ann.id, wolf.id);
  return { state, ann, wolf };
}

describe("what of the moment damage dice carry", () => {
  it("keeps the parts it is given, and leaves out any that add nothing", () => {
    const rolled = rollShown(makeRng(3), { n: 1, d: 8, plus: 0 }, 5, false, [{ name: "Rallied", n: 2 }, { name: "Chorus", n: 0 }]);
    expect(rolled.mods).toEqual([{ name: "Rallied", n: 2 }]);
    expect(rolled.plus).toBe(5);
  });

  it("a heal carries what of the moment it adds: Aqueous Regeneration's tick on one standing in water", () => {
    const { state, ann } = setUp();
    ann.hp = 1;
    ann.conditions.push({ kind: "regenerating", rounds: 2 });
    state.surfaces[posKey(ann.pos)] = { kind: "water", rounds: 3 } as ZoneState["surfaces"][string];
    const ctx = ctxOf(state);
    regrow(ctx, ann);
    const tick = ctx.events.find((e) => e.t === "heal" && e.what === "aqueous_regeneration");
    expect(tick?.t === "heal" && tick.dice?.mods).toEqual([{ name: "In water", n: AQUEOUS.water }]);
  });

  it("a shield's event carries what of the moment is in it, and none when nothing is", () => {
    const { state, ann } = setUp();
    const ctx = ctxOf(state);
    shieldUnit(ctx, ann, 7, [{ name: "In water", n: 2 }, { name: "Foes beside", n: 0 }]);
    addShield(ctx, ann, 3);
    const told = ctx.events.filter((e) => e.t === "condition" && e.kind === "bolstered");
    expect(told.map((e) => e.t === "condition" && e.mods)).toEqual([[{ name: "In water", n: 2 }], undefined]);
  });

  it("carries none when there are none", () => {
    expect(rollShown(makeRng(3), { n: 1, d: 8, plus: 0 }, 3)).not.toHaveProperty("mods");
  });
});

describe("what of the moment a roll carries", () => {
  it("a shot carries its bonuses and penalties, the target's Defence of the moment, and why it had advantage", () => {
    const { state, ann, wolf } = setUp({ wolfIn: "forest" });
    wolf.conditions.push({ kind: "exposed", rounds: 2 }, { kind: "sundered", rounds: 2 });
    const roll = attackRoll(ctxOf(state), ann, wolf, { label: "Shot", bonus: 3, melee: false });
    expect(roll.mods).toEqual([{ name: "High ground", n: 2 }, { name: "Trees", n: -2 }]);
    expect(roll.vsMods?.map((m) => m.name)).toEqual(["Sundered"]);
    expect(roll.advWhy).toEqual(["Exposed"]);
    expect(roll.bonus).toBe(3);
    expect(roll.vs).toBe(defenceOf(wolf, state));
  });

  it("an attack with advantage and disadvantage both rolls plain, and keeps why each", () => {
    const { state, ann, wolf } = setUp();
    wolf.conditions.push({ kind: "exposed", rounds: 2 });
    ann.conditions.push({ kind: "poisoned", rounds: 2 });
    const roll = attackRoll(ctxOf(state), ann, wolf, { label: "Shot", bonus: 3, melee: false });
    expect(roll.adv).toBe(0);
    expect(roll.d20).toHaveLength(1);
    expect(roll.cancelled).toEqual({ adv: ["Exposed"], dis: ["Poisoned"] });
    expect(roll).not.toHaveProperty("advWhy");
  });

  it("a Defence is what it is made of: its base, and what of the moment there is", () => {
    const { state, ann } = setUp();
    const bare = defenceOf(ann, state);
    ann.conditions.push({ kind: "coral_armor", rounds: 2 });
    expect(defenceMods(ann, state)).toEqual([{ name: "Coral Armor", n: 2 }]);
    expect(defenceOf(ann, state)).toBe(bare + 2);
  });

  it("a plain blow carries none of it", () => {
    const { state, ann, wolf } = setUp();
    wolf.pos = at(3, 6);
    state.map.tiles.forEach((t) => (t.elev = 0));
    const roll = attackRoll(ctxOf(state), ann, wolf, { label: "Bash", bonus: 3, melee: true });
    expect(roll).not.toHaveProperty("mods");
    expect(roll).not.toHaveProperty("vsMods");
    expect(roll).not.toHaveProperty("advWhy");
    expect(swingsOf(roll)).toEqual([]);
  });

  it("a save carries Weakened, and a Terror Aura's disadvantage by name", () => {
    const { state, ann } = setUp();
    ann.conditions.push({ kind: "weakened", rounds: 2, amount: 2 });
    const weak = saveRoll(ctxOf(state), ann, "agi", 12, "Resist");
    expect(weak.mods).toEqual([{ name: "Weakened", n: -2 }]);
    const haunt = standEnemy(state, "haunt", at(3, 6));
    inAFight(state, haunt.id);
    const dread = saveRoll(ctxOf(state), ann, "agi", 12, "Resist");
    expect(dread.adv).toBe(-1);
    expect(dread.advWhy).toEqual(["Terror Aura"]);
  });
});
