// Worlds on the account (db/crews.ts): a hero belongs to several worlds and
// is in one at a time; joining another keeps the first; leaving one puts them
// in the next; each world is its own home, with a plot bought in each.

import { describe, expect, it } from "vitest";
import { buyPlot } from "../src/server/db/plots";
import { createCrew, crewFor, harborBoard, joinCrew, leaveCrew, worldsOfAccount } from "../src/server/db/crews";
import { addHero, openDb } from "./d1";

describe("a hero in several worlds", () => {
  it("joins a second world without leaving the first, and is in the one they went into last", async () => {
    const { db, sql } = openDb();
    addHero(sql, { id: "ann", name: "Ann" });
    const first = await createCrew(db, "ann", "First");
    expect((await crewFor(db, "ann"))?.id).toBe(first.id);

    addHero(sql, { id: "bo", name: "Bo" });
    const second = await createCrew(db, "bo", "Second");
    const joined = await joinCrew(db, "ann", second.id, 40);
    expect(joined).toMatchObject({ id: second.id, joined: true });
    expect((await crewFor(db, "ann"))?.id).toBe(second.id);
    // Still a member of the first: going back is not a new join.
    expect(await joinCrew(db, "ann", first.id, 40)).toMatchObject({ id: first.id, joined: false });
    expect((await crewFor(db, "ann"))?.id).toBe(first.id);
    expect((await harborBoard(db, first.id)).members.map((m) => m.id)).toContain("ann");
    expect((await harborBoard(db, second.id)).members.map((m) => m.id)).toContain("ann");
  });

  it("leaving the world they are in puts them in their other one", async () => {
    const { db, sql } = openDb();
    addHero(sql, { id: "ann", name: "Ann" });
    const first = await createCrew(db, "ann", "First");
    const second = await createCrew(db, "ann", "Second");
    expect((await crewFor(db, "ann"))?.id).toBe(second.id);
    await leaveCrew(db, "ann");
    expect((await crewFor(db, "ann"))?.id).toBe(first.id);
    await leaveCrew(db, "ann", first.id);
    expect(await crewFor(db, "ann")).toBeNull();
  });

  it("a full world still lets its own members back in", async () => {
    const { db, sql } = openDb();
    addHero(sql, { id: "ann", name: "Ann" });
    addHero(sql, { id: "bo", name: "Bo" });
    const world = await createCrew(db, "ann", "Small");
    expect(await joinCrew(db, "bo", world.id, 1)).toBeNull();
    const elsewhere = await createCrew(db, "ann", "Elsewhere");
    expect((await crewFor(db, "ann"))?.id).toBe(elsewhere.id);
    expect(await joinCrew(db, "ann", world.id, 1)).toMatchObject({ id: world.id, joined: false });
  });

  it("each world is its own home: a plot is bought in each, and each is drawn only in its own world", async () => {
    const { db, sql } = openDb();
    addHero(sql, { id: "ann", name: "Ann", gold: 10_000 });
    const home = await createCrew(db, "ann", "Home");
    expect(await buyPlot(db, home.id, "ann", 2, 12)).toBeNull();
    const away = await createCrew(db, "ann", "Away");

    const plotIn = async (crewId: string) => (await harborBoard(db, crewId)).members.find((m) => m.id === "ann")?.plot ?? null;
    expect(await plotIn(home.id)).toBe(2);
    expect(await plotIn(away.id)).toBeNull();
    // A new world means a new plot, even the same number of one, and only one in each world.
    expect(await buyPlot(db, away.id, "ann", 2, 12)).toBeNull();
    expect(await buyPlot(db, away.id, "ann", 5, 12)).toBe("You already own a plot.");
    expect(await plotIn(away.id)).toBe(2);
    expect(await plotIn(home.id)).toBe(2);

    // Leaving a world gives up the plot there, and only there; the hut is kept for a rejoin.
    await leaveCrew(db, "ann", away.id);
    expect(await plotIn(home.id)).toBe(2);
    expect(sql.prepare("SELECT plot FROM huts WHERE player_id = 'ann' AND crew_id = ?").get(away.id)).toEqual({ plot: null });
  });

  it("lists every world an account's heroes are in, with which heroes", async () => {
    const { db, sql } = openDb();
    addHero(sql, { id: "ann", name: "Ann" });
    addHero(sql, { id: "cy", name: "Cy" });
    sql.prepare("UPDATE players SET user_id = 'acct' WHERE id IN ('ann', 'cy')").run();
    const first = await createCrew(db, "ann", "First");
    await joinCrew(db, "cy", first.id, 40);
    await createCrew(db, "cy", "Second");
    const worlds = await worldsOfAccount(db, "acct");
    // (Joined in the same millisecond here, so compared by name rather than in order.)
    expect(worlds.map((w) => [w.name, w.heroes.map((h) => h.name).sort()]).sort()).toEqual([
      ["First", ["Ann", "Cy"]],
      ["Second", ["Cy"]],
    ]);
  });
});
