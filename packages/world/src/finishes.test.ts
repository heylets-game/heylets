import { describe, expect, it } from "vitest";
import {
  BARE_FINISH,
  DECORATOR,
  FINISHES,
  FINISH_STOCK,
  FINISHES_STALL,
  FINISH_KINDS,
  HARBOR_BUILDINGS,
  HARBOR_FINISHES,
  HARBOR_SHOP,
  TALK_VOICES,
  DAWN,
  DUSK,
  GAME_DAY_MS,
  cleanFinish,
  decoratorOpen,
  decoratorOpensAt,
  decoratorTalk,
  harborSky,
  finishBuyProblem,
  finishDay,
  finishStock,
  nextFinishDay,
  finishById,
  finishSetProblem,
  finishesOf,
  floorLook,
  footing,
  generateHarbor,
  harborDoor,
  roofColor,
  tileAt,
  wallLook,
} from "./index";

describe("the finishes catalogue", () => {
  it("has unique ids, each kind stocked, and prices with the furniture's", () => {
    expect(new Set(FINISHES.map((f) => f.id)).size).toBe(FINISHES.length);
    for (const kind of FINISH_KINDS) expect(finishesOf(kind).length).toBeGreaterThanOrEqual(6);
    for (const f of FINISHES) {
      expect(f.price).toBeGreaterThanOrEqual(20);
      expect(f.price).toBeLessThan(150);
      expect(f.id.startsWith(`${f.kind}_`)).toBe(true);
    }
  });

  it("prices a roof above the cheapest floor", () => {
    const cheapest = (kind: "wall" | "floor" | "roof") => Math.min(...finishesOf(kind).map((f) => f.price));
    expect(cheapest("roof")).toBeGreaterThan(cheapest("floor"));
  });

  it("gives every finish colours to draw it with", () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const f of FINISHES) {
      const colours = f.kind === "wall" ? [f.look.ground, f.look.ink, f.look.dado, f.look.timber].filter(Boolean) : f.kind === "floor" ? [...f.look.tones, f.look.gap] : [f.look.color];
      for (const c of colours) expect(c).toMatch(hex);
    }
  });

  it("looks a finish up by kind", () => {
    expect(wallLook("wall_red_damask")?.pattern).toBe("damask");
    expect(wallLook("floor_walnut")).toBeUndefined();
    expect(floorLook("floor_checker")?.pattern).toBe("tiles");
    expect(roofColor("roof_brick")).toBe("#a3402f");
    expect(roofColor(null)).toBeUndefined();
    expect(finishById("nope")).toBeUndefined();
  });
});

describe("buying a finish", () => {
  const all = FINISHES.map((f) => f.id);
  it("sells what is in the catalogue, once, to whoever can pay", () => {
    const roof = finishById("roof_plum")!;
    expect(finishBuyProblem("roof_plum", [], roof.price, all)).toBeNull();
    expect(finishBuyProblem("roof_plum", [], roof.price - 1, all)).toMatch(/gold/);
    expect(finishBuyProblem("roof_plum", ["roof_plum"], 999, all)).toMatch(/already/);
    expect(finishBuyProblem("roof_gold", [], 999, all)).toMatch(/doesn't sell/);
    expect(finishBuyProblem(7, [], 999, all)).toMatch(/doesn't sell/);
  });

  it("sells only what Nell has out today", () => {
    expect(finishBuyProblem("wall_shell", [], 999, ["roof_plum"])).toMatch(/out today/);
    expect(finishBuyProblem("wall_shell", [], 999, ["wall_shell"])).toBeNull();
  });
});

describe("Nell's table, day by day", () => {
  const days = Array.from({ length: 60 }, (_, i) => finishDay(Date.UTC(2026, 10, 1) + i * 86_400_000));

  it("has twice the wallpapers and floors she lays out on any one day, and every roof", () => {
    expect(finishesOf("wall")).toHaveLength(16);
    expect(finishesOf("floor")).toHaveLength(18);
    expect(FINISH_STOCK).toEqual({ wall: 8, floor: 9, roof: finishesOf("roof").length });
    for (const day of days) {
      const stock = finishStock(day);
      for (const kind of ["wall", "floor", "roof"] as const) expect(stock.filter((id) => finishById(id)!.kind === kind)).toHaveLength(FINISH_STOCK[kind]);
    }
  });

  it("is the same all day for everyone, and changes from one day to the next", () => {
    expect(finishStock("2026-11-23")).toEqual(finishStock("2026-11-23"));
    expect(finishDay(Date.UTC(2026, 10, 23, 0, 0))).toBe(finishDay(Date.UTC(2026, 10, 23, 23, 59)));
    for (let i = 1; i < days.length; i++) expect(finishStock(days[i])).not.toEqual(finishStock(days[i - 1]));
  });

  it("brings every pattern out within a few weeks", () => {
    const seen = new Set(days.slice(0, 21).flatMap(finishStock));
    expect([...seen].sort()).toEqual(FINISHES.map((f) => f.id).sort());
  });

  it("turns over at midnight UTC", () => {
    expect(nextFinishDay(Date.UTC(2026, 10, 23, 15, 30))).toBe(Date.UTC(2026, 10, 24));
    expect(nextFinishDay(Date.UTC(2026, 10, 30, 23, 59))).toBe(Date.UTC(2026, 11, 1));
  });
});

describe("dressing a hut", () => {
  it("takes only a finish you own, of the right kind", () => {
    expect(finishSetProblem("wall", "wall_shell", ["wall_shell"])).toBeNull();
    expect(finishSetProblem("wall", "wall_shell", [])).toMatch(/Buy it/);
    expect(finishSetProblem("floor", "wall_shell", ["wall_shell"])).toMatch(/not for the floor/);
    expect(finishSetProblem("ceiling", "wall_shell", ["wall_shell"])).toMatch(/Walls, floor or roof/);
    expect(finishSetProblem("roof", "roof_none", ["roof_none"])).toMatch(/no such/);
  });

  it("always lets a finish come off again", () => {
    for (const kind of FINISH_KINDS) expect(finishSetProblem(kind, null, [])).toBeNull();
  });

  it("drops anything stored that is no longer sold, or is in the wrong place", () => {
    expect(cleanFinish({ wall: "wall_shell", floor: "roof_tar", roof: "roof_gone" })).toEqual({ wall: "wall_shell", floor: null, roof: null });
    expect(cleanFinish({})).toEqual(BARE_FINISH);
  });
});

describe("Nell's stall", () => {
  it("stands on the quay beside the market stall, with her counter behind where you stand", () => {
    const b = HARBOR_BUILDINGS.find((x) => x.id === "finishes")!;
    expect(b.door).toEqual(HARBOR_FINISHES);
    expect(footing(b.door, b.shape, b.facing)).toEqual([FINISHES_STALL]);
    expect(harborDoor(FINISHES_STALL)).toEqual(HARBOR_FINISHES);
    // Along the quay from the market stall's doorstep, a hex clear of the market stall itself.
    expect(HARBOR_FINISHES.r).toBe(HARBOR_SHOP.r);
    expect(HARBOR_FINISHES.q - HARBOR_SHOP.q).toBe(3);
    const map = generateHarbor();
    expect(tileAt(map, FINISHES_STALL)!.built).toBeTruthy();
    expect(tileAt(map, HARBOR_FINISHES)!.built).toBeFalsy();
    expect(map.pois.find((p) => p.id === "finishes")?.pos).toEqual(HARBOR_FINISHES);
  });

  it("has her talk open her catalogue", () => {
    const talk = decoratorTalk();
    expect(talk.unit).toBe(DECORATOR.id);
    expect(talk.voice).toBe(TALK_VOICES[DECORATOR.id]);
    expect(talk.choices.find((c) => c.opens === "finishes")).toBeTruthy();
    expect(talk.choices.some((c) => c.bye)).toBe(true);
  });
});

describe("Nell's hours", () => {
  // A whole number of Harbor days from the epoch, so a time of day t is at day + t * GAME_DAY_MS.
  const day = 1_000 * GAME_DAY_MS;
  const at = (t: number) => day + Math.round(t * GAME_DAY_MS);

  it("she is at her stall by day and gone at night, by the same line the sky is drawn by", () => {
    expect(decoratorOpen(at(0.5))).toBe(true);
    expect(decoratorOpen(at(DAWN + 0.01))).toBe(true);
    expect(decoratorOpen(at(DUSK - 0.01))).toBe(true);
    expect(decoratorOpen(at(DUSK + 0.01))).toBe(false);
    expect(decoratorOpen(at(0))).toBe(false);
    expect(decoratorOpen(at(DAWN - 0.01))).toBe(false);
    for (let t = 0; t < 1; t += 0.01) expect(decoratorOpen(at(t))).toBe(!harborSky(at(t)).night);
  });

  it("she is back at the coming dawn: later the same Harbor day before it, the next one after dusk", () => {
    expect(decoratorOpensAt(at(0.5))).toBe(at(0.5));
    const before = decoratorOpensAt(at(0.05));
    expect(Math.abs(before - (day + DAWN * GAME_DAY_MS))).toBeLessThanOrEqual(1);
    const after = decoratorOpensAt(at(0.9));
    expect(Math.abs(after - (day + (1 + DAWN) * GAME_DAY_MS))).toBeLessThanOrEqual(1);
    // A moment after it she is there.
    expect(decoratorOpen(after + 1000)).toBe(true);
    expect(decoratorOpen(after - 1000)).toBe(false);
  });
});
