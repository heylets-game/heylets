import { describe, expect, it } from "vitest";
import {
  CONTRACTS_PER_DAY,
  CONTRACT_EARLY_MS,
  CONTRACT_OFFERS,
  CONTRACT_PAY,
  DEALER_BOARD_MS,
  DEALER_BUY_DAILY,
  DEALER_KINDS,
  DEALER_SELL_DAILY,
  DEALER_WANTED,
  contractDue,
  contractOffers,
  contractPayout,
  dealerBoard,
  deliverable,
  filled,
  lapsedPayout,
  stillOwed,
  tradeProblem,
  valueOf,
  type HeldContract,
} from "./dealer";

const T0 = 1_000 * DEALER_BOARD_MS;

describe("Hollis's board", () => {
  it("is the same for a crew all through a slot, and new the next", () => {
    expect(dealerBoard("CREWAA", T0)).toEqual(dealerBoard("CREWAA", T0 + DEALER_BOARD_MS - 1));
    expect(dealerBoard("CREWAA", T0 + DEALER_BOARD_MS).buys).not.toEqual(dealerBoard("CREWAA", T0).buys);
    expect(dealerBoard("CREWBB", T0).buys).not.toEqual(dealerBoard("CREWAA", T0).buys);
  });

  it("wants a couple of materials, has a glut of another, and always sells dearer than he buys", () => {
    for (let s = 0; s < 200; s++) {
      const b = dealerBoard("CREWAA", T0 + s * DEALER_BOARD_MS);
      expect(new Set(b.wanted).size).toBe(DEALER_WANTED);
      expect(b.wanted).not.toContain(b.glut);
      for (const k of DEALER_KINDS) {
        expect(b.buys[k]).toBeGreaterThan(0);
        expect(b.sells[k], k).toBeGreaterThan(b.buys[k]);
        // Never so cheap that a contract could be filled at a profit with what he sold.
        expect(b.sells[k], `${k} at slot ${s}`).toBeGreaterThanOrEqual(valueOf(k) * CONTRACT_PAY);
      }
    }
  });

  it("pays more for what he wants and asks less for his glut, on the whole", () => {
    let wantedUp = 0;
    let glutDown = 0;
    for (let s = 0; s < 200; s++) {
      const b = dealerBoard("CREWAA", T0 + s * DEALER_BOARD_MS);
      if (b.wanted.every((k) => b.buys[k] >= Math.round(valueOf(k) * 0.75))) wantedUp++;
      if (b.sells[b.glut] <= Math.round(valueOf(b.glut) * 1.6)) glutDown++;
    }
    expect(wantedUp).toBeGreaterThan(150);
    expect(glutDown).toBeGreaterThan(150);
  });

  it("takes and sells only so much of a material a day", () => {
    expect(tradeProblem("sell", 10, 0)).toBeNull();
    expect(tradeProblem("sell", 1, DEALER_BUY_DAILY)).toMatch(/at most/);
    expect(tradeProblem("buy", DEALER_SELL_DAILY, 0)).toBeNull();
    expect(tradeProblem("buy", 1, DEALER_SELL_DAILY)).toMatch(/0 more today/);
    expect(tradeProblem("buy", 0, 0)).toMatch(/1 to/);
    expect(tradeProblem("buy", 1.5, 0)).toMatch(/1 to/);
  });
});

describe("supply contracts", () => {
  it("offers a few a day, the same all day, each asking a fair amount of one or two materials", () => {
    const offers = contractOffers("player-1", "2026-11-23");
    expect(offers).toHaveLength(CONTRACT_OFFERS);
    expect(contractOffers("player-1", "2026-11-23")).toEqual(offers);
    expect(contractOffers("player-1", "2026-11-24")).not.toEqual(offers);
    expect(new Set(offers.map((o) => o.id)).size).toBe(CONTRACT_OFFERS);
    for (const o of offers) {
      const kinds = Object.keys(o.wants);
      expect(kinds.length).toBeGreaterThanOrEqual(1);
      expect(kinds.length).toBeLessThanOrEqual(2);
      expect(Object.values(o.wants).every((n) => n! >= 5 && n! % 5 === 0)).toBe(true);
      expect([2, 3]).toContain(o.days);
      expect(o.gold).toBeGreaterThan(0);
      expect(o.for.length).toBeGreaterThan(3);
    }
    expect(CONTRACTS_PER_DAY).toBeGreaterThanOrEqual(1);
  });

  it("is delivered in parts, as far as what you carry goes", () => {
    const offer = { id: "d:0", wants: { wood: 20, stone: 10 }, days: 3, gold: 144, for: "the works" };
    const c: HeldContract = { offer, takenAt: 0, dueAt: contractDue(offer, 0), delivered: {} };
    expect(deliverable(c, { wood: 12, iron: 5 })).toEqual({ wood: 12 });
    c.delivered = { wood: 12 };
    expect(stillOwed(c)).toEqual({ wood: 8, stone: 10 });
    expect(deliverable(c, { wood: 30, stone: 30 })).toEqual({ wood: 8, stone: 10 });
    expect(filled(c)).toBe(false);
    c.delivered = { wood: 20, stone: 10 };
    expect(filled(c)).toBe(true);
    expect(c.dueAt).toBe(3 * 24 * 60 * 60_000);
  });

  it("pays its gold and XP, more XP if filled within a day, and what was delivered if it lapses", () => {
    const offer = { id: "d:0", wants: { iron: 10 }, days: 2, gold: 96, for: "a smith" };
    expect(contractPayout({ offer, takenAt: 0 }, CONTRACT_EARLY_MS)).toEqual({ gold: 96, xp: 8, early: true });
    expect(contractPayout({ offer, takenAt: 0 }, CONTRACT_EARLY_MS + 1).early).toBe(false);
    // Half delivered: half the iron at his buying price (8 a piece at 0.75).
    expect(lapsedPayout({ delivered: { iron: 5 } })).toBe(30);
    expect(lapsedPayout({ delivered: {} })).toBe(0);
  });
});
