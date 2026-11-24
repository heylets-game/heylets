// Heroes start with their class ability slots filled: a new one when it is confirmed, and one from before
// that the first time it is loaded after. Against a real SQLite database with the game's migrations applied
// (the stand-in for D1 in d1.ts).

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { poolFor } from "@gantt-quest/world";
import { confirmCharacter, fillAbilitySlots, setAbilitySlot } from "../src/server/db";
import { addHero, openDb } from "./d1";

let sql: DatabaseSync;
let db: D1Database;
const loadoutOf = (id: string) => JSON.parse((sql.prepare("SELECT ability_loadout FROM characters WHERE player_id = ?").get(id) as { ability_loadout: string }).ability_loadout);
const setLoadout = (id: string, loadout: (string | null)[]) => sql.prepare("UPDATE characters SET ability_loadout = ? WHERE player_id = ?").run(JSON.stringify(loadout), id);
const [a, b, c, d] = poolFor("qa_paladin").map((e) => e.id);

beforeEach(() => {
  ({ sql, db } = openDb());
});

describe("a new hero", () => {
  it("is confirmed with all three slots filled", async () => {
    addHero(sql, { id: "ann", name: "Ann", status: "draft" });
    expect(await confirmCharacter(db, "ann")).toBe(true);
    expect(loadoutOf("ann")).toEqual([a, b, c]);
    expect(await fillAbilitySlots(db, "ann")).toBe(false);
  });
});

describe("fillAbilitySlots", () => {
  it("fills the empty slots of a hero from before, keeping what they chose", async () => {
    addHero(sql, { id: "bob", name: "Bob" });
    setLoadout("bob", [null, d, null]);
    expect(await fillAbilitySlots(db, "bob")).toBe(true);
    expect(loadoutOf("bob")).toEqual([a, d, b]);
  });

  it("is done once, so a slot emptied after stays empty", async () => {
    addHero(sql, { id: "cat", name: "Cat" });
    expect(await fillAbilitySlots(db, "cat")).toBe(true);
    expect(await setAbilitySlot(db, "cat", 2, null)).toBeNull();
    expect(await fillAbilitySlots(db, "cat")).toBe(false);
    expect(loadoutOf("cat")).toEqual([a, b, null]);
  });

  it("leaves a draft alone", async () => {
    addHero(sql, { id: "dan", name: "Dan", status: "draft" });
    expect(await fillAbilitySlots(db, "dan")).toBe(false);
    expect(loadoutOf("dan")).toEqual([]);
  });
});
