// The herb garden by a hut's door: planting and picking your own, watering and feeding a crewmate's, grinding
// bones into bonemeal, and buying seed at the market stall. And the town well: the watering can and water skins
// filled there, and coins tossed in for luck. Every change is told to the crew's Harbor, where the
// garden is drawn as it grows.

import { buyCan, buySeeds, canOf, feedBed, fillCan, gardenView, grindBone, pickGarden, plantBed, waterBed } from "../garden";
import { crewFor, refreshHarbor } from "../db";
import { announceXp } from "../harbor-xp";
import { fillSkin, tossCoin, wellView } from "../well";
import type { GameApp } from "./shared";

type Body = { owner?: unknown; bed?: unknown; with?: unknown; qty?: unknown };

export function gardenRoutes(app: GameApp): void {
  /** The crew of the asker, if `owner` is in it too (or is the asker). */
  const sameCrew = async (db: D1Database, playerId: string, owner: unknown) => {
    const crew = await crewFor(db, playerId);
    if (!crew || typeof owner !== "string") return null;
    if (owner === playerId) return crew;
    const theirs = await crewFor(db, owner);
    return theirs?.id === crew.id ? crew : null;
  };

  // A garden as its panel shows it: yours, or a crewmate's.
  app.get("/api/garden/:owner", async (c) => {
    const player = c.get("player");
    const owner = c.req.param("owner");
    if (!(await sameCrew(c.env.DB, player.id, owner))) return c.json({ error: "That garden is not your crew's." }, 409);
    const view = await gardenView(c.env.DB, player.id, owner);
    return typeof view === "string" ? c.json({ error: view }, 409) : c.json(view);
  });

  app.post("/api/garden/plant", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const error = await plantBed(c.env.DB, player.id, body.bed, body.with);
    if (error) return c.json({ error }, 409);
    c.executionCtx.waitUntil(crewFor(c.env.DB, player.id).then((crew) => refreshHarbor(c.env, crew?.id ?? null)));
    return c.json({ ok: true });
  });

  for (const [path, tend] of [["water", waterBed], ["feed", feedBed]] as const) {
    app.post(`/api/garden/${path}`, async (c) => {
      const player = c.get("player");
      const body = await c.req.json<Body>().catch(() => ({}) as Body);
      const crew = await sameCrew(c.env.DB, player.id, body.owner);
      if (!crew) return c.json({ error: "That garden is not your crew's." }, 409);
      const error = await tend(c.env.DB, player.id, body.owner as string, body.bed);
      if (error) return c.json({ error }, 409);
      c.executionCtx.waitUntil(refreshHarbor(c.env, crew.id));
      return c.json({ ok: true });
    });
  }

  app.post("/api/garden/pick", async (c) => {
    const player = c.get("player");
    const result = await pickGarden(c.env.DB, player.id);
    if (typeof result === "string") return c.json({ error: result }, 409);
    c.executionCtx.waitUntil(crewFor(c.env.DB, player.id).then((crew) => refreshHarbor(c.env, crew?.id ?? null)));
    if (result.xp) c.executionCtx.waitUntil(announceXp(c.env, player.id, result.xp));
    return c.json(result);
  });

  app.post("/api/garden/grind", async (c) => {
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const result = await grindBone(c.env.DB, c.get("player").id, body.qty);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Your watering can: how much is in it (null: you have none).
  app.get("/api/can", async (c) => c.json({ water: await canOf(c.env.DB, c.get("player").id) }));

  // Fill your watering can at the town well.
  app.post("/api/can/fill", async (c) => {
    const result = await fillCan(c.env.DB, c.get("player").id);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // ---------- the town well ----------

  // What the well's card shows: the can, the water skins, the day's coins and the luck held.
  app.get("/api/well", async (c) => c.json(await wellView(c.env.DB, c.get("player").id)));

  // Fill a water skin to carry onto a map.
  app.post("/api/well/skin", async (c) => {
    const result = await fillSkin(c.env.DB, c.get("player").id);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Toss a coin in for luck: a lucky roll for the next map, and now and then a gem or some XP back.
  app.post("/api/well/coin", async (c) => {
    const player = c.get("player");
    const result = await tossCoin(c.env.DB, player.id);
    if (typeof result === "string") return c.json({ error: result }, 409);
    if (result.xp) c.executionCtx.waitUntil(announceXp(c.env, player.id, result.xp));
    return c.json(result);
  });

  app.post("/api/shop/can", async (c) => {
    const error = await buyCan(c.env.DB, c.get("player").id);
    return error ? c.json({ error }, 409) : c.json({ ok: true });
  });

  app.post("/api/shop/seeds", async (c) => {
    const body = await c.req.json<Body>().catch(() => ({}) as Body);
    const result = await buySeeds(c.env.DB, c.get("player").id, body.qty);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });
}
