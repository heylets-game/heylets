// A hero as a fighter: what a fight on the tiles needs to know about them
// (zone/zone.ts builds its heroes from a HeroSheet).

import type { Stats } from "@gantt-quest/core";
import { isLanternHelm, loadoutOf, outfitOf, perksOf, type ItemDef, type Outfit, type Perks } from "./gear";

/** The parts of a hero that decide how they fight. */
export interface HeroSheet {
  id: string;
  name: string;
  classId: string;
  level: number;
  /** Base stats, without gear. */
  base: Stats;
  /** Sum of equipped gear bonuses. */
  bonus: Partial<Stats>;
  weapon: string;
  /** Damage bonus from the equipped weapon. */
  weaponPower: number;
  /** Armor total from equipped gear. */
  armor: number;
  /** What the hero is visibly wearing, for drawing them. */
  outfit?: Outfit;
  /** A lantern helm on the head, shown or hidden (isLanternHelm): it lights the dark round them in the caves. */
  lantern?: boolean;
  /** Powers from what the hero wears, shown or hidden, each with its strength (gear.ts perksOf). Absent when there are none. */
  perks?: Perks;
  /** The class abilities chosen for the hero's slots (classabilities.ts). Fought with on top of the weapon's. They are changed only in the Harbor. */
  abilityLoadout?: (string | null)[];
  /** The pub meal (PUB_MENU id) the hero ate today, if they did. Its stat points are already in `bonus`. */
  fed?: string;
}

/** What the server knows about a character wherever they turn up: the Harbor, a hut, the pub or a map. */
export interface HeroInit extends HeroSheet {
  xp: number;
  unspent: number;
}

/** What equipped items contribute to a hero. With no weapon in hand the hero is unarmed (`weapon` is ""), and fights with bare hands. */
export function gearSheet(classId: string, worn: ItemDef[]): Pick<HeroSheet, "bonus" | "weapon" | "weaponPower" | "armor" | "outfit" | "lantern" | "perks"> {
  const loadout = loadoutOf(worn);
  // The hat as worn, hidden or not: a hidden lantern helm is not drawn, but still lights the way.
  const hat = worn.find((i) => i.slot === "helmet");
  const perks = perksOf(worn);
  return {
    bonus: loadout.bonus,
    weapon: loadout.weapon ?? "",
    weaponPower: loadout.weaponPower,
    armor: loadout.armor,
    outfit: outfitOf(worn),
    // A Miner's Lamp lights the way as a lantern helm does.
    ...((hat && isLanternHelm(classId, hat)) || perks.lamp ? { lantern: true } : {}),
    ...(Object.keys(perks).length > 0 ? { perks } : {}),
  };
}
