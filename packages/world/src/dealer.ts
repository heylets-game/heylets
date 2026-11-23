// Hollis Crane, by the pillar at the end of the pub's bar: the Harbor's dealer in materials. He buys what you bring
// in from the woods, the quarry and the maps, sells what you are short of, and offers supply contracts that run over
// a few days.
//
// His prices move every six hours, like the fishmonger's, seeded by crew and slot so a crew sees one board and
// nothing is stored; each board he wants a couple of materials (paying more for them) and has a glut of one (selling
// it cheap). What a player has traded today and the contract they hold are kept by the server
// (apps/game/src/server/dealer.ts).

import type { ResourceKind, Resources } from "./hut";
import { MATERIAL_WORTH } from "./regulars";
import { makeRng, seedFromString } from "./rng";

/** What he deals in: the materials gathered and found. Gems go to the Lapidary; seeds and bonemeal are the stall's. */
export const DEALER_KINDS = ["wood", "stone", "iron", "copper", "fur", "bone", "herbs", "mushrooms", "slime"] as const satisfies readonly ResourceKind[];
export type DealerKind = (typeof DEALER_KINDS)[number];
export const isDealerKind = (k: unknown): k is DealerKind => (DEALER_KINDS as readonly unknown[]).includes(k);

/** Gold for one point of a material's worth (MATERIAL_WORTH: wood 1, iron 2). */
export const DEALER_UNIT = 4;
/** What he pays against a material's value, and what he asks. */
export const DEALER_BUYS_AT = 0.75;
export const DEALER_SELLS_AT = 1.6;
/** How long one board of prices stands. */
export const DEALER_BOARD_MS = 6 * 60 * 60_000;
/** His rates run between these, against a material's value. */
export const DEALER_RATE_MIN = 0.9;
export const DEALER_RATE_MAX = 1.25;
/** Each board, the materials he wants (paying this much more for) and the one he has too much of (selling for this much less). */
export const DEALER_WANTED = 2;
export const DEALER_WANTED_BONUS = 1.4;
export const DEALER_GLUT_DISCOUNT = 0.85;
/** The most of one material he will take from a player in a day, and sell them. */
export const DEALER_BUY_DAILY = 40;
export const DEALER_SELL_DAILY = 25;
/** The most of one material in one trade. */
export const DEALER_TRADE_MAX = 99;

export interface DealerBoard {
  slot: number;
  startsAt: number;
  endsAt: number;
  /** What he pays for one of each, and what he asks for one. */
  buys: Record<DealerKind, number>;
  sells: Record<DealerKind, number>;
  /** He is after these (paying more), and has too much of this (selling it cheap). */
  wanted: DealerKind[];
  glut: DealerKind;
}

/** A material's value in gold, before his rates. */
export const valueOf = (kind: DealerKind) => MATERIAL_WORTH[kind] * DEALER_UNIT;

/** His board for a crew (or a crewless player: `key` is either id) at `at`, epoch ms. */
export function dealerBoard(key: string, at: number): DealerBoard {
  const slot = Math.floor(at / DEALER_BOARD_MS);
  const rng = makeRng(seedFromString(`dealer|${key}|${slot}`));
  const rate = {} as Record<DealerKind, number>;
  for (const k of DEALER_KINDS) rate[k] = DEALER_RATE_MIN + (DEALER_RATE_MAX - DEALER_RATE_MIN) * rng.next();
  const pool: DealerKind[] = [...DEALER_KINDS];
  const wanted: DealerKind[] = [];
  while (wanted.length < DEALER_WANTED) wanted.push(...pool.splice(Math.floor(rng.next() * pool.length), 1));
  const glut = pool[Math.floor(rng.next() * pool.length)];
  const buys = {} as Record<DealerKind, number>;
  const sells = {} as Record<DealerKind, number>;
  for (const k of DEALER_KINDS) {
    const v = valueOf(k) * rate[k];
    buys[k] = Math.max(1, Math.round(v * DEALER_BUYS_AT * (wanted.includes(k) ? DEALER_WANTED_BONUS : 1)));
    // Always dearer than he buys, so nothing can be bought from him and sold straight back for a profit. (Rounded up,
    // in his favour, so it never slips under what a contract pays for the same.)
    sells[k] = Math.max(buys[k] + 1, Math.ceil(v * DEALER_SELLS_AT * (k === glut ? DEALER_GLUT_DISCOUNT : 1)));
  }
  return { slot, startsAt: slot * DEALER_BOARD_MS, endsAt: (slot + 1) * DEALER_BOARD_MS, buys, sells, wanted, glut };
}

/** Why a trade cannot be made, or null. `done`: how much of that material has gone that way today already. */
export function tradeProblem(side: "sell" | "buy", qty: number, done: number): string | null {
  if (!Number.isInteger(qty) || qty < 1 || qty > DEALER_TRADE_MAX) return `Trade 1 to ${DEALER_TRADE_MAX} at a time.`;
  const cap = side === "sell" ? DEALER_BUY_DAILY : DEALER_SELL_DAILY;
  if (done + qty > cap) return side === "sell" ? `He takes at most ${cap} of that a day from you. ${Math.max(0, cap - done)} more today.` : `He sells you at most ${cap} of that a day. ${Math.max(0, cap - done)} more today.`;
  return null;
}

// ---------- supply contracts ----------

/** Contracts on his slate for a player each day, how many they may take in a day, and that they hold one at a time. */
export const CONTRACT_OFFERS = 3;
export const CONTRACTS_PER_DAY = 2;
/** What a contract asks for, in worth (MATERIAL_WORTH): enough to take a few outings. */
const CONTRACT_WORTH: [number, number] = [24, 60];
/**
 * What a filled contract pays against the materials' value: more than selling them to him, and less than he ever asks
 * for them (his cheapest, a glut at his lowest rate, is DEALER_RATE_MIN × DEALER_SELLS_AT × DEALER_GLUT_DISCOUNT), so
 * a contract cannot be filled at a profit with goods bought from him.
 */
export const CONTRACT_PAY = 1.2;
/** Harbor XP for a filled contract; filled within CONTRACT_EARLY_MS of taking it, this much more besides. */
export const CONTRACT_XP = 8;
export const CONTRACT_EARLY_XP = 4;
export const CONTRACT_EARLY_MS = 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface ContractOffer {
  /** `${day}:${n}`: one of the day's offers. */
  id: string;
  /** What to bring him. */
  wants: Partial<Record<DealerKind, number>>;
  /** Days to fill it in, from taking it. */
  days: number;
  /** Gold for filling it (before an early bonus). */
  gold: number;
  /** Who it is for, in his words: the order behind it. */
  for: string;
}

/** Who wants the goods: a line on the slate, by what is asked. */
const BUYERS: Record<DealerKind, string[]> = {
  wood: ["a boatwright up the coast", "the works, for scaffolding", "a ship short of spars"],
  stone: ["a quay that needs facing", "the lighthouse keepers' wall", "a merchant's new cellar"],
  iron: ["a chandler's nails and fittings", "a smith two harbors over", "an anchor-maker"],
  copper: ["a ship's hull to sheathe", "a lamp-maker", "a brazier who pays on time"],
  fur: ["a trader heading north", "a captain's winter coats", "a tailor in the next town"],
  bone: ["a glue-boiler", "a carver of buttons and combs", "a dealer in charms (don't ask)"],
  herbs: ["a ship's surgeon", "an apothecary inland", "a cook with ambitions"],
  mushrooms: ["a market in the hills", "a cook who knows which are which", "a dyer"],
  slime: ["a caulker who swears by it", "an alchemist", "someone who would not say why"],
};

/** The day's contracts for a player (or a crew), `day` as the server keeps days (gatherDay). The same all day. */
export function contractOffers(key: string, day: string): ContractOffer[] {
  const rng = makeRng(seedFromString(`dealer-contract|${key}|${day}`));
  const offers: ContractOffer[] = [];
  const pool: DealerKind[] = [...DEALER_KINDS];
  for (let n = 0; n < CONTRACT_OFFERS; n++) {
    const kinds: DealerKind[] = [pool.splice(Math.floor(rng.next() * pool.length), 1)[0]];
    if (rng.next() < 0.5) kinds.push(pool[Math.floor(rng.next() * pool.length)]);
    const worth = CONTRACT_WORTH[0] + rng.next() * (CONTRACT_WORTH[1] - CONTRACT_WORTH[0]);
    const wants: Partial<Record<DealerKind, number>> = {};
    kinds.forEach((k, i) => {
      // Split the worth between the kinds, the first getting the larger share; rounded to fives.
      const share = kinds.length === 1 ? 1 : i === 0 ? 0.6 : 0.4;
      wants[k] = Math.max(5, Math.round((worth * share) / MATERIAL_WORTH[k] / 5) * 5);
    });
    offers.push({ id: `${day}:${n}`, wants, days: rng.next() < 0.5 ? 2 : 3, gold: contractGold(wants), for: BUYERS[kinds[0]][Math.floor(rng.next() * BUYERS[kinds[0]].length)] });
  }
  return offers;
}

/** What materials are worth to him, at his steady rates (not the board's): for a contract's pay, and for paying out a lapsed one. */
const worthOf = (r: Partial<Record<DealerKind, number>>) => DEALER_KINDS.reduce((n, k) => n + (r[k] ?? 0) * valueOf(k), 0);
export const contractGold = (wants: Partial<Record<DealerKind, number>>) => Math.round(worthOf(wants) * CONTRACT_PAY);

/** A contract a player holds. */
export interface HeldContract {
  offer: ContractOffer;
  takenAt: number;
  dueAt: number;
  delivered: Partial<Record<DealerKind, number>>;
}

export const contractDue = (offer: ContractOffer, takenAt: number) => takenAt + offer.days * DAY_MS;

/** What is still owed on a contract. */
export function stillOwed(c: Pick<HeldContract, "offer" | "delivered">): Partial<Record<DealerKind, number>> {
  const out: Partial<Record<DealerKind, number>> = {};
  for (const k of DEALER_KINDS) {
    const left = (c.offer.wants[k] ?? 0) - (c.delivered[k] ?? 0);
    if (left > 0) out[k] = left;
  }
  return out;
}

/** What handing in from `have` would give him now: as much as is still owed of each kind, as far as `have` goes. */
export function deliverable(c: Pick<HeldContract, "offer" | "delivered">, have: Resources): Partial<Record<DealerKind, number>> {
  const owed = stillOwed(c);
  const out: Partial<Record<DealerKind, number>> = {};
  for (const k of DEALER_KINDS) {
    const n = Math.min(owed[k] ?? 0, have[k] ?? 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Whether a contract is filled. */
export const filled = (c: Pick<HeldContract, "offer" | "delivered">) => Object.keys(stillOwed(c)).length === 0;

/** What a filled contract pays at `at`: its gold and XP, and more XP if it was filled within a day of taking it. */
export function contractPayout(c: Pick<HeldContract, "offer" | "takenAt">, at: number): { gold: number; xp: number; early: boolean } {
  const early = at - c.takenAt <= CONTRACT_EARLY_MS;
  return { gold: c.offer.gold, xp: CONTRACT_XP, early };
}

/** What he pays for what was delivered on a contract that lapsed or was given up: his buying price, so nothing is lost. */
export function lapsedPayout(c: Pick<HeldContract, "delivered">): number {
  return Math.round(worthOf(c.delivered) * DEALER_BUYS_AT);
}

