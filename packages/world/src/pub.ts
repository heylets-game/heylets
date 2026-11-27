// The crew's pub: a room off the Harbor, bigger than any hut, with a bar, a
// barkeep, tables and the dice table.
//
// Like the Harbor and the huts it has no reducer. People walk freely and the
// PubRoom Durable Object checks each request against what is here: the room,
// the fittings that are walked around, and the menu.
//
// The menu is meals. A hero eats one a day (the server's orderAtPub), and
// what it does (its perks: gathering outings back, a few stat points until
// the day turns) is listed on the board; nothing is carried away from the bar.

import type { HexGrid, HexPos, Stats } from "@gantt-quest/core";
import type { CrewRequest, CrewView } from "./crew";
import type { DiceRequest, DiceView } from "./dice";
import type { ShoalsRequest, ShoalsView } from "./shoals";
import type { TideRequest, TideView } from "./tide";
import { harborPoi, type HarborPlayer, type EmoteMessage, type EmoteRequest, type LookMessage, type LookRequest, type XpMessage } from "./harbor";
import { SEATS } from "./hut";
import { gatherDay, gatherResetAt } from "./gather";
import { STAT_KEYS, STAT_LABEL, sumBonuses } from "./progression";
import { HEX_DIRS, buildRoom, hutPath, wallFaces } from "./hutroom";
import type { WorldMap } from "./map";

/** The floor is 10 by 7: larger than the biggest hut (8 by 6). */
export const PUB_GRID: HexGrid = { cols: 12, rows: 9 };

/** Offset coordinates (column, row) to the axial coordinates the map uses. */
const at = (col: number, row: number): HexPos => ({ q: col - Math.floor(row / 2), r: row });

/** Where a customer stands to order or to talk to the barkeep. */
export const PUB_COUNTER: HexPos = at(3, 3);
/** Where players stand to sit at the dice table. */
export const PUB_DICE: HexPos = at(7, 5);
/** Where players stand to sit at the Shoals table. */
export const PUB_SHOALS: HexPos = at(5, 5);
/** Where players stand to sit at the Cargo and Krakens table. */
export const PUB_CREW: HexPos = at(3, 5);
/** Where players stand to sit at the Turn the Tide card table: on the door's side of the room. */
export const PUB_TIDE: HexPos = at(7, 7);
/** The barkeep's spot, behind the bar. */
export const PUB_BARKEEP_POS: HexPos = at(3, 1);
export const PUB_BARKEEP = { id: "barkeep", name: "Old Tam" } as const;
/** Where a traveling salesman stands when one is in (see salesman.ts): the corner by the far wall. Nobody else stands there. */
export const PUB_SALESMAN_POS: HexPos = at(10, 4);
/** Where a customer stands to trade with the salesman. */
export const PUB_TRADER: HexPos = at(9, 4);
/**
 * The dealer: the Harbor's dealer in materials, who buys what is brought in, sells what is short, and offers supply
 * contracts (see dealer.ts). He leans on the pillar at the end of the bar (the "pillar" fitting); a customer walks
 * up to the hex in front.
 */
export const PUB_DEALER = {
  id: "dealer",
  name: "Hollis Crane",
  short: "Hollis",
  trade: "the dealer in materials",
  look: "dealer",
  hello: "Wood, stone, iron, the lot. If it can be carried, I'll buy it, and if you're short, I'll sell it.",
  line: "Prices move with the tide. Mine move a little faster.",
} as const;
export const PUB_DEALER_POS: HexPos = at(6, 2);
/** Where a customer stands to deal with the dealer. */
export const PUB_DEALER_STAND: HexPos = at(6, 3);
/**
 * Where the day's regulars (see regulars.ts) stand, in the order they take
 * them, each with the hex a customer walks to when the regular is clicked.
 * Nobody else stands on a regular's spot, whether or not one is in.
 */
export const PUB_REGULAR_SPOTS: { pos: HexPos; stand: HexPos }[] = [
  { pos: at(8, 2), stand: at(7, 2) },
  { pos: at(1, 4), stand: at(2, 4) },
  { pos: at(4, 7), stand: at(4, 6) },
];

/**
 * The leaderboard for the game tables: a big chalk board standing on the
 * floor against the back wall, across the two wall faces behind its hex,
 * facing the room and the usual camera head-on. It is walked around like
 * furniture; a customer reads it standing at `stand`, beside it. It is kept
 * out of PUB_FITTINGS so the record fish's wall spots (see pubMountSpots),
 * worked out from the fittings, stay where they were.
 */
export const PUB_LEADERBOARD: { pos: HexPos; stand: HexPos } = { pos: at(7, 1), stand: at(6, 1) };

export interface PubFitting {
  id: number;
  model: string;
  q: number;
  r: number;
  facing: number;
}

const fit = (id: number, model: string, col: number, row: number, facing = 0): PubFitting => ({ id, model, ...at(col, row), facing });

/** The furniture. It never moves, and it is walked around. */
export const PUB_FITTINGS: PubFitting[] = [
  fit(1, "bar", 2, 2),
  fit(2, "bar", 3, 2),
  fit(3, "bar", 4, 2),
  fit(4, "keg", 1, 1),
  fit(5, "keg", 5, 1),
  // The great fireplace, built into the corner where the back wall meets the side wall, facing out across the room.
  fit(6, "pub_hearth", 9, 1, 1),
  fit(7, "table", 8, 3),
  fit(8, "chair", 7, 3, 1),
  fit(9, "chair", 9, 3, 4),
  fit(10, "table", 2, 6),
  fit(11, "chair", 1, 6, 1),
  fit(12, "chair", 3, 6, 4),
  fit(13, "table", 9, 6),
  fit(14, "chair", 8, 6, 1),
  // The salesmen's sea chest, beside the corner they take.
  fit(15, "chest", 10, 6, 5),
  // A timber pillar at the end of the bar, holding up the roof, with notices pinned to it. The dealer leans on it.
  fit(16, "pillar", 5, 2),
];

/** The room: the same every time. The counter, the four game tables, the trader's spot and the dealer's are places to stand, not obstacles. */
export function pubRoom(): WorldMap {
  const room = buildRoom(PUB_GRID);
  return { ...room, pois: [...room.pois, harborPoi("counter", "counter", PUB_COUNTER), harborPoi("dice", "dice", PUB_DICE), harborPoi("shoals", "shoals", PUB_SHOALS), harborPoi("crew", "crew", PUB_CREW), harborPoi("tide", "tide", PUB_TIDE), harborPoi("trader", "trader", PUB_TRADER), harborPoi("dealer", "dealer", PUB_DEALER_STAND)] };
}

/** The stools at the pub's tables: anyone may walk onto one to sit on it. */
export const PUB_SEATS: HexPos[] = PUB_FITTINGS.filter((f) => !!SEATS[f.model]).map((f) => ({ q: f.q, r: f.r }));

/** A walkable route across the pub, or null. The leaderboard is walked around. The barkeep's side of the bar is his alone, the salesmen's corner theirs, and the dealer's and the regulars' spots theirs. A walk may end on a stool nobody else is on (`taken`: where everyone else is), to sit on it. */
export function pubPath(room: WorldMap, from: HexPos, to: HexPos, taken: HexPos[] = []): HexPos[] | null {
  return hutPath(room, [...PUB_FITTINGS, PUB_LEADERBOARD.pos, PUB_BARKEEP_POS, PUB_SALESMAN_POS, PUB_DEALER_POS, ...PUB_REGULAR_SPOTS.map((s) => s.pos)], from, to, PUB_SEATS, taken);
}

// ---------- the menu ----------

/**
 * What a meal does for whoever eats it. A meal has any number of these; the board lists each one, and a new kind is
 * a case here, in mealPerkText, and wherever the server gives it (orderAtPub, heroInitFor).
 */
export type MealPerk =
  /** Gathering outings used today, given back (no more than have been used). */
  | { kind: "outings"; amount: number }
  /** Added to the hero's stats until the UTC day turns over: on the maps, in every check, and on their sheet. */
  | { kind: "stats"; stats: Partial<Stats> };

/** A meal on the board. A hero eats one a day; they differ in what they do and what they cost. */
export interface PubItem {
  id: string;
  name: string;
  price: number;
  blurb: string;
  perks: MealPerk[];
}

export const PUB_MENU: PubItem[] = [
  { id: "stew", name: "Fish Stew", price: 12, blurb: "Mostly fish.", perks: [{ kind: "stats", stats: { vit: 2 } }, { kind: "outings", amount: 1 }] },
  {
    id: "pie",
    name: "Sailor's Pie",
    price: 18,
    blurb: "Eaten slowly, with stories.",
    perks: [{ kind: "stats", stats: { str: 1, int_stat: 1, vit: 1, agi: 1, dex: 1 } }, { kind: "outings", amount: 2 }],
  },
];

export const pubItem = (id: string): PubItem | undefined => PUB_MENU.find((i) => i.id === id);

/** One perk in plain words, for the board: "+2 Vitality for the rest of the day", "2 used gathering outings back". */
export function mealPerkText(perk: MealPerk): string {
  if (perk.kind === "outings") return `${perk.amount} used gathering ${perk.amount === 1 ? "outing" : "outings"} back`;
  return `${statBonusText(perk.stats)} for the rest of the day`;
}

/** Stat points in plain words: "+2 Vitality", "+1 Strength, +1 Agility", or "+1 to every stat" when all five are the same. */
export function statBonusText(stats: Partial<Stats>): string {
  const given = STAT_KEYS.filter((k) => (stats[k] ?? 0) !== 0);
  const n = given.length ? stats[given[0]]! : 0;
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  if (given.length === STAT_KEYS.length && given.every((k) => stats[k] === n)) return `${sign(n)} to every stat`;
  return given.map((k) => `${sign(stats[k]!)} ${STAT_LABEL[k]}`).join(", ");
}

/** How many gathering outings a meal gives back. */
export const mealOutings = (item: PubItem): number => item.perks.reduce((n, p) => n + (p.kind === "outings" ? p.amount : 0), 0);

/** What a meal adds to a hero's stats. */
export const mealStats = (item: PubItem): Partial<Stats> => sumBonuses(...item.perks.flatMap((p) => (p.kind === "stats" ? [p.stats] : [])));

/** The meal a hero is still fed by at `now`: the one they ate, if they ate it today (UTC), else undefined. */
export function fedBy(meal: { meal?: string | null; meal_day?: string | null }, now: number): PubItem | undefined {
  return meal.meal && meal.meal_day === gatherDay(now) ? pubItem(meal.meal) : undefined;
}

/** What today's meal adds to a hero's stats at `now`: nothing once the day has turned. Added beside the gear's bonus wherever stats are counted (not to what they can carry, which would leave a pack too full at midnight). */
export function mealBonus(meal: { meal?: string | null; meal_day?: string | null }, now: number): Partial<Stats> {
  const item = fedBy(meal, now);
  return item ? mealStats(item) : {};
}

/** When a meal eaten at `now` wears off: the next UTC midnight, when the day's outings come back too. */
export const mealEndsAt = gatherResetAt;

/** Longest thing a customer may say to the barkeep. */
export const PUB_MAX_TALK = 200;

// ---------- wire types ----------

export type PubServerMessage =
  | { type: "snapshot"; you: string; players: HarborPlayer[] }
  | { type: "joined"; player: HarborPlayer }
  | { type: "left"; id: string }
  | { type: "moved"; id: string; path: HexPos[] }
  | { type: "placed"; id: string; pos: HexPos }
  | { type: "said"; id: string; name: string; text: string }
  /** A line over someone's head with no entry in the chat log: a word with the barkeep, and his answer. */
  | { type: "bubble"; id: string; text: string }
  | { type: "dice"; table: DiceView | null }
  | { type: "diceError"; text: string }
  | { type: "shoals"; table: ShoalsView | null }
  | { type: "shoalsError"; text: string }
  | { type: "crew"; table: CrewView | null }
  | { type: "crewError"; text: string }
  | { type: "tide"; table: TideView | null }
  | { type: "tideError"; text: string }
  | LookMessage
  | EmoteMessage
  | XpMessage;

export type PubClientMessage =
  | { type: "move"; to: HexPos }
  | { type: "say"; text: string }
  | LookRequest
  | EmoteRequest
  /** Back to the door, for a stuck or lost hero. */
  | { type: "unstick" }
  | { type: "dice"; action: DiceRequest }
  | { type: "shoals"; action: ShoalsRequest }
  | { type: "crew"; action: CrewRequest }
  | { type: "tide"; action: TideRequest };


/** Where the crew's record fish hang on the pub's walls: faces spread round the room, in a fixed order. */
export function pubMountSpots(count: number): { pos: HexPos; side: number }[] {
  // Only walls with clear floor in front: not behind the bar, the kegs or the hearth, nor where anyone stands to work.
  const busy = new Set([...PUB_FITTINGS.map((f) => `${f.q},${f.r}`), ...[PUB_BARKEEP_POS, PUB_COUNTER, PUB_DICE, PUB_SHOALS, PUB_CREW, PUB_TIDE, PUB_TRADER, PUB_DEALER_STAND, PUB_SALESMAN_POS, PUB_DEALER_POS].map((p) => `${p.q},${p.r}`)]);
  const faces = wallFaces(pubRoom())
    .filter((f) => !busy.has(`${f.pos.q + HEX_DIRS[f.side].q},${f.pos.r + HEX_DIRS[f.side].r}`))
    .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q || a.side - b.side);
  if (faces.length <= count) return faces;
  const step = faces.length / count;
  return Array.from({ length: count }, (_, i) => faces[Math.floor(i * step + step / 2)]);
}
