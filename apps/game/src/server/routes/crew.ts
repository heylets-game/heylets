// Crews (worlds): founding, joining or going back into one, leaving one,
// the account's worlds for the main menu, and the socket into the Harbor of
// the world a hero is in. A hero can belong to several worlds and is in one
// at a time (db/crews.ts).

import { MAX_CREW } from "@gantt-quest/world";
import { createCrew, crewFor, getCharacter, joinCrew, leaveCrew, refreshHarbor, worldsOfAccount } from "../db";
import type { GameApp } from "./shared";

export function crewRoutes(app: GameApp): void {
  // ---------- crews and the shared Harbor ----------

  app.post("/api/crew", async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 30) return c.json({ error: "Crew name must be 2 to 30 characters." }, 400);
    return c.json({ crew: await createCrew(c.env.DB, c.get("player").id, name) });
  });

  // Join a world by its code, or go back into one the hero already belongs to. Either way it becomes the one they are in.
  app.post("/api/crew/join", async (c) => {
    const body = await c.req.json<{ code?: string }>().catch(() => ({}) as { code?: string });
    const code = String(body.code ?? "").toUpperCase();
    const crew = /^[A-Z]{6}$/.test(code) ? await joinCrew(c.env.DB, c.get("player").id, code, MAX_CREW) : null;
    if (!crew) return c.json({ error: "No world with that code, or it is full." }, 404);
    // A new member shows on that Harbor's roster at once.
    if (crew.joined) c.executionCtx.waitUntil(refreshHarbor(c.env, crew.id));
    return c.json({ crew: { id: crew.id, name: crew.name } });
  });

  // Leave a world for good: the one named, or else the one the hero is in.
  app.post("/api/crew/leave", async (c) => {
    const body = await c.req.json<{ code?: string }>().catch(() => ({}) as { code?: string });
    const code = typeof body.code === "string" && /^[A-Z]{6}$/.test(body.code) ? body.code : undefined;
    const crew = code ?? (await crewFor(c.env.DB, c.get("player").id))?.id;
    await leaveCrew(c.env.DB, c.get("player").id, crew);
    c.executionCtx.waitUntil(refreshHarbor(c.env, crew ?? null));
    return c.json({ ok: true });
  });

  // Every world the account's heroes belong to, for Join world: which heroes are in each.
  app.get("/api/worlds", async (c) => {
    const userId = c.get("player").userId;
    return c.json({ worlds: userId ? await worldsOfAccount(c.env.DB, userId) : [] });
  });

  app.get("/api/crew/ws", async (c) => {
    const player = c.get("player");
    const [crew, character] = await Promise.all([crewFor(c.env.DB, player.id), getCharacter(c.env.DB, player.id)]);
    if (!crew) return c.text("You are not in a crew.", 403);
    if (character?.status !== "active") return c.text("Create a character first.", 409);
    const headers = new Headers(c.req.raw.headers);
    headers.set("x-crew-id", crew.id);
    headers.set("x-player-id", player.id);
    headers.set("x-player-name", encodeURIComponent(character.name));
    headers.set("x-player-class", character.class_id);
    headers.set("x-player-level", String(character.level));
    return c.env.HARBOR_ROOM.get(c.env.HARBOR_ROOM.idFromName(crew.id)).fetch(new Request(c.req.url, { headers }));
  });
}
