// What the townsfolk have heard about a crew (server/gossip.ts), against a real SQLite database with the game's
// migrations (d1.ts): only the crew's own heroes, only lately, and the newest lines off the notice board.

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { FISH, atlasNodeById, formatWeight, type Gossip } from "@gantt-quest/world";
import { GOSSIP_RECENT_MS, crewGossip, newsLine } from "../src/server/gossip";
import { addHero, openDb } from "./d1";

let sql: DatabaseSync;
let db: D1Database;
const NOW = Date.UTC(2026, 10, 25, 12);
const DAY = 86_400_000;
const CREW = "CREWAA";
const SPECIES = Object.keys(FISH)[0];

beforeEach(() => {
  ({ sql, db } = openDb());
  addHero(sql, { id: "josh", name: "Josh", crew: CREW, at: NOW - 10 * DAY });
  addHero(sql, { id: "grey", name: "Greyson", crew: CREW, at: NOW - 10 * DAY });
  addHero(sql, { id: "out", name: "Stranger", crew: "OTHERS", at: NOW - 10 * DAY });
});

const bed = (player: string, crew: string, n: number, crop: string, readyAt: number) =>
  sql.prepare("INSERT INTO garden_beds (player_id, crew_id, bed, crop, planted_at, ready_at) VALUES (?, ?, ?, ?, ?, ?)").run(player, crew, n, crop, NOW - DAY, readyAt);
const weapon = (player: string, name: string, rarity: string, equipped = 1) =>
  sql.prepare("INSERT INTO inventory (player_id, kind, ref, name, rarity, slot, equipped, created_at) VALUES (?, 'weapon', 'x', ?, ?, 'main_hand', ?, ?)").run(player, name, rarity, equipped, NOW);
const trip = (crew: string, node: string, by: string, at: number, status = "open") =>
  sql.prepare("INSERT INTO atlas_nodes (crew_id, node, status, opened_by, opened_at) VALUES (?, ?, ?, ?, ?)").run(crew, node, status, by, at);
const record = (crew: string, player: string, at: number, species = SPECIES) =>
  sql.prepare("INSERT INTO fish_records (crew_id, species, grams, mm, player_id, caught_at) VALUES (?, ?, 3200, 600, ?, ?)").run(crew, species, player, at);
const of = <K extends Gossip["kind"]>(all: Gossip[], kind: K) => all.filter((g): g is Extract<Gossip, { kind: K }> => g.kind === kind);

describe("the crew's gossip", () => {
  it("says whose garden is coming on, and whether any of it is ready", async () => {
    bed("josh", CREW, 0, "herbs", NOW - 1);
    bed("josh", CREW, 1, "herbs", NOW + DAY);
    bed("grey", CREW, 0, "mushrooms", NOW + DAY);
    bed("out", "OTHERS", 0, "herbs", NOW - 1);
    const gardens = of(await crewGossip(db, CREW, NOW), "garden");
    expect(gardens).toEqual([
      { kind: "garden", who: "Josh", crop: "herbs", beds: 2, ready: true },
      { kind: "garden", who: "Greyson", crop: "mushrooms", beds: 1, ready: false },
    ]);
  });

  it("says who set out for where lately, and whether it is cleared", async () => {
    trip(CREW, "1,0", "grey", NOW - DAY);
    trip(CREW, "2,0", "josh", NOW - 2 * DAY, "cleared");
    trip(CREW, "0,1", "josh", NOW - GOSSIP_RECENT_MS - 1);
    trip("OTHERS", "1,0", "out", NOW);
    const trips = of(await crewGossip(db, CREW, NOW), "voyage");
    expect(trips).toEqual([
      { kind: "voyage", who: "Greyson", place: atlasNodeById(CREW, "1,0")!.name, cleared: false },
      { kind: "voyage", who: "Josh", place: atlasNodeById(CREW, "2,0")!.name, cleared: true },
    ]);
  });

  it("remarks only on a weapon in hand that is more than common", async () => {
    weapon("josh", "Anchor Mace", "common");
    weapon("grey", "Storm Cutlass", "rare");
    weapon("grey", "Old Harpoon", "epic", 0);
    weapon("out", "Big Axe", "legendary");
    // (Gear worn elsewhere is not a weapon in hand.)
    sql.prepare("INSERT INTO inventory (player_id, kind, ref, name, rarity, slot, equipped, created_at) VALUES ('josh', 'armor', 'x', 'Gilded Helm', 'epic', 'helmet', 1, ?)").run(NOW);
    expect(of(await crewGossip(db, CREW, NOW), "gear")).toEqual([{ kind: "gear", who: "Greyson", item: "Storm Cutlass" }]);
  });

  it("brings up the crew's newest record catches", async () => {
    record(CREW, "josh", NOW - DAY);
    record("OTHERS", "out", NOW - DAY);
    expect(of(await crewGossip(db, CREW, NOW), "fish")).toEqual([{ kind: "fish", who: "Josh", fish: FISH[SPECIES].name.toLowerCase(), weight: formatWeight(3200) }]);
  });

  it("reads out the newest lines on the notice board, short enough for a bubble", async () => {
    for (const n of of(await crewGossip(db, CREW, NOW), "news")) {
      expect(n.text.length).toBeLessThanOrEqual(80);
      expect(n.text).toMatch(/[.!?]$/);
    }
    expect(newsLine("Fishing", "a perfect catch pays a little more")).toBe("Fishing: a perfect catch pays a little more.");
    expect(newsLine(null, "Rename yourself from your hero sheet!")).toBe("Rename yourself from your hero sheet!");
  });

  it("has nothing about a crew that has done nothing but the news", async () => {
    expect((await crewGossip(db, CREW, NOW)).every((g) => g.kind === "news")).toBe(true);
  });
});
