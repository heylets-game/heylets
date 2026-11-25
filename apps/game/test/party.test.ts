// A party (src/server/party.ts): several of one account's heroes played
// together. A tab names the party member it is acting as (x-gq-hero), and is
// only taken at its word for a hero of its own account; a hero added to the
// party is brought into the world of the hero being played; and partyOf says
// who walks onto a map with them.

import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/server/db";
import { partyOf } from "../src/server/party";
import { heroRoutes } from "../src/server/routes/heroes";
import { harborStanding } from "../src/server/routes/shared";
import { signInRoutes, signedInOnly } from "../src/server/routes/session";
import type { AppEnv } from "../src/server/routes/shared";
import { addCrew, openDb } from "./d1";

const ORIGIN = "http://localhost:5180";

function appFor(db: D1Database) {
  const app = new Hono<AppEnv>();
  signInRoutes(app);
  signedInOnly(app);
  app.get("/api/whoami", (c) => c.json(c.get("player")));
  heroRoutes(app);
  // No Harbor to tell of a new member: refreshHarbor never throws.
  const env = { DB: db } as Env;
  const jar = new Map<string, string>();
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await app.request(
      `${ORIGIN}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1).trim();
      if (!value || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) jar.delete(pair.slice(0, eq).trim());
      else jar.set(pair.slice(0, eq).trim(), value);
    }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const whoami = async (headers: Record<string, string> = {}) => (await call("/api/whoami", undefined, headers)).data as { id: string };
  return { call, whoami };
}

function giveHero(sql: DatabaseSync, playerId: string, name: string) {
  sql.prepare("INSERT INTO characters (player_id, name, class_id, status, level, str, int_stat, vit, agi, dex, gold, created_at) VALUES (?, ?, 'qa_paladin', 'active', 1, 5, 5, 5, 5, 5, 0, 0)").run(playerId, name);
}

function inWorld(sql: DatabaseSync, playerId: string, crew: string) {
  addCrew(sql, crew, playerId);
  sql.prepare("INSERT OR IGNORE INTO crew_members (crew_id, player_id, joined_at) VALUES (?, ?, ?)").run(crew, playerId, Date.now());
  sql.prepare("UPDATE players SET current_crew_id = ? WHERE id = ?").run(crew, playerId);
}

const currentWorld = (sql: DatabaseSync, id: string) => (sql.prepare("SELECT current_crew_id AS c FROM players WHERE id = ?").get(id) as { c: string | null }).c;

/** An account with three heroes: the first in world WORLDA, the second in WORLDB, the third in none. */
async function threeHeroes(email: string) {
  const { db, sql } = openDb();
  const app = appFor(db);
  await app.call("/api/auth/sign-up/email", { email, password: "a long password", name: "party" });
  const first = (await app.whoami()).id;
  giveHero(sql, first, "First");
  inWorld(sql, first, "WORLDA");
  const second = (await app.call("/api/heroes/new", {})).data.id as string;
  giveHero(sql, second, "Second");
  inWorld(sql, second, "WORLDB");
  const third = (await app.call("/api/heroes/new", {})).data.id as string;
  giveHero(sql, third, "Third");
  expect((await app.call("/api/heroes/choose", { id: first })).status).toBe(200);
  return { db, sql, app, first, second, third };
}

describe("a party of an account's heroes", () => {
  it("acts as the party member a tab names, and only one of the account's own", async () => {
    const { db, app, first, second } = await threeHeroes("acting@example.com");
    expect((await app.whoami()).id).toBe(first);
    expect((await app.whoami({ "x-gq-hero": second })).id).toBe(second);
    // A socket cannot send headers: it names the hero in its address.
    expect((await app.call(`/api/whoami?hero=${second}`)).data.id).toBe(second);

    // Another account's hero is never taken: it is the tab's own hero that asks.
    const other = appFor(db);
    await other.call("/api/auth/sign-up/email", { email: "someone@example.com", password: "a long password", name: "someone" });
    expect((await other.whoami({ "x-gq-hero": second })).id).not.toBe(second);
  });

  it("adds a hero to the party, bringing them into this world, and takes them out again", async () => {
    const { db, sql, app, first, second, third } = await threeHeroes("adding@example.com");
    expect(await partyOf(db, first)).toEqual([]);

    expect((await app.call("/api/party/add", { id: second })).status).toBe(200);
    expect((await app.call("/api/party/add", { id: third })).status).toBe(200);
    // Both come into the world of the hero being played. Second keeps their place in the world they were in.
    expect(currentWorld(sql, second)).toBe("WORLDA");
    expect(currentWorld(sql, third)).toBe("WORLDA");
    expect(sql.prepare("SELECT 1 FROM crew_members WHERE crew_id = 'WORLDB' AND player_id = ?").get(second)).toBeTruthy();
    expect((await partyOf(db, first)).sort()).toEqual([second, third].sort());

    const listed = (await app.call("/api/heroes")).data as { heroes: { id: string; party: boolean }[] };
    expect(listed.heroes.filter((h) => h.party).map((h) => h.id).sort()).toEqual([first, second, third].sort());

    expect((await app.call("/api/party/remove", { id: third })).status).toBe(200);
    expect(await partyOf(db, first)).toEqual([second]);
    // Played as Second, the party is the rest of it.
    expect(await partyOf(db, second)).toEqual([first]);
  });

  it("leaves out a member who has gone into another world", async () => {
    const { db, sql, app, first, second } = await threeHeroes("elsewhere@example.com");
    await app.call("/api/party/add", { id: second });
    sql.prepare("UPDATE players SET current_crew_id = 'WORLDB' WHERE id = ?").run(second);
    expect(await partyOf(db, first)).toEqual([]);
  });

  it("refuses the hero being played, and someone else's hero", async () => {
    const { db, app, first } = await threeHeroes("refuse@example.com");
    expect((await app.call("/api/party/add", { id: first })).status).toBe(409);
    const other = appFor(db);
    await other.call("/api/auth/sign-up/email", { email: "theirs@example.com", password: "a long password", name: "theirs" });
    const theirs = (await other.whoami()).id;
    expect((await app.call("/api/party/add", { id: theirs })).status).toBe(409);
    expect((await app.call("/api/party/remove", { id: theirs })).status).toBe(404);
  });

  it("stands a party member where the one walking the town stands", async () => {
    const { db, app, first, second, third } = await threeHeroes("standing@example.com");
    await app.call("/api/party/add", { id: second });
    // Only First walks the Harbor.
    const harbors = {
      idFromName: (crew: string) => crew,
      get: () => ({ fetch: async (url: string) => Response.json({ pos: new URL(url).searchParams.get("id") === first ? { q: 3, r: 4 } : null }) }),
    };
    const env = { DB: db, HARBOR_ROOM: harbors } as unknown as Env;
    expect(await harborStanding(env, first)).toEqual({ crewId: "WORLDA", pos: { q: 3, r: 4 } });
    expect(await harborStanding(env, second)).toEqual({ crewId: "WORLDA", pos: { q: 3, r: 4 } });
    // Not one of the party: nowhere, even in the same world.
    await app.call("/api/party/add", { id: third });
    await app.call("/api/party/remove", { id: third });
    expect(await harborStanding(env, third)).toBeNull();
  });
});
