// Logins through Better Auth (src/server/auth.ts): a new visitor becomes a
// guest, a guest makes an account and keeps their character, an account logs
// back in, a forgotten password is set again with an emailed code, and a
// player from before the move keeps their character through their old cookie.

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/server/db";
import { signInRoutes, signedInOnly } from "../src/server/routes/session";
import type { AppEnv } from "../src/server/routes/shared";
import { openDb, Stmt } from "./d1";

const ORIGIN = "http://localhost:5180";

function appFor(db: D1Database) {
  const app = new Hono<AppEnv>();
  signInRoutes(app);
  signedInOnly(app);
  app.get("/api/whoami", (c) => c.json(c.get("player")));
  const env = { DB: db } as Env;

  // One browser: keeps the cookies it is given and sends them back.
  const jar = new Map<string, string>();
  const call = async (path: string, body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await app.request(
      `${ORIGIN}${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) jar.delete(name);
      else jar.set(name, value);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  };
  const whoami = async () => (await call("/api/whoami")).data as { id: string; name: string; email: string | null };
  /** What the client does on a first visit: carry over an old session, or else sign in as a new guest. */
  const visit = async () => {
    if ((await call("/api/auth/resume", {})).status !== 200) expect((await call("/api/auth/sign-in/anonymous", {})).status).toBe(200);
    return whoami();
  };
  return { call, whoami, visit, jar };
}

afterEach(() => vi.restoreAllMocks());

describe("logins", () => {
  it("makes a new visitor a guest, with a player of their own", async () => {
    const { db } = openDb();
    const browser = appFor(db);
    expect((await browser.call("/api/whoami")).status).toBe(401);
    const guest = await browser.visit();
    expect(guest.email).toBeNull();
    expect((await browser.whoami()).id).toBe(guest.id);
  });

  it("keeps a guest's player when they make an account, and logs back in to it", async () => {
    const { db, sql } = openDb();
    const browser = appFor(db);
    const guest = await browser.visit();

    expect((await browser.call("/api/auth/sign-up/email", { email: "Sailor@Example.com", password: "a long password", name: "sailor" })).status).toBe(200);
    const saved = await browser.whoami();
    expect(saved).toMatchObject({ id: guest.id, email: "sailor@example.com" });
    // The guest's account is gone; the player now belongs to the new one.
    expect(sql.prepare("SELECT COUNT(*) AS n FROM auth_user").get()).toEqual({ n: 1 });

    await browser.call("/api/auth/sign-out", {});
    expect((await browser.call("/api/whoami")).status).toBe(401);

    const other = appFor(db);
    expect((await other.call("/api/auth/sign-in/email", { email: "sailor@example.com", password: "wrong password" })).status).toBe(401);
    expect((await other.call("/api/auth/sign-in/email", { email: "sailor@example.com", password: "a long password" })).status).toBe(200);
    expect((await other.whoami()).id).toBe(guest.id);
  });

  it("leaves a guest's player behind when they log in to an account that has one", async () => {
    const { db } = openDb();
    const owner = appFor(db);
    await owner.call("/api/auth/sign-up/email", { email: "owner@example.com", password: "a long password", name: "owner" });
    const ownerPlayer = await owner.whoami();

    const browser = appFor(db);
    await browser.visit();
    expect((await browser.call("/api/auth/sign-in/email", { email: "owner@example.com", password: "a long password" })).status).toBe(200);
    expect((await browser.whoami()).id).toBe(ownerPlayer.id);
  });

  it("sets a new password with an emailed code", async () => {
    const { db } = openDb();
    const first = appFor(db);
    await first.call("/api/auth/sign-up/email", { email: "forgetful@example.com", password: "first password", name: "forgetful" });
    const player = await first.whoami();

    // Without a mail binding the code goes to the log.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const browser = appFor(db);
    expect((await browser.call("/api/auth/email-otp/send-verification-otp", { email: "forgetful@example.com", type: "forget-password" })).status).toBe(200);
    const code = /code is (\d{6})/.exec(log.mock.calls.map((c) => String(c[0])).join("\n"))?.[1];
    expect(code).toMatch(/^\d{6}$/);

    expect((await browser.call("/api/auth/email-otp/reset-password", { email: "forgetful@example.com", otp: code === "000000" ? "111111" : "000000", password: "second password" })).status).toBe(400);
    expect((await browser.call("/api/auth/email-otp/reset-password", { email: "forgetful@example.com", otp: code, password: "second password" })).status).toBe(200);
    expect((await browser.call("/api/auth/sign-in/email", { email: "forgetful@example.com", password: "second password" })).status).toBe(200);
    expect((await browser.whoami()).id).toBe(player.id);
  });
});

describe("players from before Better Auth", () => {
  /** A database at the migration before Better Auth, with an old player and session in it, then the rest applied. */
  function oldDatabase(setUp: (sql: DatabaseSync) => void) {
    const dir = new URL("../migrations/", import.meta.url);
    const files = readdirSync(dir).sort();
    const sql = new DatabaseSync(":memory:");
    const at = files.indexOf("0060_better_auth.sql");
    for (const file of files.slice(0, at)) sql.exec(readFileSync(new URL(file, dir), "utf8"));
    setUp(sql);
    for (const file of files.slice(at)) sql.exec(readFileSync(new URL(file, dir), "utf8"));
    const db = {
      prepare: (text: string) => new Stmt(sql, text),
      async exec(text: string) {
        sql.exec(text);
        return { count: 0, duration: 0 };
      },
      async batch(stmts: Stmt[]) {
        return stmts.map((s) => s.exec());
      },
    } as unknown as D1Database;
    return { sql, db };
  }

  it("keeps a guest's character through their old session cookie, once", async () => {
    const { db, sql } = oldDatabase((sql) => {
      sql.prepare("INSERT INTO players (id, name, created_at) VALUES ('old-guest', 'Guest', 1700000000000)").run();
      sql.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES ('old-token', 'old-guest', 1700000000000)").run();
    });
    expect(sql.prepare("SELECT isAnonymous, emailVerified FROM auth_user WHERE id = 'old-guest'").get()).toEqual({ isAnonymous: 1, emailVerified: 0 });

    const browser = appFor(db);
    browser.jar.set("gq_session", "old-token");
    expect((await browser.call("/api/auth/resume", {})).status).toBe(200);
    expect(await browser.whoami()).toMatchObject({ id: "old-guest", email: null });
    expect(browser.jar.has("gq_session")).toBe(false);

    // The old token is spent: it carries nobody over a second time.
    const thief = appFor(db);
    thief.jar.set("gq_session", "old-token");
    expect((await thief.call("/api/auth/resume", {})).status).toBe(404);
  });

  it("lets a player who signed in by email set a password and keep their character", async () => {
    const { db } = oldDatabase((sql) => {
      sql.prepare("INSERT INTO players (id, name, email, created_at) VALUES ('old-sailor', 'Sailor', 'old@example.com', 1700000000000)").run();
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const browser = appFor(db);
    await browser.call("/api/auth/email-otp/send-verification-otp", { email: "old@example.com", type: "forget-password" });
    const code = /code is (\d{6})/.exec(log.mock.calls.map((c) => String(c[0])).join("\n"))?.[1];
    expect((await browser.call("/api/auth/email-otp/reset-password", { email: "old@example.com", otp: code, password: "a new password" })).status).toBe(200);
    expect((await browser.call("/api/auth/sign-in/email", { email: "old@example.com", password: "a new password" })).status).toBe(200);
    expect(await browser.whoami()).toMatchObject({ id: "old-sailor", email: "old@example.com" });
  });
});
