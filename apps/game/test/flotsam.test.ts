// Flotsam fished out of the Harbor, against a real SQLite database with the game's migrations applied (d1.ts): what
// is in a piece paid to the one who took it, the first to take it having it, and only from on it or beside it.

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { hexDistance, type HexPos } from "@gantt-quest/core";
import { FLOTSAM_TIDE_MS, flotsamAt, flotsamFind, generateHarbor, type Flotsam } from "@gantt-quest/world";
import { flotsamTaken, takeFlotsam } from "../src/server/flotsam";
import { addHero, openDb } from "./d1";

const MAP = generateHarbor();
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0);
let sql: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  ({ sql, db } = openDb());
  addHero(sql, { id: "ann", name: "Ann", crew: "CREWAA", at: 0, gold: 10 });
  addHero(sql, { id: "bob", name: "Bob", crew: "CREWAA", at: 0, gold: 10 });
});

/** The first piece, over the tides from T0, that `pick` likes, and when it lies there. */
function find(pick: (f: Flotsam) => boolean): { piece: Flotsam; at: number } {
  for (let i = 0; i < 400; i++) {
    const at = T0 + i * FLOTSAM_TIDE_MS;
    const piece = flotsamAt("CREWAA", at).find(pick);
    if (piece) return { piece, at };
  }
  throw new Error("none");
}
const stand = (pos: HexPos) => ({ crewId: "CREWAA", pos });
const besideOn = (f: Flotsam, water: boolean) => MAP.tiles.find((t) => hexDistance(t, f.pos) === 1 && (t.biome === "water") === water)!;
const res = (who: string, kind: string) => (sql.prepare("SELECT qty FROM resources WHERE player_id = ? AND kind = ?").get(who, kind) as { qty: number } | undefined)?.qty ?? 0;
const gold = (who: string) => (sql.prepare("SELECT gold FROM characters WHERE player_id = ?").get(who) as { gold: number }).gold;

describe("taking flotsam", () => {
  it("pays what is in it to the first to take it, and tells the crew it has gone", async () => {
    const { piece, at } = find((f) => f.kind === "driftwood" && f.shallows);
    const wood = flotsamFind("CREWAA", piece).resources.wood!;
    const took = await takeFlotsam(db, "ann", piece.id, stand(piece.pos), at);
    expect(took).toMatchObject({ id: piece.id, name: "Driftwood" });
    expect(res("ann", "wood")).toBe(wood);
    expect(await takeFlotsam(db, "bob", piece.id, stand(piece.pos), at + 10)).toMatch(/first/);
    expect(await takeFlotsam(db, "ann", piece.id, stand(piece.pos), at + 20)).toMatch(/first/);
    expect(res("ann", "wood")).toBe(wood);
    expect(res("bob", "wood")).toBe(0);
    expect((await flotsamTaken(db, "bob", at)).taken).toEqual([piece.id]);
    // Next tide, it is all new.
    expect((await flotsamTaken(db, "bob", at + FLOTSAM_TIDE_MS)).taken).toEqual([]);
  });

  it("pays a bottle's coins and a crate's decor", async () => {
    const bottle = find((f) => f.kind === "bottle" && f.shallows && flotsamFind("CREWAA", f).gold > 0);
    const coins = flotsamFind("CREWAA", bottle.piece).gold;
    const read = await takeFlotsam(db, "ann", bottle.piece.id, stand(bottle.piece.pos), bottle.at);
    expect(typeof read === "object" && read.find.note).toBeTruthy();
    expect(gold("ann")).toBe(10 + coins);

    const crate = find((f) => f.kind === "crate" && f.shallows && !!flotsamFind("CREWAA", f).furnishing);
    await takeFlotsam(db, "bob", crate.piece.id, stand(crate.piece.pos), crate.at);
    const decor = sql.prepare("SELECT def_id FROM furnishings WHERE player_id = 'bob'").all() as { def_id: string }[];
    expect(decor.map((d) => d.def_id)).toEqual([flotsamFind("CREWAA", crate.piece).furnishing]);
  });

  it("is only from on it or beside it, and only while the tide leaves it there", async () => {
    const { piece, at } = find((f) => !f.shallows);
    expect(await takeFlotsam(db, "ann", piece.id, null, at)).toMatch(/Harbor/);
    expect(await takeFlotsam(db, "ann", piece.id, stand({ q: piece.pos.q + 4, r: piece.pos.r }), at)).toMatch(/too far/);
    expect(await takeFlotsam(db, "ann", piece.id, stand(besideOn(piece, true)), at + FLOTSAM_TIDE_MS)).toMatch(/tide/);
    expect(await takeFlotsam(db, "ann", "nonsense", stand(piece.pos), at)).toMatch(/tide/);
    expect((await flotsamTaken(db, "ann", at)).taken).toEqual([]);
    expect(typeof (await takeFlotsam(db, "ann", piece.id, stand(besideOn(piece, true)), at))).toBe("object");
  });
});
