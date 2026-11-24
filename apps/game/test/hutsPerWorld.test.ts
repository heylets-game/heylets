// Each world is its own home (migration 0064): a hero's hut, its furniture, what its chests hold and its garden are
// theirs in one world, and acting on "your hut" acts on the one in the world you are in now. The boats are the
// exception: the hero's in every world. Someone else's hut is the one in the world the visitor is in.

import { describe, expect, it } from "vitest";
import { buyBoat } from "../src/server/bait";
import { getHut, homeOf, resourceStatements, furnishingStatement, stashMaterial, storeItem, upgradeHut } from "../src/server/db";
import { createCrew, joinCrew } from "../src/server/db/crews";
import { buyPlot } from "../src/server/db/plots";
import { ownedVessel } from "../src/server/fishmarket";
import { gardenView, plantBed } from "../src/server/garden";
import { enterHut } from "../src/server/hut-room";
import { addHero, openDb } from "./d1";

/** Ann in two worlds, Home and Away (in Away now), with a plot and a standing shack in Home. */
async function twoWorlds() {
  const { db, sql } = openDb();
  addHero(sql, { id: "ann", name: "Ann", gold: 10_000 });
  addHero(sql, { id: "bo", name: "Bo" });
  const home = await createCrew(db, "ann", "Home");
  const shack = async (crewId: string, plot: number) => {
    expect(await buyPlot(db, crewId, "ann", plot, 12)).toBeNull();
    sql.prepare("UPDATE huts SET bin_json = NULL WHERE player_id = 'ann' AND crew_id = ?").run(crewId);
  };
  await shack(home.id, 1);
  // Furnished in Home: a chair and a chest, wood in the chest, a ring kept in it.
  await db.batch([
    furnishingStatement(db, "ann", { defId: "chair", label: "Chair" }),
    furnishingStatement(db, "ann", { defId: "storage_chest", label: "Storage Chest" }),
    ...resourceStatements(db, "ann", { wood: 5 }),
  ]);
  const chest = (sql.prepare("SELECT id FROM furnishings WHERE player_id = 'ann' AND def_id = 'storage_chest'").get() as { id: number }).id;
  expect(await stashMaterial(db, "ann", chest, "wood", 3)).toBeNull();
  const ring = Number(
    sql.prepare("INSERT INTO inventory (player_id, kind, ref, name, rarity, slot, equipped, created_at) VALUES ('ann', 'trinket', 'ring', 'Ring', 'common', 'ring', 0, 0)").run().lastInsertRowid,
  );
  expect(await storeItem(db, "ann", ring)).toBeNull();
  const away = await createCrew(db, "ann", "Away");
  return { db, sql, home, away, chest, ring, shack };
}

describe("a home in each world", () => {
  it("keeps a hero's hut, furniture and storage apart in each of their worlds", async () => {
    const { db, home, away, chest, ring, shack } = await twoWorlds();

    // In Away (where Ann is now) there is nothing of the hut in Home.
    const here = await getHut(db, "ann");
    expect(here.furnishings).toEqual([]);
    expect(here.stash).toEqual([]);
    expect(here.stowed).toEqual([]);
    expect(await homeOf(db, "ann")).toEqual({ plot: null, bin: null });
    // Materials in the pack and blueprints are hers everywhere.
    expect(here.resources.wood).toBe(2);

    // Home's hut is all still there, read for that world.
    const there = await getHut(db, "ann", home.id);
    expect(there.furnishings.map((f) => f.defId).sort()).toEqual(["chair", "storage_chest"]);
    expect(there.stash).toEqual([{ containerId: chest, kind: "wood", qty: 3 }]);
    expect(there.stowed.map((s) => s.itemId)).toEqual([ring]);

    // Home's chest cannot be reached from Away, and with no hut standing here there is nowhere to keep things.
    expect(await stashMaterial(db, "ann", chest, "wood", -1)).toBe("That does not hold anything.");
    expect(await storeItem(db, "ann", ring)).not.toBeNull();

    // A hut built here starts bare and small, and growing it leaves Home's as it was.
    await shack(away.id, 1);
    expect((await getHut(db, "ann")).furnishings).toEqual([]);
    await db.batch(resourceStatements(db, "ann", { wood: 500, stone: 500, iron: 500, copper: 500, fur: 500, bone: 500 }));
    expect(await upgradeHut(db, "ann")).toEqual({ tier: 2 });
    expect((await getHut(db, "ann")).tier).toBe(2);
    expect((await getHut(db, "ann", home.id)).tier).toBe(1);

    // Back in Home, the hut there is the hero's hut again.
    await joinCrew(db, "ann", home.id, 40);
    expect((await getHut(db, "ann")).furnishings.map((f) => f.defId).sort()).toEqual(["chair", "storage_chest"]);
    expect(await stashMaterial(db, "ann", chest, "wood", -1)).toBeNull();
  });

  it("keeps the boats with the hero in every world", async () => {
    const { db, home } = await twoWorlds();
    expect(await buyBoat(db, "ann", "rowboat")).not.toBeTypeOf("string");
    expect(await ownedVessel(db, "ann")).toBe("rowboat");
    expect((await getHut(db, "ann")).furnishings.map((f) => f.defId)).toEqual(["rowboat"]);
    await joinCrew(db, "ann", home.id, 40);
    expect(await ownedVessel(db, "ann")).toBe("rowboat");
    expect((await getHut(db, "ann")).furnishings.map((f) => f.defId)).toContain("rowboat");
    // And one is all she may buy, wherever she is.
    expect(await buyBoat(db, "ann", "rowboat")).toBeTypeOf("string");
  });

  it("shows a visitor the owner's hut in the visitor's world, wherever the owner is now", async () => {
    const { db, sql, home, away } = await twoWorlds();
    // Ann goes back to Home; Bo is in Away, where Ann has no hut yet; Cy is in a world Ann is not in.
    await joinCrew(db, "ann", home.id, 40);
    expect(await joinCrew(db, "bo", away.id, 40)).not.toBeNull();
    addHero(sql, { id: "cy", name: "Cy" });
    await createCrew(db, "cy", "Elsewhere");

    const rooms: { name: string; crew: string | null }[] = [];
    const env = {
      DB: db,
      HUT_ROOM: {
        idFromName: (name: string) => name,
        get: (name: string) => ({
          fetch: async (req: Request) => {
            rooms.push({ name, crew: req.headers.get("x-hut-crew") });
            return new Response("ok");
          },
        }),
      },
    } as never;
    const walkIn = async (who: string) => {
      const res = await enterHut(env, { id: who, name: who, email: null }, "ann", new Request("https://game/api/hut/ann/ws"));
      return res.status === 200 ? "in" : await res.text();
    };

    // Bo is in Away: Ann's hut there is not built, whatever stands in Home.
    expect(await walkIn("bo")).toBe("They have not built a hut yet.");
    sql.prepare("INSERT INTO huts (player_id, crew_id, tier, plot, bin_json) VALUES ('ann', ?, 1, 3, NULL)").run(away.id);
    expect(await walkIn("bo")).toBe("in");
    expect(rooms.at(-1)).toEqual({ name: `ann:${away.id}`, crew: away.id });
    // Ann walks into her own: the one in the world she is in.
    expect(await walkIn("ann")).toBe("in");
    expect(rooms.at(-1)).toEqual({ name: `ann:${home.id}`, crew: home.id });
    // Cy shares no world with Ann.
    expect(await walkIn("cy")).toBe("That hut is not in your crew's Harbor.");

    // Her garden in Home has a bed growing; Bo, in Away, is shown the bare one by her hut there.
    await db.batch(resourceStatements(db, "ann", { seeds: 1 }));
    expect(await plantBed(db, "ann", 0, "seeds")).toBeNull();
    expect(await gardenView(db, "ann", "ann")).toMatchObject({ growing: [{ bed: 0 }] });
    expect(await gardenView(db, "bo", "ann")).toMatchObject({ growing: [] });
  });
});
