import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { BAIT_IDS, BAIT_SALE, baitBuyProblem, baitEaten } from "./fishing";
import { fishFrom, fishingHoles } from "./fishingholes";
import { FISHMONGER, FISHMONGER_ADVICE, FISHMONGER_ADVICE_DONE, FISHMONGER_POS, fishmongerAdvice } from "./fishmonger";
import { HARBOR_GATHER, HARBOR_SIDES, generateHarbor, harborPath } from "./harbor";
import { tileAt } from "./map";
import { lureLost, type Sitting } from "./sitting";
import { TALK_VOICES, fishmongerTalk, fishmongerTip } from "./talk";

const harbor = generateHarbor();
const around = (p: { q: number; r: number }) => HARBOR_SIDES.map((d) => ({ q: p.q + d.q, r: p.r + d.r }));

describe("the fishmonger", () => {
  it("stands on open shore by the shack, clear of its door and of every fishing spot", () => {
    const t = tileAt(harbor, FISHMONGER_POS)!;
    expect(t.biome).not.toBe("water");
    expect(t.built || t.blocker).toBeFalsy();
    expect(hexDistance(FISHMONGER_POS, HARBOR_GATHER.fishing)).toBe(2);
    expect(around(FISHMONGER_POS).some((p) => tileAt(harbor, p)?.built)).toBe(true);
    expect(fishFrom(harbor, FISHMONGER_POS, null)).toBeNull();
    // The way from the road to the shack's door does not go through him.
    const path = harborPath(harbor, { q: HARBOR_GATHER.fishing.q + 4, r: HARBOR_GATHER.fishing.r }, HARBOR_GATHER.fishing)!;
    expect(path.some((p) => p.q === FISHMONGER_POS.q && p.r === FISHMONGER_POS.r)).toBe(false);
  });

  it("buys fish, sells bait and says where they are biting, in a voice of his own", () => {
    const hole = fishingHoles("CREWAA", Date.UTC(2026, 10, 13, 9)).find((h) => h.kind === "shoal")!;
    const tip = fishmongerTip(hole);
    expect(tip).toContain(hole.where);
    expect(tip).toMatch(/worm/);
    expect(fishmongerTip(null)).toMatch(/Nowhere/);
    const talk = fishmongerTalk(tip, () => "Hold longer.");
    expect(talk.unit).toBe(FISHMONGER.id);
    const said = (c: (typeof talk.choices)[number]) => c.opens ?? (typeof c.says === "function" ? c.says() : c.says) ?? (c.bye ? "bye" : "");
    expect(talk.choices.map(said)).toEqual(["fish", "bait", tip, "Hold longer.", "bye"]);
    expect(Object.entries(TALK_VOICES).filter(([, v]) => v === TALK_VOICES[FISHMONGER.id]).length).toBe(1);
  });
});

describe("the fishmonger's advice", () => {
  it("gives every piece once, in order, says he is done, and only then starts again", () => {
    const n = FISHMONGER_ADVICE.length;
    const round = Array.from({ length: n + 1 }, (_, i) => fishmongerAdvice(i));
    expect(new Set(round).size).toBe(n + 1);
    expect(round.slice(0, n)).toEqual([...FISHMONGER_ADVICE]);
    expect(round[n]).toBe(FISHMONGER_ADVICE_DONE);
    expect(fishmongerAdvice(n + 1)).toBe(FISHMONGER_ADVICE[0]);
  });

  it("starts with how to catch better fish, fits the box, and is true to the numbers", () => {
    expect(fishmongerAdvice(0)).toMatch(/Cast long/);
    for (const a of [...FISHMONGER_ADVICE, FISHMONGER_ADVICE_DONE]) expect(a.length).toBeLessThanOrEqual(150);
    const all = FISHMONGER_ADVICE.join(" ");
    for (const words of [/double/, /for half/, /tap/i, /hold and reel/i, /goes red/, /jumps/]) expect(all).toMatch(words);
  });
});

describe("bait for sale", () => {
  it("sells by the lot, up to what a hero carries, for gold they have", () => {
    for (const b of BAIT_IDS) expect(BAIT_SALE[b].max % BAIT_SALE[b].per).toBe(0);
    expect(baitBuyProblem("worms", 0, 6)).toBeNull();
    expect(baitBuyProblem("worms", 0, 5)).toMatch(/6 gold/);
    expect(baitBuyProblem("worms", 51, 100)).toMatch(/60/);
    expect(baitBuyProblem("glow_lure", 3, 100)).toMatch(/only 3/);
  });

  it("eats worms and shrimp on the cast, but not a lure", () => {
    expect(baitEaten("worms")).toBe(true);
    expect(baitEaten("shrimp")).toBe(true);
    expect(baitEaten("glow_lure")).toBe(false);
    expect(baitEaten(null)).toBe(false);
  });
});

describe("a lure lost with the line", () => {
  const sitting = (cast: Partial<NonNullable<Sitting["cast"]>> | null, last: Sitting["last"] = null) => ({ cast, last }) as unknown as Sitting;
  const hooked = { bait: "glow_lure" as const, hookedAt: 5 };

  it("goes when a hooked fish snaps the line or takes all of it", () => {
    expect(lureLost(sitting(hooked), sitting(null, { outcome: "snapped", species: "cod" }))).toBe("glow_lure");
    expect(lureLost(sitting(hooked), sitting(null, { outcome: "spooled", species: "cod" }))).toBe("glow_lure");
  });

  it("comes back when the fish is landed or shakes the hook, the line is wound in empty, or there was none", () => {
    expect(lureLost(sitting(hooked), sitting(null, { outcome: "landed", species: "cod" }))).toBeNull();
    expect(lureLost(sitting(hooked), sitting(null, { outcome: "thrown", species: "cod" }))).toBeNull();
    expect(lureLost(sitting({ ...hooked, hookedAt: null }), sitting(null))).toBeNull();
    expect(lureLost(sitting({ bait: "worms", hookedAt: 5 }), sitting(null, { outcome: "snapped", species: "cod" }))).toBeNull();
    expect(lureLost(sitting(null), sitting(null, { outcome: "snapped", species: "cod" }))).toBeNull();
  });
});
