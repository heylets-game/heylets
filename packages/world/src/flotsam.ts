// Flotsam: what the sea brings in. Driftwood, a ship's crate, a bottle with a message in it, odds and ends.
//
// With every tide (once a Harbor day, gameclock.ts) a few pieces float in, bobbing on the water: some in the shallows
// just off the beach, some along the coast, one further out. They bob there until somebody in the crew fishes them out
// or the tide turns and takes back whatever is left. A piece is fished out from beside it: the ones in the shallows
// from the beach, on foot; the rest from a boat alongside (a barrel keeps to the coast, so the one further out is for
// a rowboat).
//
// As with the fishing holes (fishingholes.ts), nothing of it is stored or sent: where the pieces lie, what each is and
// what is in it all follow from the crew and the clock, so every browser in a crew draws the same ones and the server
// works the same ones out again when one is taken. Only who took what is kept (the server's flotsam table), and the
// first to take a piece has it.

import { hexDistance, type HexPos } from "@gantt-quest/core";
import { FURNISHINGS, type Resources, type ResourceKind } from "./hut";
import { GAME_DAY_MS } from "./gameclock";
import { HARBOR_BERTHS, HARBOR_BOATS, HARBOR_ROCKS, HARBOR_SIDES, HARBOR_WRECK, generateHarbor } from "./harbor";
import { shoreAt } from "./fishingholes";
import { poiAt, tileAt } from "./map";
import { makeRng, seedFromString, type Rng } from "./rng";

/** How long one tide's flotsam lies there: a Harbor day. Then the tide turns, takes back what is left, and brings more. */
export const FLOTSAM_TIDE_MS = GAME_DAY_MS;
/** Pieces each tide in the shallows off the beach (reached from it on foot), along the coast (a barrel gets there), and further out (a rowboat). */
export const SHALLOWS_PIECES = 2;
export const COASTAL_PIECES = 2;
export const OPEN_PIECES = 1;
/** No two pieces lie closer than this, in hexes. */
const PIECE_GAP = 3;

export type FlotsamKind = "driftwood" | "crate" | "bottle" | "junk";

/** Odds and ends: what each is, and the little it is good for. */
export interface JunkDef {
  name: string;
  /** Said as it is picked up. */
  line: string;
  gives: Resources;
  gold?: number;
  /** How it is drawn (render/flotsam.ts). */
  look: "boot" | "lantern" | "oar" | "kettle" | "bones" | "weed" | "rope" | "spoon";
}

export const JUNK: JunkDef[] = [
  { name: "An old boot", line: "Somebody's left boot. There's a coin in the toe.", gives: {}, gold: 1, look: "boot" },
  { name: "A rusted lantern", line: "No glass and no wick, but the iron is good for something.", gives: { iron: 1 }, look: "lantern" },
  { name: "A broken oar", line: "Half an oar. The other half is someone else's problem.", gives: { wood: 1 }, look: "oar" },
  { name: "A dented kettle", line: "Copper, and dented in the shape of a very surprised face.", gives: { copper: 1 }, look: "kettle" },
  { name: "A fish skeleton", line: "Picked clean by the gulls. They left you the bones.", gives: { bone: 1 }, look: "bones" },
  { name: "A clump of seaweed", line: "Wet, green and smelling of the sea. The apothecary will want it.", gives: { herbs: 1 }, look: "weed" },
  { name: "A tangle of rope", line: "A ship's worth of knots, all of them wrong. It'll do for lashings.", gives: { fur: 1 }, look: "rope" },
  { name: "A bent spoon", line: "Bent double. Iron's iron.", gives: { iron: 1 }, look: "spoon" },
];

/**
 * Messages in bottles. A few are from people in trouble, most are from people having a much worse time than you,
 * and some are just jokes somebody needed to tell the sea.
 */
export const BOTTLE_NOTES: string[] = [
  "If found, please return to the sea. It knows where I live.",
  "Day forty adrift. The gull has started calling me Captain. I have not corrected him.",
  "To whoever finds this: the treasure was never buried. It was spent. Sorry.",
  "Why don't pirates bathe before they walk the plank? They'd rather just wash up on shore. Like this bottle. Hello.",
  "Stranded on an island with a man who only speaks in sea shanties. We are on verse ninety. Send help, or earplugs.",
  "What's a pirate's favourite letter? You'd think it's R, but his first love be the C.",
  "Dear finder. I am a message in a bottle. You are a person on a beach. We have both had better days.",
  "Lost: one ship. Answers to 'the ship'. Last seen going down. If found, it's probably best to leave it.",
  "My captain says the sea is a cruel mistress. My captain has never been married. I am writing to his wife.",
  "Why did the sea monster eat five ships carrying potatoes? Nobody can eat just one.",
  "Do not trust the lighthouse keeper's cousin. He sold me this bottle. It was full of seawater. It still is, mostly.",
  "To the person who stole my rowboat: I hope your oars both go left.",
  "This is the third bottle I have sent. If you found the first two, please stop reading my mail.",
  "How do you make an octopus laugh? Ten tickles. He'll tell you it's eight. He's lying.",
  "Help! I am being held prisoner on a ship by a crew that insists on singing in harmony. I can't hold a tune. They know.",
  "We hit a rock. The rock was fine. Please tell the rock's family it was fine.",
  "If you are reading this, I have been rescued, because I am the one who threw it back in. Hello again.",
  "Ship's log, day one: all is well. Day two: all is well. Day three: who packed only biscuits.",
  "Which side of a ship should a sailor never stand on? The outside.",
  "A whale followed our ship for three days. We think it wanted the cook's recipe. We do not blame it.",
  "Note to self: next time the old woman at the dock says 'don't sail tonight', don't sail tonight.",
  "Whoever finds this: you owe me one bottle. It's right here.",
  "Why couldn't the young pirate see the film? It was rated Arrrr.",
  "The fish in these waters are bigger than our boat. One of them looked at me like it knew my name.",
  "Captain's orders: write a message, put it in a bottle, throw it overboard. Morale is low. This is the message.",
  "To my love across the sea: I miss you. To my landlord across the sea: I do not miss you, and the rent's in the post.",
  "Seasick for eleven days. The sea is fine. I am the problem.",
  "What lies at the bottom of the ocean and twitches? A nervous wreck.",
  "Our navigator found a shortcut. We are now somewhere the map simply calls 'No'.",
  "If found on a Tuesday, throw back. Bottles found on a Tuesday are bad luck. I'm told. By the bottle.",
  "Why did the crab never share? Because he's shellfish. Our cook said that one. We put him in the bottle next.",
  "Please send rope. Not to escape. We just ran out, and everything on a ship is held on with rope.",
  "Hello from the other side of the sea. It's mostly the same, but our gulls are louder.",
  "I have trained the parrot to say 'land ho'. It says it all the time now. We have not seen land in a month.",
  "Somebody keeps writing 'SOS' in the sand on our island. It's me. I'm the somebody.",
  "Do pirates pay much for their earrings? About a buccaneer. Sorry. It's been a long voyage.",
];

export interface Flotsam {
  /** Stable for its tide: "<tide>-<n>". */
  id: string;
  /** The water hex it bobs on. */
  pos: HexPos;
  kind: FlotsamKind;
  /** In the shallows just off the beach: fished out from the beach beside it, no boat needed. */
  shallows: boolean;
  /** Which odd or end it is (JUNK), for junk. */
  junk?: number;
  /** When the tide takes it back, server clock. */
  until: number;
}

/** What a piece is called, as it lies there: "A bottle", "An old boot". */
export function flotsamName(f: Pick<Flotsam, "kind" | "junk">): string {
  if (f.kind === "junk") return JUNK[f.junk ?? 0].name;
  return { driftwood: "Driftwood", crate: "A ship's crate", bottle: "A bottle with a message in it" }[f.kind];
}

// ---------- where pieces can lie ----------

const key = (p: HexPos) => `${p.q},${p.r}`;
const around = (p: HexPos): HexPos[] => HARBOR_SIDES.map((d) => ({ q: p.q + d.q, r: p.r + d.r }));

interface Places {
  /** Water just off the open beach (walkable land beside the water, off the paths, piers, cobbles and places). */
  shallows: HexPos[];
  /** Other water along the coast (beside land), clear of the rocks, the wreck and the moored boats. */
  coast: HexPos[];
  /** Water further out. */
  open: HexPos[];
}

const HARBOR = generateHarbor();
let places: Places | null = null;
function placesOf(): Places {
  if (places) return places;
  const kept = new Set([...HARBOR_ROCKS, HARBOR_WRECK, ...HARBOR_BOATS.map((b) => b.at), ...HARBOR_BERTHS].map(key));
  const beach = (p: HexPos) => {
    const t = tileAt(HARBOR, p);
    return !!t && ["mud", "sand", "plains"].includes(t.biome) && !t.path && !t.built && !t.blocker && !poiAt(HARBOR, p) && shoreAt(HARBOR, p);
  };
  const out: Places = { shallows: [], coast: [], open: [] };
  for (const t of HARBOR.tiles) {
    const p = { q: t.q, r: t.r };
    if (t.biome !== "water" || kept.has(key(p))) continue;
    const sides = around(p);
    if (sides.some(beach)) out.shallows.push(p);
    else if (sides.some((n) => !!tileAt(HARBOR, n) && tileAt(HARBOR, n)!.biome !== "water")) out.coast.push(p);
    else out.open.push(p);
  }
  return (places = out);
}

/** Pick `n` of `from` (in a shuffled order), each at least PIECE_GAP from those already `taken`. */
function spread(rng: Rng, from: readonly HexPos[], n: number, taken: HexPos[]): HexPos[] {
  const pool = [...from];
  const out: HexPos[] = [];
  while (out.length < n && pool.length) {
    const p = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    if (taken.every((t) => hexDistance(t, p) >= PIECE_GAP)) (out.push(p), taken.push(p));
  }
  return out;
}

/** What comes in close is mostly light stuff; further out, more of the crates. */
const SHALLOWS_KINDS: [FlotsamKind, number][] = [["driftwood", 4], ["bottle", 3], ["crate", 2], ["junk", 3]];
const FLOATING_KINDS: [FlotsamKind, number][] = [["driftwood", 3], ["bottle", 2], ["crate", 3], ["junk", 3]];

function weighted(rng: Rng, table: [FlotsamKind, number][]): FlotsamKind {
  let roll = rng.next() * table.reduce((a, [, w]) => a + w, 0);
  for (const [kind, w] of table) if ((roll -= w) < 0) return kind;
  return table[table.length - 1][0];
}

/** The flotsam lying in a crew's Harbor at `now`, taken or not (the server knows which have been). */
export function flotsamAt(crewId: string, now: number): Flotsam[] {
  const tide = Math.floor(now / FLOTSAM_TIDE_MS);
  const until = (tide + 1) * FLOTSAM_TIDE_MS;
  const rng = makeRng(seedFromString(`${crewId}:flotsam:${tide}`));
  const { shallows, coast, open } = placesOf();
  const taken: HexPos[] = [];
  const lying = [
    ...spread(rng, shallows, SHALLOWS_PIECES, taken).map((pos) => ({ pos, shallows: true })),
    ...spread(rng, coast, COASTAL_PIECES, taken).map((pos) => ({ pos, shallows: false })),
    ...spread(rng, open, OPEN_PIECES, taken).map((pos) => ({ pos, shallows: false })),
  ];
  return lying.map(({ pos, shallows }, n) => {
    const kind = weighted(rng, shallows ? SHALLOWS_KINDS : FLOATING_KINDS);
    const junk = rng.int(0, JUNK.length - 1);
    return { id: `${tide}-${n}`, pos, kind, shallows, ...(kind === "junk" ? { junk } : {}), until };
  });
}

/**
 * Why a hero on `pos` cannot fish out `piece`, or null if they can: it must bob under them (afloat, in a boat) or
 * beside them, from the shore or from a boat. Only a hero with a boat stands on water, so the pieces out of reach of
 * the land need one.
 */
export function flotsamReachProblem(piece: Flotsam, pos: HexPos): string | null {
  return hexDistance(piece.pos, pos) > 1 ? "That's too far out to reach." : null;
}

/** The piece a hero on `pos` can fish out, if any. */
export function flotsamWithin(pieces: readonly Flotsam[], pos: HexPos): Flotsam | null {
  return pieces.find((f) => !flotsamReachProblem(f, pos)) ?? null;
}

// ---------- what is in it ----------

/** What a crate can hold, and the decor that now and then turns up in one. */
const CRATE_KINDS: ResourceKind[] = ["wood", "iron", "copper", "fur", "stone"];
const CRATE_DECOR = ["lantern", "bottle", "coin_pile", "rug", "candle", "mug"].filter((id) => FURNISHINGS[id]);
export const CRATE_DECOR_CHANCE = 0.15;
export const BOTTLE_GOLD_CHANCE = 0.35;

export interface FlotsamFind {
  resources: Resources;
  gold: number;
  /** A piece of decor for the hut, by furnishing id. */
  furnishing?: string;
  /** The message in a bottle. */
  note?: string;
  /** What is said as it is opened. */
  line: string;
}

/** What is in a piece: always the same for the same piece, whoever opens it. */
export function flotsamFind(crewId: string, piece: Flotsam): FlotsamFind {
  const rng = makeRng(seedFromString(`${crewId}:flotsam:${piece.id}:find`));
  if (piece.kind === "driftwood") {
    const wood = rng.int(2, 4);
    return { resources: { wood }, gold: 0, line: "Sea-silvered, and dry enough to burn." };
  }
  if (piece.kind === "crate") {
    const resources: Resources = {};
    for (let i = rng.int(3, 5); i > 0; i--) {
      const k = rng.pick(CRATE_KINDS);
      resources[k] = (resources[k] ?? 0) + 1;
    }
    const decor = rng.chance(CRATE_DECOR_CHANCE) ? rng.pick(CRATE_DECOR) : undefined;
    return { resources, gold: 0, ...(decor ? { furnishing: decor } : {}), line: decor ? `You prise the lid off. Ship's stores, and packed in straw, a ${FURNISHINGS[decor].name.toLowerCase()}.` : "You prise the lid off. Ship's stores, mostly dry." };
  }
  if (piece.kind === "bottle") {
    const note = rng.pick(BOTTLE_NOTES);
    const gold = rng.chance(BOTTLE_GOLD_CHANCE) ? rng.int(2, 8) : 0;
    return { resources: {}, gold, note, line: gold ? `A rolled-up note, and ${gold} gold rattling in the bottom.` : "A rolled-up note, a little damp." };
  }
  const junk = JUNK[piece.junk ?? 0];
  return { resources: { ...junk.gives }, gold: junk.gold ?? 0, line: junk.line };
}
