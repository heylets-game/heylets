import { describe, expect, it } from "vitest";
import {
  BARE_FINISH,
  DECORATOR,
  FINISHES,
  FINISHES_STALL,
  FINISH_KINDS,
  HARBOR_BUILDINGS,
  HARBOR_FINISHES,
  HARBOR_SHOP,
  TALK_VOICES,
  cleanFinish,
  decoratorTalk,
  finishBuyProblem,
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
  it("sells what is in the catalogue, once, to whoever can pay", () => {
    const roof = finishById("roof_plum")!;
    expect(finishBuyProblem("roof_plum", [], roof.price)).toBeNull();
    expect(finishBuyProblem("roof_plum", [], roof.price - 1)).toMatch(/gold/);
    expect(finishBuyProblem("roof_plum", ["roof_plum"], 999)).toMatch(/already/);
    expect(finishBuyProblem("roof_gold", [], 999)).toMatch(/doesn't sell/);
    expect(finishBuyProblem(7, [], 999)).toMatch(/doesn't sell/);
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
