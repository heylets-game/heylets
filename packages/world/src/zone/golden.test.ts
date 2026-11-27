import { describe, expect, it } from "vitest";
import type { HexPos } from "@gantt-quest/core";
import { posKey } from "@gantt-quest/core";
import { at, flatBoard, must, standEnemy, standHero, unit } from "../test/zoneBoard";
import { ABILITIES, ENEMIES } from "../content";
import type { Tile } from "../map";
import { makeRng } from "../rng";
import { checkAbility, enemyAct, resolveAbility, type Aim } from "./combat";
import { ENEMY_ABILITIES } from "./enemyabilities";
import type { Ctx } from "./engine";
import { TACTICS, abilityStrikes } from "./kit";
import type { Condition, Unit, ZoneEvent, ZoneState } from "./types";

// Golden recordings: what every ability and every kind of enemy does, in full, with fixed dice, so that a change
// to how combat is written can be proved to change nothing (or to change exactly what it meant to). A snapshot that
// moves means the rules moved. Do not update one without reading its whole diff.

const hero = { classId: "qa_paladin", level: 3, armor: 0, power: 1, abilities: ["bash"], items: {} };

/** What is left of a step, small and stable: every unit, and every surface. */
function summary(state: ZoneState) {
  return {
    units: [...state.units]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((u) => ({ id: u.id, pos: u.pos, hp: u.hp, down: u.down, conditions: u.conditions.map((c) => [c.kind, c.rounds, c.amount ?? null]) })),
    surfaces: Object.keys(state.surfaces).sort().map((k) => [k, state.surfaces[k].kind]),
  };
}
const record = (events: ZoneEvent[], state: ZoneState) => ({ events, ...summary(state) });

/** Everyone with plenty of hit points, so that nobody dies part-way and cuts a recording short. */
const sturdy = (u: Unit): Unit => Object.assign(u, { hp: 900, maxHp: 900 });

type Edit = (tile: Tile) => void;
const on = (hexes: HexPos[], change: Partial<Tile>): Edit => (t) => {
  if (hexes.some((p) => p.q === t.q && p.r === t.r)) Object.assign(t, change);
};

/** A flat board in a fight, started: three heroes by the left, whoever `more` stands. */
function scene(o: { edit?: Edit; gone?: HexPos[]; aiOff?: boolean; more: (state: ZoneState) => void }): ZoneState {
  let state = flatBoard({ rng: 12345, start: at(2, 6), options: { party: 3 }, flags: { shareTurns: true }, edit: o.edit, gone: o.gone });
  if (o.aiOff !== false) state.aiOff = true;
  o.more(state);
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  return state;
}

const ctxFor = (state: ZoneState, seed: number): Ctx => ({ state: structuredClone(state), rng: makeRng(seed), events: [], effects: [] });
const SEEDS = [1, 2, 3];
/** More dice for the cases that need a hit to show anything. */
const MORE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

// ---------- Part A: every enemy ability ----------

describe("golden A: enemy abilities", () => {
  for (const id of Object.keys(ENEMY_ABILITIES).filter((k) => !ENEMY_ABILITIES[k].aura)) {
    it(id, () => {
      const kind = Object.keys(ENEMIES).find((k) => ENEMIES[k].abilities.includes(id)) ?? "brute";
      const out = SEEDS.map((seed) => {
        let enemyId = "";
        const state = scene({
          more: (s) => {
            for (const [hid, pos] of [["ann", at(5, 6)], ["bob", at(4, 6)], ["cal", at(5, 5)]] as const) sturdy(standHero(s, hid, pos, hero));
            enemyId = standEnemy(s, kind, at(6, 6), "g1", { hp: 900, maxHp: 900 }).id;
          },
        });
        const ctx = ctxFor(state, seed);
        const strike = abilityStrikes([id], 3)[0];
        const ann = unit(ctx.state, "ann");
        enemyAct(ctx, unit(ctx.state, enemyId), strike, ann, ann.pos);
        return record(ctx.events, ctx.state);
      });
      expect(out).toMatchSnapshot();
    });
  }
});

// ---------- Part B: every hero ability ----------

describe("golden B: hero abilities", () => {
  for (const id of Object.keys(ABILITIES).filter((k) => TACTICS[k])) {
    it(id, () => {
      const out = SEEDS.map((seed) => {
        let firstEnemy = "";
        const state = scene({
          more: (s) => {
            sturdy(standHero(s, "ann", at(4, 6), { ...hero, abilities: [id] }));
            sturdy(standHero(s, "bob", at(3, 6), hero));
            firstEnemy = standEnemy(s, "bandit", at(5, 6), "g1", { hp: 900, maxHp: 900 }).id;
            standEnemy(s, "bandit", at(6, 6), "g1", { hp: 900, maxHp: 900 });
            standEnemy(s, "bandit", at(5, 7), "g1", { hp: 900, maxHp: 900 });
          },
        });
        const ctx = ctxFor(state, seed);
        const ann = unit(ctx.state, "ann");
        const first = unit(ctx.state, firstEnemy);
        const tries: Aim[] = [{ target: first.id }, { at: first.pos }, { target: "bob", at: at(4, 7) }, { target: "ann" }, { at: at(4, 8) }];
        const aim = tries.find((a) => checkAbility(ctx.state, ann, id, a) === null);
        if (!aim) return { aim: "no aim", why: checkAbility(ctx.state, ann, id, tries[0]) };
        resolveAbility(ctx, ann, id, aim);
        return { aim, ...record(ctx.events, ctx.state) };
      });
      expect(out).toMatchSnapshot();
    });
  }
});

// ---------- Part C: whole enemy turns, AI on ----------

/** Play three rounds, ending every hero's turn as it comes, and keep everything that happened. */
function play(state: ZoneState, rounds = 3): { events: ZoneEvent[]; state: ZoneState } {
  const events: ZoneEvent[] = [];
  for (let i = 0; i < 60 && state.encounter && state.encounter.round <= rounds; i++) {
    const enc = state.encounter;
    const mine = enc.acting.find((id) => unit(state, id).side === "hero" && !enc.done.includes(id));
    state = mine ? must(state, { type: "end_turn", by: mine, unit: mine }, events) : must(state, { type: "timeout" }, events);
  }
  return { events, state };
}

describe("golden C: enemy turns with the AI on", () => {
  for (const kind of Object.keys(ENEMIES).filter((k) => k !== "dummy")) {
    it(kind, () => {
      const state = scene({
        aiOff: false,
        more: (s) => {
          for (const [hid, pos] of [["ann", at(5, 6)], ["bob", at(4, 6)], ["cal", at(5, 5)]] as const) sturdy(standHero(s, hid, pos, hero));
          standEnemy(s, kind, at(9, 6));
          standEnemy(s, kind, at(9, 4));
        },
      });
      const done = play(state);
      expect(record(done.events, done.state)).toMatchSnapshot();
    });
  }
});

// ---------- Part D: the ground matters ----------

describe("golden D: terrain, pushes, falls, wet", () => {
  /** An enemy using one of its own abilities on Ann, with the ground as `edit` and `gone` make it. */
  const enemyOn = (id: string, kind: string, o: { edit?: Edit; gone?: HexPos[]; extra?: (s: ZoneState) => void } = {}) => () => {
    const out = SEEDS.map((seed) => {
      let enemyId = "";
      const state = scene({
        edit: o.edit,
        gone: o.gone,
        more: (s) => {
          sturdy(standHero(s, "ann", at(5, 6), hero));
          sturdy(standHero(s, "bob", at(4, 7), hero));
          enemyId = standEnemy(s, kind, at(6, 6), "g1", { hp: 900, maxHp: 900 }).id;
          o.extra?.(s);
        },
      });
      const ctx = ctxFor(state, seed);
      const ann = unit(ctx.state, "ann");
      enemyAct(ctx, unit(ctx.state, enemyId), abilityStrikes([id], 3)[0], ann, ann.pos);
      return record(ctx.events, ctx.state);
    });
    expect(out).toMatchSnapshot();
  };

  it("a shove with a drop behind", enemyOn("shove", "brute", { edit: on([at(5, 6)], { elev: 3 }) }));
  it("a shove into a pit-free open hex", enemyOn("shove", "brute"));
  it("stone fist into a wall", enemyOn("stone_fist", "guardian", { gone: [at(4, 6)] }));
  it("battering ram across open ground", enemyOn("battering_ram", "brute"));
  it("battering ram over an edge", enemyOn("battering_ram", "brute", { edit: on([at(3, 6), at(2, 6)], { elev: -2 }) }));

  /** Ann using `id`, with bandits at (5,6) and (6,6) and one Wet at (5,7); `edit` shapes the ground. */
  const heroUses = (id: string, o: { edit?: Edit; aim?: (first: Unit) => Aim; prep?: (s: ZoneState) => void; kind?: string; seeds?: number[]; firstAt?: HexPos } = {}) => () => {
    const out = (o.seeds ?? SEEDS).map((seed) => {
      let first = "";
      const state = scene({
        edit: o.edit,
        more: (s) => {
          sturdy(standHero(s, "ann", at(4, 6), { ...hero, abilities: [id] }));
          sturdy(standHero(s, "bob", at(3, 6), hero));
          first = standEnemy(s, o.kind ?? "bandit", o.firstAt ?? at(5, 6), "g1", { hp: 900, maxHp: 900 }).id;
          standEnemy(s, o.kind ?? "bandit", o.firstAt ? at(6, 7) : at(6, 6), "g1", { hp: 900, maxHp: 900 });
          o.prep?.(s);
        },
      });
      const ctx = ctxFor(state, seed);
      const ann = unit(ctx.state, "ann");
      const aim = o.aim ? o.aim(unit(ctx.state, first)) : { target: first };
      const bad = checkAbility(ctx.state, ann, id, aim);
      if (bad) return { bad };
      resolveAbility(ctx, ann, id, aim);
      return record(ctx.events, ctx.state);
    });
    expect(out).toMatchSnapshot();
  };

  it("a peal knocks an enemy back", heroUses("peal"));
  it("a bellows blast knocks them back", heroUses("bellows_blast", { aim: (f) => ({ at: f.pos }) }));
  it("a pike drags an enemy", heroUses("throw_pike", { aim: (f) => ({ target: f.id }), prep: (s) => { standEnemy(s, "bandit", at(8, 6), "g1", { hp: 900, maxHp: 900 }); } }));
  it("a pike drags a far enemy over an edge", heroUses("harpoon_shot", { aim: (f) => ({ target: f.id }), edit: on([at(5, 6)], { elev: -2 }) }));
  it("a pike drags a far enemy in, more dice", heroUses("throw_pike", { seeds: MORE_SEEDS, firstAt: at(8, 6) }));
  it("a harpoon drags a far enemy over an edge, more dice", heroUses("harpoon_shot", { seeds: MORE_SEEDS, firstAt: at(8, 6), edit: on([at(6, 6)], { elev: -2 }) }));
  it("chain lightning on the Wet", heroUses("chain_lightning", { seeds: MORE_SEEDS, prep: (s) => { for (const u of s.units) if (u.side === "enemy") u.conditions.push({ kind: "wet", rounds: 3 }); } }));
  it("a shock on the Wet", heroUses("shock", { seeds: MORE_SEEDS, prep: (s) => { for (const u of s.units) if (u.side === "enemy") u.conditions.push({ kind: "wet", rounds: 3 }); } }));
  it("a tidal wave on the Wet", heroUses("tidal_wave", { seeds: MORE_SEEDS, aim: (f) => ({ at: f.pos }), prep: (s) => { for (const u of s.units) if (u.side === "enemy") u.conditions.push({ kind: "wet", rounds: 3 }); } }));
});

// ---------- Part E: what of the moment goes into rolls, dice, heals and shields ----------

describe("golden E: the parts of the moment", () => {
  const wet = { kind: "wet", rounds: 3 } as const;
  /** A hero using `id`, with these conditions on whoever; the seeds as ever. */
  const run = (id: string, o: { hero?: Condition[]; foe?: Condition[]; ally?: boolean; bard?: boolean; water?: boolean; aim?: (f: Unit) => Aim; kind?: string; hurt?: boolean; edit?: Edit; seeds?: number[] }) => () => {
    const out = (o.seeds ?? SEEDS).map((seed) => {
      let first = "";
      const state = scene({
        edit: o.edit,
        more: (s) => {
          const ann = sturdy(standHero(s, "ann", at(4, 6), { ...hero, abilities: [id] }));
          if (o.hurt) ann.hp = 5;
          for (const k of o.hero ?? []) ann.conditions.push({ kind: k, rounds: 3 });
          sturdy(standHero(s, "bob", at(3, 6), hero));
          if (o.bard) standHero(s, "bard", at(3, 5), { ...hero, classId: "frontend_bard" }).kind = "frontend_bard";
          const f = standEnemy(s, o.kind ?? "bandit", at(5, 6), "g1", { hp: 900, maxHp: 900 });
          first = f.id;
          for (const k of o.foe ?? []) f.conditions.push({ kind: k, rounds: 3 });
          standEnemy(s, o.kind ?? "bandit", at(6, 6), "g1", { hp: 900, maxHp: 900 });
          if (o.water) s.surfaces[posKey(at(4, 6))] = { kind: "water", rounds: 3 } as ZoneState["surfaces"][string];
        },
      });
      const ctx = ctxFor(state, seed);
      const ann = unit(ctx.state, "ann");
      const aim = o.aim ? o.aim(unit(ctx.state, first)) : { target: first };
      const bad = checkAbility(ctx.state, ann, id, aim);
      if (bad) return { bad };
      resolveAbility(ctx, ann, id, aim);
      return record(ctx.events, ctx.state);
    });
    expect(out).toMatchSnapshot();
  };

  it("advantage and disadvantage cancel", run("bash", { hero: ["poisoned"], foe: ["exposed"] }));
  it("a Bard's tune near", run("bash", { bard: true }));
  it("Rallied", run("bash", { hero: ["rallied"] }));
  it("lightning on one who is Wet", run("lightning_strike", { foe: ["wet"], seeds: MORE_SEEDS }));
  it("a shield in water", run("bulwark_strike", { water: true }));
  it("Stand Strong with foes beside", run("stand_strong", { aim: () => ({ target: "ann" }) }));
  it("a heal in water", run("aqueous_regeneration", { water: true, hurt: true, aim: () => ({ target: "ann" }) }));
  it("a Prone boss catching the edge", run("peal", { kind: "great_bear", foe: ["prone"], edit: on([at(5, 6)], { elev: 3 }) }));
});
