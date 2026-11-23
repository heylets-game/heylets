import { describe, expect, it } from "vitest";
import { KEEPER_HOUSES } from "./keepers";
import { REGULARS } from "./regulars";
import { SALESMEN } from "./salesman";
import { TALK_PAGE, TALK_PER_DAY, TALK_VOICES, barkeepTalk, dealerTalk, keeperTalk, pagesOf, regularTalk, salesmanTalk, talkProblem, type Conversation } from "./talk";

const everyone: Conversation[] = [
  barkeepTalk("Nobody in the corner."),
  dealerTalk(),
  ...REGULARS.map((r) => regularTalk(r)),
  ...SALESMEN.map((s) => salesmanTalk(s, `salesman:${s.id}`)),
  ...KEEPER_HOUSES.map((h) => keeperTalk(h)),
];

describe("talking to the townsfolk", () => {
  it("has everyone say something as you walk up, with a way to say goodbye", () => {
    for (const c of everyone) {
      expect(c.greeting.length, c.name).toBeGreaterThan(0);
      expect(c.greeting.every((p) => p.length > 0 && p.length <= TALK_PAGE), c.name).toBe(true);
      expect(c.choices.some((ch) => ch.bye), c.name).toBe(true);
      expect(new Set(c.choices.map((ch) => ch.id)).size, c.name).toBe(c.choices.length);
      // Every reply does one thing.
      for (const ch of c.choices) expect([ch.opens, ch.says, ch.ask, ch.bye].filter(Boolean).length, `${c.name}: ${ch.label}`).toBe(1);
    }
  });

  it("gives everyone in a room a voice of their own", () => {
    const pub = everyone.filter((c) => !c.unit.startsWith("keeper:"));
    expect(new Set(pub.map((c) => c.voice)).size).toBe(pub.length);
    const keepers = everyone.filter((c) => c.unit.startsWith("keeper:"));
    expect(new Set(keepers.map((c) => c.voice)).size).toBe(keepers.length);
    expect(Object.values(TALK_VOICES).every((v) => Math.abs(v) <= 12)).toBe(true);
  });

  it("lets only Old Tam be asked anything, and has him say when he is tired of it", () => {
    const asking = everyone.filter((c) => c.choices.some((ch) => ch.ask));
    expect(asking.map((c) => c.unit)).toEqual(["barkeep"]);
    expect(asking[0].tired).toBeTruthy();
    expect(barkeepTalk("Nobody in the corner.").greeting.at(-1)).toBe("Nobody in the corner.");
  });

  it("stops the questions at the day's limit", () => {
    expect(talkProblem(0)).toBeNull();
    expect(talkProblem(TALK_PER_DAY - 1)).toBeNull();
    expect(talkProblem(TALK_PER_DAY)).toMatch(/today/);
  });

  it("breaks long lines into pages without losing a word", () => {
    const long = "The tide is out. ".repeat(30) + "And that is that.";
    const pages = pagesOf(long, 60);
    expect(pages.every((p) => p.length <= 60)).toBe(true);
    expect(pages.join(" ")).toBe(long.trim());
    // At the end of a sentence where one fits.
    expect(pages[0].endsWith(".")).toBe(true);
    // A word longer than a page is cut where it has to be.
    expect(pagesOf("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    expect(pagesOf(["  one  ", "", "two"])).toEqual(["one", "two"]);
  });
});
