import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { BANTER_GAP_MS, BANTER_LINES, BANTER_SLOT_MS, banterAt, banterPair } from "./banter";
import { GAME_DAY_MS } from "./gameclock";
import { REGULARS } from "./regulars";
import { regularAbout } from "./wander";

const CREW = "CREWAA";
const DAY0 = 2_900_000 * GAME_DAY_MS;
/** Every slot of a few game days, in a place: the exchanges that come up. */
const over = (place: "pub" | "harbor", days = 4) => {
  const out: { at: number; lines: NonNullable<ReturnType<typeof banterAt>> }[] = [];
  for (let t = DAY0; t < DAY0 + days * GAME_DAY_MS; t += BANTER_SLOT_MS) {
    const lines = banterAt(CREW, place, t);
    if (lines) out.push({ at: t, lines });
  }
  return out;
};

describe("the townsfolk talking among themselves", () => {
  it("happens now and then, in the pub and out in the Harbor", () => {
    expect(over("pub").length).toBeGreaterThan(5);
    expect(over("harbor").length).toBeGreaterThan(5);
  });

  it("is the same for everyone through a slot, and keeps its lines in order, a few seconds apart, within the slot's turn", () => {
    for (const { at, lines } of over("pub", 2)) {
      expect(banterAt(CREW, "pub", at + BANTER_SLOT_MS - 1)).toEqual(lines);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      lines.forEach((l, i) => i > 0 && expect(l.at - lines[i - 1].at).toBe(BANTER_GAP_MS));
      expect(banterPair(lines)).not.toBeNull();
    }
  });

  it("is between two standing near each other, who stay put till it is said", () => {
    for (const place of ["pub", "harbor"] as const) {
      for (const { lines } of over(place)) {
        const [a, b] = banterPair(lines)!;
        const end = lines[lines.length - 1].at;
        for (const unit of [a, b]) {
          if (!unit.startsWith("regular:")) continue;
          const id = unit.slice("regular:".length) as (typeof REGULARS)[number]["id"];
          const first = regularAbout(CREW, id, lines[0].at);
          const last = regularAbout(CREW, id, end);
          expect(first.place, unit).toBe(place);
          expect(first.walking || last.walking, `${unit} walking off mid-sentence`).toBe(false);
          expect(last.pos).toEqual(first.pos);
        }
        if (a.startsWith("regular:") && b.startsWith("regular:")) {
          const pa = regularAbout(CREW, a.slice(8) as never, lines[0].at).pos;
          const pb = regularAbout(CREW, b.slice(8) as never, lines[0].at).pos;
          expect(hexDistance(pa, pb)).toBeLessThanOrEqual(place === "harbor" ? 4 : 2);
        }
        // Old Tam and Hollis never leave the pub.
        if (place === "harbor") expect([a, b].some((u) => u === "barkeep" || u === "dealer")).toBe(false);
      }
    }
  });

  it("has lines short enough for a bubble, and pairs only of regulars who exist", () => {
    const ids = new Set(REGULARS.map((r) => r.id));
    for (const x of BANTER_LINES) {
      for (const t of x.lines) expect(t.length, t).toBeLessThanOrEqual(80);
      if (x.pair) for (const who of x.pair) expect(ids.has(who as never), who).toBe(true);
    }
  });
});
