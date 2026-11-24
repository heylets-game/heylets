// What every other module in db/ starts from: the Worker's bindings, a
// player, the character and inventory rows as D1 holds them, and the
// statements that put a new item into a pack.

import type { Stats } from "@gantt-quest/core";
import type { ItemDef, ItemKind, Rarity, Slot } from "@gantt-quest/world";
import type { HarborRoom } from "../harbor-room";
import type { HutRoom } from "../hut-room";
import type { PubRoom } from "../pub-room";
import type { ZoneRoom } from "../zone-room";

export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS: Fetcher;
  HARBOR_ROOM: DurableObjectNamespace<HarborRoom>;
  HUT_ROOM: DurableObjectNamespace<HutRoom>;
  PUB_ROOM: DurableObjectNamespace<PubRoom>;
  ZONE_ROOM: DurableObjectNamespace<ZoneRoom>;
  /** "mock" replaces Workers AI with a scripted stand-in. */
  AI_MODE?: string;
  /** Email Sending binding. Without it (and MAIL_FROM_ADDRESS) sign-in codes go to the log. */
  EMAIL?: SendEmail;
  MAIL_FROM_ADDRESS?: string;
  MAIL_FROM_NAME?: string;
  /** Secret: signs login cookies (auth.ts). Required on a deployed Worker; localhost falls back to a fixed one. */
  BETTER_AUTH_SECRET?: string;
  /** Secret: comma-separated emails allowed into the admin side. Unset means nobody is an admin. */
  ADMIN_EMAILS?: string;
  /** "dev" on local and staging: the client shows the dev toolbox and its seeding routes answer (dev.ts). Production leaves it out. */
  ENVIRONMENT?: string;
}

export interface Player {
  id: string;
  name: string;
  /** Null for a guest: the account exists only in this browser's cookie. */
  email: string | null;
  /** The account (Better Auth user) this hero belongs to. Absent where a player is made up without one (tests, rooms). */
  userId?: string;
}

export interface CharacterRow {
  player_id: string;
  /** Earned by filling the Catch Book. */
  title?: string | null;
  name: string;
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
  /** JSON list of the class abilities chosen for the hero's slots (parse with parseAbilityLoadout). */
  ability_loadout: string;
  /** 1 once its class ability slots have been filled for it (fillAbilitySlots). */
  ability_loadout_filled?: number;
  /** JSON Appearance (appearance.ts), or null if they never chose one. */
  appearance?: string | null;
}

export interface InventoryRow {
  id: number;
  kind: ItemKind;
  ref: string;
  name: string;
  rarity: Rarity;
  slot: Slot;
  power: number;
  level_req: number;
  icon: string;
  stat_bonus_json: string;
  equipped: number;
  /** The container at home it is kept in, or null while it is worn or carried. */
  stored_in: number | null;
  /** Steps of work done at the smithy, already counted in `power`. */
  upgrades: number;
  /** 1 while worn but not drawn on the hero. */
  hidden: number;
}

export function rowToItem(row: InventoryRow): ItemDef {
  return {
    kind: row.kind,
    ref: row.ref,
    name: row.name,
    rarity: row.rarity,
    slot: row.slot,
    power: row.power,
    statBonus: JSON.parse(row.stat_bonus_json) as Partial<Stats>,
    levelReq: row.level_req,
    icon: row.icon,
    ...(row.upgrades ? { upgrades: row.upgrades } : {}),
    ...(row.hidden ? { hidden: true } : {}),
  };
}

export function insertItem(db: D1Database, playerId: string, item: ItemDef, equipped: boolean, storedIn: number | null = null): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO inventory (player_id, kind, ref, name, rarity, slot, power, level_req, icon, stat_bonus_json, equipped, stored_in, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(playerId, item.kind, item.ref, item.name, item.rarity, item.slot, item.power, item.levelReq, item.icon, JSON.stringify(item.statBonus), equipped ? 1 : 0, storedIn, Date.now());
}

/**
 * A new unequipped item into the pack, but only if the statement before it
 * in the batch changed a row. Put the pack's room check in that statement
 * (see `buyShopItem`): this one does not look at the limit.
 */
export function paidItemStatement(db: D1Database, playerId: string, item: ItemDef): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO inventory (player_id, kind, ref, name, rarity, slot, power, level_req, icon, stat_bonus_json, equipped, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ? WHERE changes() > 0",
    )
    .bind(playerId, item.kind, item.ref, item.name, item.rarity, item.slot, item.power, item.levelReq, item.icon, JSON.stringify(item.statBonus), Date.now());
}

export async function getItem(db: D1Database, playerId: string, itemId: number): Promise<InventoryRow | null> {
  return db.prepare("SELECT * FROM inventory WHERE id = ? AND player_id = ? AND stored_in IS NULL").bind(itemId, playerId).first<InventoryRow>();
}

export const now = () => Date.now();

export const statsOf = (c: CharacterRow): Stats => ({ str: c.str, int_stat: c.int_stat, vit: c.vit, agi: c.agi, dex: c.dex });

/**
 * SQL for the world (crew id) a player is in now, with `param` the placeholder for their id: the one they last went
 * into (players.current_crew_id) while they still belong to it, else the one they joined most recently. Null if none.
 */
export const currentCrewSql = (param: string) =>
  `(SELECT m.crew_id FROM crew_members m LEFT JOIN players p ON p.id = m.player_id WHERE m.player_id = ${param} ORDER BY m.crew_id = p.current_crew_id DESC, m.joined_at DESC LIMIT 1)`;

// ---------- a home in each world ----------
// A hero's hut, its furniture (and so what its chests hold) and its garden are theirs in one world (huts.crew_id,
// furnishings.crew_id, garden_beds.crew_id): a hero acting on their own home acts on the one in the world they are in
// now. The boats kept at the pier are the exception: furnishings with no crew_id, the hero's in every world.

/** Furnishings that are the hero's in every world, not in one world's hut: the boats kept at the pier. */
export const HERO_WIDE_FURNISHINGS: readonly string[] = ["rowboat", "float_barrel"];
const HERO_WIDE_SQL = `(${HERO_WIDE_FURNISHINGS.map((d) => `'${d}'`).join(", ")})`;

/** SQL for the world hero `who` is in now, as a home's key: '' (a home nobody can reach) if they are in none. */
export const homeCrewSql = (who: string) => `COALESCE(${currentCrewSql(who)}, '')`;

/** SQL for the crew_id of a new furnishing of def `def` for hero `who`: none for a boat (every world), else the world they are in now. */
export const newFurnishingCrewSql = (who: string, def: string) => `CASE WHEN ${def} IN ${HERO_WIDE_SQL} THEN NULL ELSE ${homeCrewSql(who)} END`;

/** SQL, true for a furnishing (columns prefixed `f`, as "f.") that is in its owner's home in world `crew`: that world's hut's, or a boat. */
export const inHomeSql = (crew: string, f = "") => `(${f}crew_id = ${crew} OR ${f}crew_id IS NULL)`;

/** SQL for the ids of hero `who`'s furnishings in their home in world `crew`: what a stash row or kept gear must point at to be there. */
export const homeFurnishingIdsSql = (who: string, crew: string) => `(SELECT id FROM furnishings WHERE player_id = ${who} AND ${inHomeSql(crew)})`;
