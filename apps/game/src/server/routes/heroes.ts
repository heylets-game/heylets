// An account's heroes: listing them for the main menu, choosing which one
// this device plays, and starting a new one. Each hero is a players row
// under the account (players.user_id); which one a device plays is in its
// hero cookie (auth.ts, heroCookieName), so every other route goes on reading
// `c.get("player")` as before.

import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { MAX_HEROES, heroCookieName } from "../auth";
import { currentCrewSql, now } from "../db/rows";
import { addToParty, dropFromParty } from "../party";
import type { AppEnv, GameApp } from "./shared";

/** A hero as the menu lists it. */
export interface HeroSlot {
  id: string;
  name: string;
  classId: string;
  level: number;
  /** JSON Appearance, or null. */
  appearance: string | null;
  /** The world (crew) they are in now, if any. */
  crew: { id: string; name: string } | null;
  /** In the account's party (party.ts): they come onto a map with the hero being played. */
  party: boolean;
}

function setHero(c: Context<AppEnv>, id: string) {
  setCookie(c, heroCookieName(c.req.raw), id, { httpOnly: true, sameSite: "Lax", secure: new URL(c.req.url).protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export function heroRoutes(app: GameApp): void {
  // The account's finished heroes, most recently played first. A slot with no hero yet (or one still being made) is
  // not listed: it is only ever the one being played, and the menu shows it as that.
  app.get("/api/heroes", async (c) => {
    const player = c.get("player");
    if (!player.userId) return c.json({ heroes: [], max: MAX_HEROES });
    const rows = await c.env.DB.prepare(
      `SELECT p.id, p.party, ch.name, ch.class_id AS classId, ch.level, ch.appearance, cr.id AS crewId, cr.name AS crewName
         FROM players p
         JOIN characters ch ON ch.player_id = p.id AND ch.status = 'active'
         LEFT JOIN crews cr ON cr.id = ${currentCrewSql("p.id")}
        WHERE p.user_id = ?
        ORDER BY p.last_played_at DESC, p.created_at, p.id`,
    )
      .bind(player.userId)
      .all<{ id: string; party: number; name: string; classId: string; level: number; appearance: string | null; crewId: string | null; crewName: string | null }>();
    const heroes: HeroSlot[] = rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      classId: r.classId,
      level: r.level,
      appearance: r.appearance,
      crew: r.crewId ? { id: r.crewId, name: r.crewName ?? "" } : null,
      party: r.party === 1,
    }));
    return c.json({ heroes, max: MAX_HEROES });
  });

  // Play another of the account's heroes on this device.
  app.post("/api/heroes/choose", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ id?: string }>().catch(() => ({}) as { id?: string });
    const id = String(body.id ?? "");
    const mine = player.userId ? await c.env.DB.prepare("SELECT 1 FROM players WHERE id = ? AND user_id = ?").bind(id, player.userId).first() : null;
    if (!mine) return c.json({ error: "That is not one of your heroes." }, 404);
    await c.env.DB.prepare("UPDATE players SET last_played_at = ? WHERE id = ?").bind(now(), id).run();
    setHero(c, id);
    return c.json({ ok: true });
  });

  // An empty slot to make a new hero in, chosen for this device. A slot left empty earlier (or a hero never finished)
  // is used again rather than making another.
  app.post("/api/heroes/new", async (c) => {
    const player = c.get("player");
    if (!player.userId) return c.json({ error: "Not signed in." }, 401);
    const db = c.env.DB;
    let slot = await db
      .prepare(
        `SELECT p.id FROM players p LEFT JOIN characters ch ON ch.player_id = p.id
          WHERE p.user_id = ? AND (ch.player_id IS NULL OR ch.status != 'active')
          ORDER BY p.created_at, p.id LIMIT 1`,
      )
      .bind(player.userId)
      .first<{ id: string }>();
    if (!slot) {
      const count = await db.prepare("SELECT COUNT(*) AS n FROM players WHERE user_id = ?").bind(player.userId).first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_HEROES) return c.json({ error: `You have ${MAX_HEROES} heroes, the most an account can have.` }, 409);
      slot = { id: crypto.randomUUID() };
      await db.prepare("INSERT INTO players (id, name, created_at, last_played_at, user_id) VALUES (?1, ?2, ?3, ?3, ?4)").bind(slot.id, player.email ? "Sailor" : "Guest", now(), player.userId).run();
    } else {
      await db.prepare("UPDATE players SET last_played_at = ? WHERE id = ?").bind(now(), slot.id).run();
    }
    setHero(c, slot.id);
    return c.json({ id: slot.id });
  });

  // The party: another of the account's heroes to play beside the one being played (brought into this world if they
  // are not in it), or one taken out of it.
  app.post("/api/party/add", async (c) => {
    const player = c.get("player");
    if (!player.userId) return c.json({ error: "Not signed in." }, 401);
    const body = await c.req.json<{ id?: string }>().catch(() => ({}) as { id?: string });
    const error = await addToParty(c.env, player.userId, player.id, String(body.id ?? ""));
    return error ? c.json({ error }, 409) : c.json({ ok: true });
  });
  app.post("/api/party/remove", async (c) => {
    const player = c.get("player");
    if (!player.userId) return c.json({ error: "Not signed in." }, 401);
    const body = await c.req.json<{ id?: string }>().catch(() => ({}) as { id?: string });
    const error = await dropFromParty(c.env.DB, player.userId, String(body.id ?? ""));
    return error ? c.json({ error }, 404) : c.json({ ok: true });
  });
}
