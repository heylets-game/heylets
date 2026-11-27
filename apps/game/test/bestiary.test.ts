// The bestiary in D1 (src/server/bestiary.ts): a step's marks added to a book, and one book for all of an account's heroes.

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { bestiaryOf, bestiaryStatements } from "../src/server/bestiary";
import { addHero, openDb } from "./d1";

let sql: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  ({ sql, db } = openDb());
  for (const [id, name] of [["ann", "Ann"], ["ann2", "Annika"], ["bo", "Bo"]]) addHero(sql, { id, name });
  // Ann and Annika are two heroes of one account; Bo has none (a hero made without one).
  sql.prepare("UPDATE players SET user_id = 'acct-a' WHERE id IN ('ann', 'ann2')").run();
  sql.prepare("UPDATE players SET user_id = NULL WHERE id = 'bo'").run();
});

describe("the bestiary's records", () => {
  it("adds up what is faced and killed, and keeps the highest level and the first meeting", async () => {
    await db.batch(bestiaryStatements(db, [{ hero: "ann", kind: "wolf", level: 3, faced: 2, kills: 0 }], 1000));
    await db.batch(bestiaryStatements(db, [{ hero: "ann", kind: "wolf", level: 2, faced: 0, kills: 2 }, { hero: "ann", kind: "bandit", level: 1, faced: 1, kills: 1 }], 2000));
    expect((await bestiaryOf(db, "ann")).records).toEqual([
      { kind: "wolf", faced: 2, kills: 2, topLevel: 3, firstAt: 1000 },
      { kind: "bandit", faced: 1, kills: 1, topLevel: 1, firstAt: 2000 },
    ]);
  });

  it("is one book for every hero of an account, and nobody else's", async () => {
    await db.batch(bestiaryStatements(db, [{ hero: "ann", kind: "wolf", level: 1, faced: 1, kills: 1 }, { hero: "ann2", kind: "wolf", level: 5, faced: 1, kills: 0 }, { hero: "bo", kind: "bear", level: 1, faced: 1, kills: 0 }], 1000));
    const mine = [{ kind: "wolf", faced: 2, kills: 1, topLevel: 5, firstAt: 1000 }];
    expect((await bestiaryOf(db, "ann")).records).toEqual(mine);
    expect((await bestiaryOf(db, "ann2")).records).toEqual(mine);
    expect((await bestiaryOf(db, "bo")).records).toEqual([{ kind: "bear", faced: 1, kills: 0, topLevel: 1, firstAt: 1000 }]);
  });

  it("writes nothing for a hero it does not know, and leaves out a kind the game no longer has", async () => {
    await db.batch(bestiaryStatements(db, [{ hero: "nobody", kind: "wolf", level: 1, faced: 1, kills: 0 }, { hero: "bo", kind: "gone_kind", level: 1, faced: 1, kills: 0 }]));
    expect(sql.prepare("SELECT COUNT(*) AS n FROM bestiary").get()).toEqual({ n: 1 });
    expect((await bestiaryOf(db, "bo")).records).toEqual([]);
  });
});
