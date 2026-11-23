// Home finishes: the wallpaper on a hut's walls inside, what its floor is laid with, and the colour of its roof
// outside. Nell Ashby sells them from her stall beside the market stall in the Harbor. Each finish is bought once
// and kept for good; its owner then dresses their hut in any of the ones they own, as often as they like, from
// edit mode at home. A hut with none chosen looks as huts always have: bare walls, honey boards, and a roof
// colour of its own picked from its owner's id.
//
// Each finish carries what it is drawn with (`look`): the client paints the wallpaper and the floor from it
// (render/groundArt.ts) and colours the roof, its shutters and the Lodge's pennant with it (render/places/huts.ts).

import type { HexPos } from "@gantt-quest/core";

export type FinishKind = "wall" | "floor" | "roof";
export const FINISH_KINDS: readonly FinishKind[] = ["wall", "floor", "roof"];

/**
 * A wallpaper, drawn on a wall sheet from the floor up: a dado of `dado` to waist height under a rail (absent:
 * the paper runs to the skirting), and above it the paper: `ground`, with `ink` laid over it in `pattern`.
 */
export interface WallLook {
  pattern: "plain" | "stripe" | "sprig" | "damask" | "check" | "shell" | "boards";
  ground: string;
  ink: string;
  dado?: string;
  /** The rail, skirting and beam: dark timber unless said. */
  timber?: string;
}

/** A floor: boards in a stain (`tones` are the boards, `gap` between them), flagstones, tiles, or a painted floor. */
export interface FloorLook {
  pattern: "boards" | "flags" | "tiles" | "painted" | "herringbone";
  tones: string[];
  gap: string;
}

export interface RoofLook {
  color: string;
}

interface FinishBase {
  id: string;
  name: string;
  price: number;
  /** A few words on it, as Nell would sell it. */
  blurb: string;
}
export type FinishDef =
  | (FinishBase & { kind: "wall"; look: WallLook })
  | (FinishBase & { kind: "floor"; look: FloorLook })
  | (FinishBase & { kind: "roof"; look: RoofLook });

const wall = (id: string, name: string, price: number, blurb: string, look: WallLook): FinishDef => ({ id, kind: "wall", name, price, blurb, look });
const floor = (id: string, name: string, price: number, blurb: string, look: FloorLook): FinishDef => ({ id, kind: "floor", name, price, blurb, look });
const roof = (id: string, name: string, price: number, blurb: string, color: string): FinishDef => ({ id, kind: "roof", name, price, blurb, look: { color } });

/**
 * Everything Nell sells, in the order her catalogue shows it. Prices sit with the furniture's (4 to 70 gold) and
 * under a bigger hut (150 and 400): a floor is a good chair's worth, a wallpaper a little more, a roof the dearest.
 * Ids are stored in D1: never rename one.
 */
export const FINISHES: readonly FinishDef[] = [
  wall("wall_limewash", "Cream limewash", 30, "Plain and bright. Makes a small room feel bigger.", { pattern: "plain", ground: "#e6d9b8", ink: "#c9b48a" }),
  wall("wall_sage_stripe", "Sage stripe", 45, "Soft green stripes over a pine dado. Very calming.", { pattern: "stripe", ground: "#cfd8b8", ink: "#8fa478", dado: "#a8835a" }),
  wall("wall_rose_stripe", "Rose stripe", 45, "Candy stripes, rose and cream. Cheerful, my mother said.", { pattern: "stripe", ground: "#efd9cc", ink: "#cf8a86" }),
  wall("wall_blue_sprig", "Blue sprig", 55, "Little blue flowers on white, over a blue dado.", { pattern: "sprig", ground: "#eef0ea", ink: "#4a6fa8", dado: "#3d5a80" }),
  wall("wall_shell", "Seashell print", 55, "Shells on sea green. Very Harbor.", { pattern: "shell", ground: "#9fcabf", ink: "#f4e8d4", dado: "#2f6b66" }),
  wall("wall_ochre_check", "Ochre check", 50, "A warm check, like a good blanket.", { pattern: "check", ground: "#e8c97a", ink: "#b98a3a" }),
  wall("wall_navy_boards", "Navy wainscot", 65, "Painted boards to the waist, cream above. Shipshape.", { pattern: "boards", ground: "#e8dcc0", ink: "#2d3a5a", dado: "#2d3a5a" }),
  wall("wall_red_damask", "Red damask", 80, "Deep red with a gold figure. For a hut that means it.", { pattern: "damask", ground: "#7a2a2a", ink: "#c9a24a", dado: "#3a2218", timber: "#2a1a12" }),
  floor("floor_ash", "Pale ash boards", 30, "Light boards, scrubbed pale.", { pattern: "boards", tones: ["#d8c29a", "#cfb88e", "#e0caa4", "#d4bd94"], gap: "#9c8462" }),
  floor("floor_walnut", "Dark walnut boards", 40, "Dark and rich. Hides the mud.", { pattern: "boards", tones: ["#5e3f28", "#563923", "#664530", "#5a3c26"], gap: "#2e1e12" }),
  floor("floor_limed", "Limed boards", 35, "Whitewashed planks, like a beach house.", { pattern: "boards", tones: ["#e4ddcc", "#dbd3c0", "#ebe4d4", "#e0d8c6"], gap: "#a89e88" }),
  floor("floor_deck", "Red deck boards", 40, "Ship's planking in an old red stain.", { pattern: "boards", tones: ["#8a3f2e", "#813a2a", "#934633", "#863d2c"], gap: "#4a2016" }),
  floor("floor_herringbone", "Oak herringbone", 55, "Short oak blocks laid in a zigzag. Takes a patient hand.", { pattern: "herringbone", tones: ["#b08452", "#a67b4a", "#ba8d5a", "#ab8050"], gap: "#6e5032" }),
  floor("floor_flags", "Grey flagstones", 50, "Big slabs of stone. Cool in summer.", { pattern: "flags", tones: ["#8a8780", "#928e86", "#837f78", "#96918a", "#8c8880"], gap: "#4a4844" }),
  floor("floor_checker", "Black and white tiles", 60, "A smart checkerboard. Mind the shine.", { pattern: "tiles", tones: ["#ece6d8", "#2a2a30"], gap: "#8a8478" }),
  floor("floor_terracotta", "Terracotta tiles", 50, "Warm red clay tiles from down the coast.", { pattern: "tiles", tones: ["#b8603a", "#a95434", "#c26a42"], gap: "#e0cfb0" }),
  floor("floor_painted", "Painted diamonds", 55, "Boards painted in blue and cream diamonds.", { pattern: "painted", tones: ["#e8dcc0", "#4a6fa8"], gap: "#7f5f3e" }),
  roof("roof_slate", "Slate grey roof", 60, "Quiet and respectable.", "#5f6b78"),
  roof("roof_brick", "Brick red roof", 60, "The old Harbor red.", "#a3402f"),
  roof("roof_moss", "Moss green roof", 60, "Looks like it grew there.", "#5e7d3a"),
  roof("roof_harbor_blue", "Harbor blue roof", 70, "The colour of the bay on a good day.", "#2f6f9c"),
  roof("roof_mustard", "Mustard roof", 70, "You'll find your way home in the fog.", "#c99a2e"),
  roof("roof_plum", "Plum roof", 75, "A rich, dark purple.", "#6a2f6e"),
  roof("roof_sea_green", "Sea green roof", 75, "Green as the shallows.", "#2f8c7a"),
  roof("roof_tar", "Tarred black roof", 80, "Tarred like a hull. Keeps out anything.", "#2a2a30"),
  roof("roof_white", "Whitewashed roof", 90, "Bright white. Seen from every pier.", "#e8e4da"),
];

const BY_ID = new Map(FINISHES.map((f) => [f.id, f]));

export function finishById(id: string | null | undefined): FinishDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** The finishes of one kind, in catalogue order. */
export function finishesOf(kind: FinishKind): FinishDef[] {
  return FINISHES.filter((f) => f.kind === kind);
}

/** What a hut is dressed in: a finish id for each kind, or null for the way huts come. */
export interface HutFinish {
  wall: string | null;
  floor: string | null;
  roof: string | null;
}
export const BARE_FINISH: HutFinish = { wall: null, floor: null, roof: null };

/** The wallpaper's look, if one is chosen. */
export function wallLook(id: string | null | undefined): WallLook | undefined {
  const f = finishById(id);
  return f?.kind === "wall" ? f.look : undefined;
}
export function floorLook(id: string | null | undefined): FloorLook | undefined {
  const f = finishById(id);
  return f?.kind === "floor" ? f.look : undefined;
}
/** A roof's colour, if one is chosen. */
export function roofColor(id: string | null | undefined): string | undefined {
  const f = finishById(id);
  return f?.kind === "roof" ? f.look.color : undefined;
}

/** Why `id` cannot be bought by someone owning `owned` with `gold`, or null if it can. */
export function finishBuyProblem(id: unknown, owned: readonly string[], gold: number): string | null {
  const def = typeof id === "string" ? finishById(id) : undefined;
  if (!def) return "Nell doesn't sell that.";
  if (owned.includes(def.id)) return "You have that one already.";
  if (gold < def.price) return `That's ${def.price} gold, and you have ${gold}.`;
  return null;
}

/**
 * Why a hut's `kind` cannot be dressed in `id` by someone owning `owned`, or null if it can. `id` null takes the
 * finish off again, back to the way huts come, which is always allowed.
 */
export function finishSetProblem(kind: unknown, id: unknown, owned: readonly string[]): string | null {
  if (!FINISH_KINDS.includes(kind as FinishKind)) return "Walls, floor or roof?";
  if (id === null) return null;
  const def = typeof id === "string" ? finishById(id) : undefined;
  if (!def) return "There is no such finish.";
  if (def.kind !== kind) return `That is not for the ${kind}.`;
  if (!owned.includes(def.id)) return "Buy it from Nell first.";
  return null;
}

/** A hut's finish read back from storage: anything no longer in the catalogue, or of the wrong kind, is dropped. */
export function cleanFinish(raw: Partial<Record<FinishKind, string | null>>): HutFinish {
  const keep = (kind: FinishKind) => (finishById(raw[kind])?.kind === kind ? raw[kind]! : null);
  return { wall: keep("wall"), floor: keep("floor"), roof: keep("roof") };
}

// ---------- Nell and her stall ----------

const at = (col: number, row: number): HexPos => ({ q: col - Math.floor(row / 2), r: row });

/**
 * Nell's stall, on the quay a hex east of the market stall (clear of its wall, so neither hides the other), facing
 * up the green as the market stall does:
 * where a hero stands to talk to her (`HARBOR_FINISHES`), and the hex the stall stands on behind it, where she
 * stands at her counter among her sample boards.
 */
export const HARBOR_FINISHES: HexPos = at(16, 22);
/** Down and to the left of where you stand: the building `footing` of a single facing 3, as the market stall faces. */
export const FINISHES_STALL: HexPos = { q: HARBOR_FINISHES.q - 1, r: HARBOR_FINISHES.r + 1 };

export const DECORATOR = {
  /** Her unit id in the scene. */
  id: "keeper:decor",
  name: "Nell Ashby",
  short: "Nell",
  trade: "home furnishings",
  look: "keeper_decor",
  hello: "Mind the paste, it's still wet. Come to brighten the place up?",
  line: "Wallpaper, floors, roofs. Buy it once, it's yours for good, and you can change your mind at home as often as you like.",
} as const;
