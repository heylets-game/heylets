import { describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { BANTER_GAP_MS, BANTER_LINES, BANTER_SLOT_MS, BANTER_NO_REPEAT, banterAt, banterPair, gossipLines, smallTalkToday, type Gossip } from "./banter";
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

  it("has a different half of the small talk in play from one day to the next", () => {
    const today = BANTER_LINES.map((_, i) => smallTalkToday(CREW, 100, i));
    const tomorrow = BANTER_LINES.map((_, i) => smallTalkToday(CREW, 101, i));
    expect(today.filter(Boolean).length).toBeGreaterThan(BANTER_LINES.length / 4);
    expect(today.filter(Boolean).length).toBeLessThan((BANTER_LINES.length * 3) / 4);
    expect(today).not.toEqual(tomorrow);
    // What is said over a few hours of one day is only that day's.
    const said = new Set(over("pub", 6).flatMap(({ lines }) => lines.map((l) => l.text)));
    const day = Math.floor(DAY0 / 86_400_000);
    BANTER_LINES.forEach((x, i) => {
      if (!smallTalkToday(CREW, day, i) && x.lines.some((t) => said.has(t))) {
        // Only where none of today's fitted whoever was near (then any will do), which a whole night never is.
        expect(x.lines.every((t) => said.has(t))).toBe(false);
      }
    });
  });

  it("does not take a topic up again within a few minutes", () => {
    const heard = over("pub", 6);
    heard.forEach(({ at, lines }, i) => {
      for (const prev of heard.slice(Math.max(0, i - 5), i)) {
        if (at - prev.at <= BANTER_NO_REPEAT * BANTER_SLOT_MS) expect(lines[0].text, new Date(at).toISOString()).not.toBe(prev.lines[0].text);
      }
    });
  });

  const GOSSIP: Gossip[] = [
    { kind: "garden", who: "Josh", crop: "herbs", beds: 3, ready: true },
    { kind: "voyage", who: "Greyson", place: "Cinder Reach", cleared: false },
    { kind: "gear", who: "Mara", item: "Storm Cutlass" },
    { kind: "fish", who: "Ann", fish: "sea bass", weight: "3.2 kg" },
    { kind: "news", text: "Fishing: a perfect catch pays a little more." },
  ];

  it("talks about what the crew has been up to, by name, every way of it short enough for a bubble", () => {
    for (const g of GOSSIP) {
      for (const way of gossipLines(g)) {
        expect(way.length).toBeGreaterThanOrEqual(2);
        for (const [, t] of way) {
          expect(t, t).not.toMatch(/[{}]/);
          expect(t.length, t).toBeLessThanOrEqual(90);
        }
        if (g.kind !== "news") expect(way.some(([, t]) => t.includes(g.who))).toBe(true);
      }
    }
    expect(gossipLines(GOSSIP[0])[0][0][1]).toBe("Have you seen Josh's herb garden?!");
    const heard = new Set<string>();
    for (let t = DAY0; t < DAY0 + 30 * GAME_DAY_MS; t += BANTER_SLOT_MS) for (const l of banterAt(CREW, "pub", t, GOSSIP) ?? []) heard.add(l.text);
    for (const name of ["Josh", "Greyson", "Mara", "Ann"]) expect([...heard].some((t) => t.includes(name)), name).toBe(true);
    expect([...heard].some((t) => t.includes("a perfect catch"))).toBe(true);
  });

  it("says the same for everyone with the same gossip, and only small talk with none", () => {
    for (let t = DAY0; t < DAY0 + GAME_DAY_MS; t += BANTER_SLOT_MS) {
      expect(banterAt(CREW, "pub", t, GOSSIP)).toEqual(banterAt(CREW, "pub", t, [...GOSSIP]));
      for (const l of banterAt(CREW, "pub", t) ?? []) expect(BANTER_LINES.some((x) => x.lines.includes(l.text)), l.text).toBe(true);
    }
  });
});
