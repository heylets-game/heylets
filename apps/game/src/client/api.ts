// HTTP helpers for the Harbor screens.

import type { StatKey } from "@gantt-quest/core";
import type { FinishKind, HutFinish, Muster, MusterAnswer, SowWith } from "@gantt-quest/world";
import type { Appearance, BaitId, BoatId, RodId, CarryState, FishSpot, GatherChoice, HarborXpStatus, GatherSpot, HarborWorks, HutSummary, ItemDef, Lodestone, ProjectAmounts, PublicHero, Resources, SalesEntry, SalesmanId, SalesmanVisit, ShopEntry, Throwable, TradeSide } from "@gantt-quest/world";
import { devTools } from "./devTools";
import { actAs, actingHero } from "./party";
import { forcedSalesman } from "./salesmanClock";
import type { GatherStatus } from "../server/gather";
import type { SittingPaid } from "../server/fishing";
import type { FishStock } from "../server/fishmarket";
import type { BaitCounter } from "../server/bait";
import type { FlotsamTaken } from "../server/flotsam";
import type { DealerView, HeldContractView } from "../server/dealer";
import type { CatchBook, PubWall } from "../server/catchbook";
import type { PubGame, PubLeaderboard, PubScore } from "../server/pub-scores";
import type { XpResult } from "../server/harbor-xp";
import type { TradeList } from "../server/trade";
import type { Chart, ChartNode } from "../server/atlas";
import type { HeldStone } from "../server/lodestones";
import type { ChestView } from "../server/townchest";
import type { ApothecaryView, GalleyView, HaggleResult, KeeperWare, SmithyView } from "../server/workshops";
import type { ErrandPaid, RegularsView } from "../server/errands";
import type { GardenView } from "../server/garden";
import type { WellView } from "../server/well";

export type { Chart, ChartNode, ChestView, HeldStone };
export type { ApothecaryView, SmithyView, GalleyView, ErrandPaid, RegularsView, HaggleResult, KeeperWare };

export type { DealerView, HeldContractView };
export type { CatchBook, FishStock, GatherStatus, PubGame, PubLeaderboard, PubScore, PubWall, SittingPaid, XpResult };

/** What came of ordering a meal at the pub. */
export interface PubOrdered {
  /** The meal gave back one gathering outing. */
  rested?: boolean;
}

/** The crew's projects and what this player has to give toward them. */
export interface Works {
  works: HarborWorks;
  stock: ProjectAmounts;
}

/** Optional ?p=2 gives this tab its own guest session, for testing two players on one machine. */
export const PROFILE = new URLSearchParams(location.search).get("p") ?? "";

export interface Character {
  name: string;
  /** Earned by filling the Catch Book. */
  title?: string | null;
  class_id: string;
  status: "draft" | "active";
  level: number;
  xp: number;
  str: number;
  int_stat: number;
  vit: number;
  agi: number;
  dex: number;
  unspent_points: number;
  gold: number;
  /** JSON list of the class abilities in the hero's slots (parse with parseAbilityLoadout). */
  ability_loadout?: string;
  /** JSON Appearance (parse with parseAppearance), or null if they never chose one. */
  appearance?: string | null;
}

export interface InventoryItem {
  id: number;
  kind: ItemDef["kind"];
  ref: string;
  name: string;
  rarity: ItemDef["rarity"];
  slot: ItemDef["slot"];
  power: number;
  level_req: number;
  icon: string;
  stat_bonus_json: string;
  equipped: number;
  /** Steps of work at the smithy, already counted in `power`. */
  upgrades?: number;
  /** 1 while worn but not drawn on the hero. */
  hidden?: number;
}

/** The traveling salesman in the pub, if one is in, and their stock for this player; otherwise who is due next. */
export interface SalesmanView {
  here: (SalesmanVisit & { entries: (SalesEntry & { bought: boolean; problem: string | null })[] }) | null;
  next: { salesmanId: SalesmanId; startsAt: number } | null;
}

/** In the dev server, a forced visitor (see salesmanClock.ts) is passed on so the server agrees. */
const salesmanHeader = (): Record<string, string> => {
  const forced = forcedSalesman();
  return forced ? { "x-gq-salesman": forced } : {};
};

export interface Shop {
  refreshAt: number;
  entries: (ShopEntry & { bought: boolean })[];
}

/** What the player owns for their hut, and their gold. */
export type Hut = HutSummary & { gold: number };

export interface Me {
  /** `email` is null for a guest, whose account lives only in this browser. */
  player: { id: string; name: string; email: string | null };
  character: Character | null;
  /** What the hero has with them, worn and in the pack. Stored items are only listed inside their hut. */
  inventory: InventoryItem[];
  /** The materials in the pack, by kind. They sit in stacks beside the gear. Absent from an older server. */
  materials?: Resources;
  /** The potions, flasks and bombs in the pack, by kind: used up on a map, and kept between maps. Absent from an older server. */
  consumables?: Partial<Record<Throwable, number>>;
  /** The lodestones in the pack: each kind held, and how many. */
  lodestones?: HeldStone[];
  /** How full the pack is, its size, what is in storage and whether there is a home for it. Null without a character. */
  carry: CarryState | null;
  /** The crew whose Harbor this player shares, if any. The id doubles as the invite code. */
  crew: { id: string; name: string } | null;
  /** Harbor XP still to be had today, from any pastime. Absent from an older server. */
  harborXp?: HarborXpStatus;
  /** On the ADMIN_EMAILS allow-list. Only shows the admin link; the server checks every admin call. */
  isAdmin: boolean;
  /** A development deployment (the worker's ENVIRONMENT is "dev"): show the dev toolbox. Absent from an older server. */
  devTools?: boolean;
  /** The newest release whose notes this player has read on the notice board. Null if never; absent from an older server. */
  seenRelease?: string | null;
}

export type { StatKey };

/** A world one of the account's heroes belongs to, as Join world lists them (server/db/crews.ts). */
export interface AccountWorld {
  id: string;
  name: string;
  /** Which of the account's heroes are in it. */
  heroes: { id: string; name: string }[];
  members: number;
}

/** One of the account's heroes, as the main menu lists them (server/routes/heroes.ts). */
export interface HeroSlot {
  id: string;
  name: string;
  classId: string;
  level: number;
  /** JSON Appearance (parse with parseAppearance), or null. */
  appearance: string | null;
  /** The world (crew) they are in, if any. */
  crew: { id: string; name: string } | null;
  /** In the account's party: they come onto a map with the hero being played. */
  party: boolean;
}

async function request<T>(path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    // The party member this tab is acting as, if not the hero this device plays (party.ts): it is that hero who asks.
    headers: { "content-type": "application/json", ...(PROFILE ? { "x-gq-profile": PROFILE } : {}), ...(actingHero() ? { "x-gq-hero": actingHero()! } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // The game's routes answer `error`; Better Auth's (/api/auth/*) answer `message` and `code`.
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; code?: string };
  if (!res.ok) throw Object.assign(new Error(data.error ?? data.message ?? `Request failed (${res.status})`), { status: res.status, code: data.code });
  return data as T;
}

let signingIn: Promise<unknown> | null = null;

/** Load the signed-in player, creating a guest account on first visit. */
export async function loadMe(): Promise<Me> {
  const me = await fetchMe();
  devTools.set(me.devTools === true);
  return me;
}

async function fetchMe(): Promise<Me> {
  try {
    return await request<Me>("/api/me");
  } catch (err) {
    if ((err as { status?: number }).status !== 401) throw err;
    // Single-flight, so concurrent first loads share one guest account. A session cookie from before the move to
    // Better Auth is swapped for a new one first, so nobody who played before loses their character.
    signingIn ??= request("/api/auth/resume", {}).catch(() => request("/api/auth/sign-in/anonymous", {}));
    await signingIn;
    return request<Me>("/api/me");
  }
}

export const api = {
  /** Another hero's public sheet (or your own): name, level, stats and worn gear. */
  hero: (id: string) => request<{ hero: PublicHero }>(`/api/hero/${encodeURIComponent(id)}`),
  suggestName: (classId: string, avoid: string[]) => request<{ name: string }>("/api/character/name", { classId, avoid }),
  roll: (classId: string, name: string) => request<{ character: Character }>("/api/character/roll", { classId, name }),
  confirm: () => request("/api/character/confirm", {}),
  /** A new name for your hero (2 to 20 characters, not another hero's). Answers with the name as saved. */
  rename: (name: string) => request<{ name: string }>("/api/character/rename", { name }),
  setAppearance: (appearance: Appearance) => request("/api/character/appearance", { appearance }),
  reroll: () => request("/api/character/reroll", {}),
  spend: (stat: StatKey) => request("/api/character/spend", { stat }),
  /** Put a class ability in a slot (null empties it). Harbor only. */
  setAbility: (slot: number, ability: string | null) => request("/api/character/ability", { slot, ability }),
  equip: (itemId: number) => request("/api/character/equip", { itemId }),
  unequip: (itemId: number) => request("/api/character/unequip", { itemId }),
  /** Show or hide a worn piece on the hero; it counts either way. */
  hideGear: (itemId: number, hidden: boolean) => request("/api/character/hide", { itemId, hidden }),
  store: (itemId: number) => request("/api/inventory/store", { itemId }),
  sell: (itemId: number) => request<{ gold: number }>("/api/inventory/sell", { itemId }),
  sellMaterial: (kind: string, qty: number) => request<{ gold: number }>("/api/shop/materials/sell", { kind, qty }),
  shop: () => request<Shop>("/api/shop"),
  buy: (index: number) => request("/api/shop/buy", { index }),
  /** The notice board's release notes are read up to this release. */
  releaseSeen: (id: string) => request<{ seenRelease: string }>("/api/releases/seen", { id }),
  /** Log in to an account. A guest's character stays behind, unless the account has none yet. */
  logIn: (email: string, password: string) => request("/api/auth/sign-in/email", { email, password }),
  /** Make an account. A guest's character comes with them. */
  signUp: (email: string, password: string) => request("/api/auth/sign-up/email", { email, password, name: email.split("@")[0] }),
  /** Email a six-digit code for setting a new password. The answer is the same whether or not the address has an account. */
  sendPasswordCode: (email: string) => request("/api/auth/email-otp/send-verification-otp", { email, type: "forget-password" }),
  /** Set a new password with the emailed code. Logs in nobody: follow it with `logIn`. */
  resetPassword: (email: string, otp: string, password: string) => request("/api/auth/email-otp/reset-password", { email, otp, password }),
  signOut: () => request("/api/auth/sign-out", {}),
  /** The account's finished heroes, most recently played first, and how many an account may have. */
  heroes: () => request<{ heroes: HeroSlot[]; max: number }>("/api/heroes"),
  /** Play another of the account's heroes on this device, as themselves: no longer acting as one of the old party. */
  chooseHero: (id: string) => request("/api/heroes/choose", { id }).then((r) => (actAs(null), r)),
  /** Another of the account's heroes into the party of the hero being played, brought into this world if they are not in it. */
  addToParty: (id: string) => request("/api/party/add", { id }),
  /** One of the account's heroes out of the party. */
  leaveParty: (id: string) => request("/api/party/remove", { id }),
  /**
   * An empty slot to make a new hero in, now the one this device plays. No longer acting as one of the old party: the
   * requests that make the hero would otherwise go as that member, who has a character already.
   */
  newHero: () => request<{ id: string }>("/api/heroes/new", {}).then((r) => (actAs(null), r)),
  createCrew: (name: string) => request("/api/crew", { name }),
  joinCrew: (code: string) => request("/api/crew/join", { code }),
  /** Leave a world for good: the one named, or else the one the hero is in. */
  leaveCrew: (code?: string) => request("/api/crew/leave", code ? { code } : {}),
  /** Every world the account's heroes belong to, the most recently joined first, with which heroes are in each. */
  worlds: () => request<{ worlds: AccountWorld[] }>("/api/worlds"),
  gather: () => request<GatherStatus & { sitting?: SittingPaid }>("/api/gather"),
  /** Kept fish: the icebox and the trophy chest, with today's prices. */
  fish: () => request<FishStock>("/api/fish"),
  /** The fishmonger's counter: the bait and rods you have, and your gold. */
  bait: () => request<BaitCounter>("/api/fish/bait"),
  buyBait: (kind: BaitId) => request<BaitCounter>("/api/fish/bait", { kind }),
  buyRod: (kind: RodId) => request<BaitCounter>("/api/fish/rod", { kind }),
  buyBoat: (kind: BoatId) => request<BaitCounter>("/api/fish/boat", { kind }),
  /** Which of this tide's flotsam the crew has taken; and taking a piece from where the hero stands. */
  flotsam: () => request<{ taken: string[] }>("/api/flotsam"),
  takeFlotsam: (id: string) => request<FlotsamTaken>("/api/flotsam/take", { id }),
  sellFish: (ids: string[], to: "market" | "tam") => request<FishStock & { sold: { id: string; gold: number }[] }>("/api/fish/sell", { ids, to }),
  moveFish: (id: string, to: "trophy" | "icebox") => request<FishStock>("/api/fish/move", { id, to }),
  /** The Catch Book, with the crew's records. */
  catchBook: () => request<CatchBook>("/api/fish/book"),
  /** The pub's wall of record fish: hang yours, or take it down. */
  pubWall: () => request<PubWall>("/api/fish/wall"),
  wallFish: (fishId: string, down = false) => request<PubWall>("/api/fish/wall", { fishId, down }),
  /** Hang a fish from the trophy chest on a Mounted Fish at home, or take it down (null). */
  hangFish: (furnishingId: number, fishId: string | null) => request<{ ok: true }>("/api/fish/hang", { furnishingId, fishId }),
  rest: (place: "bedroll" | "hut") => request<GatherStatus & { regained: number }>("/api/rest", { place }),
  buyPlot: (plot: number) => request<{ plot: number }>("/api/hut/plot", { plot }),
  fillBin: () => request<{ put: Resources; bin: Resources | null }>("/api/hut/bin", {}),
  /** Start an outing. Fishing with a `pier` starts a sitting there. */
  gatherStart: (spot: GatherSpot, pier?: FishSpot) => request<GatherStatus>("/api/gather/start", { spot, pier }),
  gatherStep: (choice: GatherChoice) => request<GatherStatus & { paid?: Resources; xp?: XpResult; sitting?: SittingPaid }>("/api/gather/step", { choice }),
  pubLeaderboard: () => request<PubLeaderboard>("/api/pub/leaderboard"),
  pubOrder: (itemId: string) => request<PubOrdered>("/api/pub/order", { itemId }),
  pubTalk: (text: string) => request<{ say: string; left: number }>("/api/pub/talk", { text }),
  pubTalkLeft: () => request<{ left: number; cap: number }>("/api/pub/talk"),
  salesman: () => request<SalesmanView>("/api/pub/salesman", undefined, salesmanHeader()),
  buyFromSalesman: (index: number) => request<{ got: SalesEntry }>("/api/pub/salesman/buy", { index }, salesmanHeader()),
  regulars: () => request<RegularsView>("/api/pub/regulars"),
  errand: (regular: string, action: "accept" | "handin" | "trade" | "drop") => request<Partial<ErrandPaid> & { ok?: true }>("/api/pub/errand", { regular, action }),
  /** Hollis Crane, the dealer in materials: his board, what you have traded with him today, and his contracts. */
  dealer: () => request<DealerView>("/api/dealer"),
  dealerTrade: (side: "sell" | "buy", kind: string, qty: number) => request<{ gold: number; price: number; view: DealerView }>("/api/dealer/trade", { side, kind, qty }),
  dealerContract: (action: "take" | "deliver" | "drop", offer?: string) =>
    request<{ done: { paid?: number; early?: boolean; gave?: Partial<Record<string, number>>; xp?: XpResult } & Partial<HeldContractView>; view: DealerView }>("/api/dealer/contract", { action, offer }),
  projects: () => request<Works>("/api/projects"),
  apothecary: () => request<ApothecaryView>("/api/apothecary"),
  brewFlask: (kind: string) => request<ApothecaryView & { xp?: XpResult }>("/api/apothecary/flask", { kind }),
  smithy: () => request<SmithyView>("/api/smithy"),
  smith: (itemId: number) => request<SmithyView & { worked: string; xp?: XpResult }>("/api/smithy/work", { itemId }),
  /** Buy something ready-made from a keeper's own stock, by its key. */
  buyFromApothecary: (key: string) => request<ApothecaryView & { got: string }>("/api/apothecary/buy", { key }),
  buyFromSmith: (key: string) => request<SmithyView & { got: string }>("/api/smithy/buy", { key }),
  /** Ask a keeper to take something off a price: `ask` is one of HAGGLE_ASKS. One try a day for each thing. */
  haggle: (shop: string, key: string, ask: string) => request<HaggleResult>("/api/keeper/haggle", { shop, key, ask }),
  galley: () => request<GalleyView>("/api/galley"),
  giveToProject: (projectId: string, give: ProjectAmounts) => request<Works & { completed: boolean; xp?: XpResult }>("/api/projects/give", { projectId, give }),
  hut: () => request<Hut>("/api/hut"),
  craft: (defId: string) => request<{ ok: true; xp?: XpResult }>("/api/hut/craft", { defId }),
  /** Materials into (qty > 0) or out of (qty < 0) one of your hut's containers. */
  stash: (container: number, kind: string, qty: number) => request("/api/hut/stash", { container, kind, qty }),
  /** Gear from the bag into a container, or (container null) back into the bag. */
  stow: (container: number | null, itemId: number) => request("/api/hut/stow", { container, itemId }),
  upgradeHut: () => request<{ tier: number }>("/api/hut/upgrade", {}),
  /** Nell's catalogue as you see it: the finishes you own, what your hut wears, your gold, whether you have a hut standing, and what she has out today. */
  finishes: () => request<{ owned: string[]; finish: HutFinish; gold: number; hut: boolean; stock: string[]; restock: number }>("/api/finishes"),
  buyFinish: (id: string) => request<{ gold: number }>("/api/finishes/buy", { id }),
  /** Dress your hut's walls, floor or roof in a finish you own (null: back to plain). */
  setFinish: (kind: FinishKind, id: string | null) => request<{ finish: HutFinish }>("/api/hut/finish", { kind, id }),
  buyFurniture: (defId: string) => request("/api/shop/furniture", { defId }),
  sellFurniture: (furnishingId: number) => request<{ gold: number }>("/api/shop/furniture/sell", { furnishingId }),
  trades: () => request<TradeList>("/api/trade"),
  /** Open the trade table with a crewmate, or find the one already open between you. */
  openTrade: (to: string) => request<{ id: number }>("/api/trade/open", { to }),
  /** Lay out your side of the table. */
  offerTrade: (id: number, side: TradeSide) => request<{ rev: number }>("/api/trade/offer", { id, side }),
  /** Accept the table as it stood at `rev`, or take that back. */
  acceptTrade: (id: number, rev: number, ok = true) => request<{ settled: boolean }>("/api/trade/accept", { id, rev, ok }),
  closeTrade: (id: number) => request("/api/trade/close", { id }),
  // The dev toolbox's seeding. The server answers these only on a development deployment (server/dev.ts).
  /** Add gold to your purse, or take it with a negative amount. */
  /** Everyone in your crew and the zone each is on, if any. */
  crewPlaces: () => request<{ members: { id: string; name: string; classId: string; level: number; zone: { code: string; fighting: boolean } | null; town?: boolean }[] }>("/api/crew/places"),
  /** Where to go to join a crewmate: the zone they are on, or null for the Harbor. Refused while they are in a fight. */
  teleport: (to: string) => request<{ zone: string | null; name: string }>("/api/crew/teleport", { to }),
  /** The crew's chart: the Harbor, what is cleared, what is open, the fog beyond, and who is out on what. */
  atlas: () => request<Chart>("/api/atlas"),
  /** Set out for a place (the map the crew is fighting through there, or a fresh one), with the lodestone put into its slot (what it carries, joined with "+"; "" for a plain one). It comes out of your pack. */
  openNode: (node: string, stone?: string) => request<{ code: string; fresh: boolean }>("/api/atlas/open", { node, stone }),
  /**
   * Set out for a place, asking the crew first. Gives the map's `code` where nobody needs asking (a map already
   * begun there, or nobody else in town), and otherwise the `muster` that was called: the map is made when it starts.
   */
  callMuster: (node: string, stone?: string) => request<{ code?: string; muster?: Muster }>("/api/atlas/muster", { node, stone }),
  /** The crew's muster, if one is on or ended a moment ago. */
  muster: () => request<{ muster: Muster | null }>("/api/atlas/muster"),
  /** Answer the crew's muster: "ready" or "no"; for whoever called it, "start" or "cancel". */
  answerMuster: (answer: MusterAnswer) => request<{ muster: Muster }>("/api/atlas/muster/answer", { answer }),
  /** The crew's town chest: its tabs and what is in each. Every call below gives the chest back as it now is. */
  chest: () => request<ChestView>("/api/chest"),
  /** A hut's garden, yours or a crewmate's, and what you hold to tend it with. */
  garden: (owner: string) => request<GardenView>(`/api/garden/${encodeURIComponent(owner)}`),
  gardenPlant: (bed: number, sow: SowWith) => request<{ ok: true }>("/api/garden/plant", { bed, with: sow }),
  gardenWater: (owner: string, bed: number) => request<{ ok: true }>("/api/garden/water", { owner, bed }),
  gardenFeed: (owner: string, bed: number) => request<{ ok: true }>("/api/garden/feed", { owner, bed }),
  gardenPick: () => request<{ herbs: number; mushrooms: number; beds: number; xp?: XpResult }>("/api/garden/pick", {}),
  grindBone: (qty: number) => request<{ bonemeal: number }>("/api/garden/grind", { qty }),
  /** Your watering can: how many waterings are in it (null: you have none). */
  can: () => request<{ water: number | null }>("/api/can"),
  /** The town well: the can, the water skins, the day's coins and the luck held. */
  well: () => request<WellView>("/api/well"),
  wellSkin: () => request<{ skins: number }>("/api/well/skin", {}),
  wellCoin: () => request<{ gift: "gem" | "xp" | null; luck: number; tossed: number; xp?: XpResult }>("/api/well/coin", {}),
  fillCan: () => request<{ water: number }>("/api/can/fill", {}),
  buyCan: () => request<{ ok: true }>("/api/shop/can", {}),
  buySeeds: (qty: number) => request<{ seeds: number; gold: number }>("/api/shop/seeds", { qty }),
  /** Put a piece of gear from your pack into a tab of the chest, or take one (by its id in the chest) out into your pack. */
  chestStow: (tab: number, item: number) => request<ChestView>("/api/chest/stow", { tab, item }),
  chestUnstow: (item: number) => request<ChestView>("/api/chest/unstow", { item }),
  /** Put `qty` of a kind of stack (a material, a lodestone) from your pack into a tab of the chest, or take it out. */
  chestPut: (tab: number, kind: string, qty: number) => request<ChestView>("/api/chest/put", { tab, kind, qty }),
  chestTake: (tab: number, kind: string, qty: number) => request<ChestView>("/api/chest/take", { tab, kind, qty }),
  /** Buy the chest another tab with your gold, for the whole crew; or give a tab another name, a colour (null for none), or another place among the tabs (from 0). */
  chestBuyTab: (name?: string) => request<ChestView>("/api/chest/tab", { name }),
  chestRenameTab: (tab: number, name: string) => request<ChestView>("/api/chest/rename", { tab, name }),
  chestColorTab: (tab: number, color: string | null) => request<ChestView>("/api/chest/color", { tab, color }),
  chestMoveTab: (tab: number, to: number) => request<ChestView>("/api/chest/move", { tab, to }),
  /** Sell gems out of your pack to the lapidary. */
  sellGems: (qty: number) => request<{ gold: number }>("/api/lapidary/gems/sell", { qty }),
  /** Work lodestones at the lapidary's bench, out of your pack: fuse three (each as it is sent) into one, attune one to a modifier, or reroll one. */
  benchFuse: (stones: string[]) => request<{ made: Lodestone; lodestones: HeldStone[] }>("/api/atlas/bench", { op: "fuse", stones }),
  benchAttune: (stone: string, mod: string) => request<{ made: Lodestone; lodestones: HeldStone[] }>("/api/atlas/bench", { op: "attune", stone, mod }),
  benchTemper: (stone: string, mod: string) => request<{ made: Lodestone; lodestones: HeldStone[] }>("/api/atlas/bench", { op: "temper", stone, mod }),
  benchReroll: (stone: string) => request<{ made: Lodestone; lodestones: HeldStone[] }>("/api/atlas/bench", { op: "reroll", stone }),
  /** Cut a plain lodestone from stone and iron, into your pack. */
  cutStone: () => request<{ lodestones: HeldStone[] }>("/api/atlas/cut", {}),
  devAtlas: (op: "clear" | "reset" | "stone", node?: string) => request<Chart>("/api/dev/atlas", { op, node }),
  /** Down into the caves: the crew's cave still being fought through, or a fresh one. */
  caves: () => request<{ code: string; fresh: boolean }>("/api/caves", {}),
  /** Make a zone to try fights in, from these options (and a seed, or a fresh one), and get its code. */
  devZone: (options: Record<string, unknown>) => request<{ code: string; seed: string }>("/api/dev/zone", options),
  devGold: (amount: number) => request<{ gold: number }>("/api/dev/gold", { amount }),
  /** Put one piece of gear in your pack: a weapon or a base by its ref, at a rarity and level. */
  devGear: (ref: string, rarity: string, level: number) => request<{ item: ItemDef }>("/api/dev/gear", { ref, rarity, level }),
  /** Add some of one material to your pack, or take it with a negative amount. */
  devMaterial: (kind: string, qty: number) => request<{ kind: string; qty: number }>("/api/dev/material", { kind, qty }),
};
