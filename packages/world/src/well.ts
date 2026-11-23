// The town well, on the green. Three things to do there: fill a watering can (garden.ts), fill a water skin to
// carry onto a map, and toss in a coin for luck.
//
// A coin in the well buys a lucky roll to hit on the next map the hero goes out to (the Lucky condition, zone/kit.ts:
// each charge gives one attack roll advantage), and now and then the well gives something back: a little XP, or,
// rarely, a gem. A few coins a day; the luck keeps until it is used. Pure rules: the server holds the count and the
// luck, and rolls what comes back with a seeded RNG, so asking again for the same toss gives the same.

import type { Rng } from "./rng";

/** Water skins the well fills a hero's pack up to. More than that are made at the apothecary. */
export const WELL_SKINS = 2;
/** Gold one coin in the well costs. */
export const WISH_COST = 10;
/** Coins a hero may toss in a UTC day. */
export const WISHES_PER_DAY = 3;
/** Lucky rolls a hero can carry out to a map at once: one for each coin tossed. */
export const LUCK_MAX = 3;
/** Chances that the well gives something back for a coin: a gem, or some Harbor XP. */
export const WELL_GEM_CHANCE = 0.05;
export const WELL_XP_CHANCE = 0.25;

/** What the well gave back for a coin. */
export type WellGift = "gem" | "xp" | null;

/** What a coin tossed in brings back, rolled on the RNG for that toss. */
export function wishGift(rng: Rng): WellGift {
  const r = rng.next();
  return r < WELL_GEM_CHANCE ? "gem" : r < WELL_GEM_CHANCE + WELL_XP_CHANCE ? "xp" : null;
}

/** Why a hero who holds `skins` water skins cannot fill one at the well now, or null if they can. */
export function skinProblem(skins: number): string | null {
  return skins >= WELL_SKINS ? `You carry ${WELL_SKINS} full water skins already. More are made at the apothecary.` : null;
}

/** Why a hero with `gold`, who has tossed `tossed` coins today and carries `luck` lucky rolls, cannot toss a coin, or null. */
export function wishProblem(ctx: { gold: number; tossed: number; luck: number }): string | null {
  if (ctx.tossed >= WISHES_PER_DAY) return `The well has had your ${WISHES_PER_DAY} coins today. Come back tomorrow.`;
  if (ctx.luck >= LUCK_MAX) return `You carry all the luck you can (${LUCK_MAX} lucky rolls). Spend some on a map first.`;
  if (ctx.gold < WISH_COST) return "Not enough gold.";
  return null;
}
