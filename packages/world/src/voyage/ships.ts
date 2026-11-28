// The crew's ships: what a crew sails to the places on its atlas.
//
// A crew has one ship afloat, moored at the Harbor's pier (harbor.ts
// HARBOR_SHIP): the best of the ones it owns. Every crew owns the Sloop from
// its first day. The bigger ships are crew projects (projects.ts, the
// "shipyard" group), built on the slipway beside the pier; once one is built
// it takes the Sloop's place at the pier, for good.
//
// A ship sets three things: how far out on the atlas the crew can go
// (`reach`, in rings from the Harbor), how many heroes a voyage takes
// (`heroes`), and the deck a sea encounter is fought on (`deck`, `stations`).
// Her hull wears at sea and is mended with wood at the yard. This file is the
// catalogue and the rules of those; the server keeps each crew's hull
// (apps/game/src/server/db/ships.ts).

export interface ShipDef {
  id: string;
  name: string;
  blurb: string;
  /** Her deck as a sea encounter lays it out, in hexes: columns across, rows from stern to bow. The moored model is sized from it too. */
  deck: { cols: number; rows: number };
  /** How many stations (a helm, a gun, a pump) there is room for on that deck. */
  stations: number;
  /** How much her hull takes before she must put back: what `hull` is when she is sound. */
  hull: number;
  /** How much cargo her hold takes. */
  hold: number;
  /** The most heroes she carries on a voyage. Never more than a map takes (zone.ts MAX_PARTY). */
  heroes: number;
  /** The furthest ring of the atlas she sails to (a node's `ring`: 1 is beside the Harbor). Null: any ring. */
  reach: number | null;
  /** The crew project that builds her (projects.ts). None: every crew has her from the start. */
  project?: string;
}

/**
 * The ships, the least first: each is better than the one before it in every way, so a crew's ship is simply the
 * last of these it owns.
 *
 * TUNING VALUES. Every number here is a first guess, set before anyone had sailed: deck sizes, stations, hull,
 * hold, heroes carried and reach are all meant to be changed as the voyages are played. (The rings a crew is
 * given a ship for in migration 0069 were these at the time; changing them here later takes nothing from anyone.)
 */
export const SHIPS: ShipDef[] = [
  {
    id: "sloop",
    name: "Sloop",
    blurb: "One mast and a handful of hands: every crew's first ship.",
    deck: { cols: 3, rows: 8 },
    stations: 2,
    hull: 60,
    hold: 8,
    heroes: 4,
    reach: 3,
  },
  {
    id: "brig",
    name: "Brig",
    blurb: "Two masts, square-rigged, with room below for a longer voyage.",
    deck: { cols: 3, rows: 10 },
    stations: 3,
    hull: 100,
    hold: 14,
    heroes: 5,
    reach: 7,
    project: "brig",
  },
  {
    id: "galleon",
    name: "Galleon",
    blurb: "Three masts and a high stern. There is nowhere on the chart she will not go.",
    deck: { cols: 3, rows: 12 },
    stations: 4,
    hull: 160,
    hold: 24,
    heroes: 6,
    reach: null,
    project: "galleon",
  },
];

/** The ship every crew starts with. */
export const STARTING_SHIP = SHIPS[0];

export const shipById = (id: unknown): ShipDef | undefined => SHIPS.find((s) => s.id === id);

/** Whether a crew that has built these projects owns a ship. */
export const ownsShip = (ship: ShipDef, built: readonly string[]): boolean => !ship.project || built.includes(ship.project);

/** The crew's ship: the best it owns, given the projects it has built. */
export function crewShip(built: readonly string[]): ShipDef {
  return SHIPS.filter((s) => ownsShip(s, built)).pop() ?? STARTING_SHIP;
}

/** The next ship the crew could build: the least one it does not own. Null once it owns them all. */
export function nextShip(built: readonly string[]): ShipDef | null {
  return SHIPS.find((s) => !ownsShip(s, built)) ?? null;
}

/** Whether a ship sails as far out as this ring. */
export const shipReaches = (ship: ShipDef, ring: number): boolean => ship.reach === null || ring <= ship.reach;

/** The least ship that sails as far out as this ring. (The last of them goes anywhere.) */
export const shipForRing = (ring: number): ShipDef => SHIPS.find((s) => shipReaches(s, ring)) ?? SHIPS[SHIPS.length - 1];

/**
 * Why a ship cannot take her crew to a place this far out, in words for the crew; or null if she can. `place` is
 * what the place is called.
 */
export function reachProblem(ship: ShipDef, ring: number, place: string): string | null {
  if (shipReaches(ship, ring)) return null;
  const needs = shipForRing(ring);
  const far = ship.reach === 1 ? "one landfall" : `${ship.reach} landfalls`;
  return `${place} lies too far out for the ${ship.name}: she sails no further than ${far} from the Harbor. The ${needs.name} will reach it, once the crew has built her at the works.`;
}

// ---------- the hull ----------

/** How much hull one piece of wood mends. (A tuning value, like the ships' own numbers.) */
export const HULL_PER_WOOD = 5;

/** A hull as it was stored, held to what the ship can have: whole numbers from 0 to her full hull. Anything else is a sound hull. */
export function cleanHull(ship: ShipDef, hull: unknown): number {
  return typeof hull === "number" && Number.isFinite(hull) ? Math.max(0, Math.min(ship.hull, Math.round(hull))) : ship.hull;
}

/** How much wood it takes to make a hull sound again. */
export const mendCost = (ship: ShipDef, hull: number): number => Math.ceil((ship.hull - cleanHull(ship, hull)) / HULL_PER_WOOD);

export type MendCheck = { ok: true; wood: number; hull: number } | { ok: false; error: string };

/**
 * Mend a hull with the wood someone has: as much as it needs, or as far as their wood goes. Says how much wood it
 * takes and what the hull is afterwards, or why nothing was mended.
 */
export function checkMend(ship: ShipDef, hull: number, wood: number): MendCheck {
  const now = cleanHull(ship, hull);
  const needs = mendCost(ship, now);
  if (needs <= 0) return { ok: false, error: `The ${ship.name}'s hull is sound: there is nothing to mend.` };
  const spend = Math.min(needs, Math.max(0, Math.floor(wood)));
  if (spend <= 0) return { ok: false, error: "Mending takes wood, and you have none." };
  return { ok: true, wood: spend, hull: Math.min(ship.hull, now + spend * HULL_PER_WOOD) };
}

// ---------- wire types ----------

/** A crew's ship as the Harbor is told of it: which one lies at the pier, and how her hull stands. */
export interface CrewShip {
  id: string;
  hull: number;
}
