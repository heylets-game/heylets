// Fish once caught: the icebox and the trophy chest, selling them, the
// Catch Book, the pub's wall and a fish hung at home. And bait, bought from
// the fishmonger before they are caught.

import { baitCounter, buyBait, buyBoat, buyRod } from "../bait";
import { flotsamTaken, takeFlotsam } from "../flotsam";
import { catchBook, hangAtHome, mountInPub, pubWall, unmountInPub } from "../catchbook";
import { fishStock, moveFish, sellFish } from "../fishmarket";
import { harborStanding, type GameApp } from "./shared";

export function fishRoutes(app: GameApp): void {
  // ---------- fish: the icebox, the trophy chest, and selling them ----------

  app.get("/api/fish", async (c) => c.json(await fishStock(c.env.DB, c.get("player").id)));

  // Sell kept fish to the fishmonger ("market") or Old Tam ("tam"). The server prices every one.
  app.post("/api/fish/sell", async (c) => {
    const body = await c.req.json<{ ids?: unknown; to?: unknown }>().catch(() => ({}) as { ids?: unknown; to?: unknown });
    const result = await sellFish(c.env.DB, c.get("player").id, body.ids, body.to);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Bait, rods and boats from the fishmonger: what you have, and a lot of bait, a rod or a boat bought (the server prices it).
  app.get("/api/fish/bait", async (c) => c.json(await baitCounter(c.env.DB, c.get("player").id)));
  app.post("/api/fish/bait", async (c) => {
    const body = await c.req.json<{ kind?: unknown }>().catch(() => ({}) as { kind?: unknown });
    const result = await buyBait(c.env.DB, c.get("player").id, body.kind);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });
  app.post("/api/fish/rod", async (c) => {
    const body = await c.req.json<{ kind?: unknown }>().catch(() => ({}) as { kind?: unknown });
    const result = await buyRod(c.env.DB, c.get("player").id, body.kind);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });
  app.post("/api/fish/boat", async (c) => {
    const body = await c.req.json<{ kind?: unknown }>().catch(() => ({}) as { kind?: unknown });
    const result = await buyBoat(c.env.DB, c.get("player").id, body.kind);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Flotsam: which of this tide's pieces the crew has taken, and one taken from where the hero really stands. The rest
  // of the crew is told at once, so it goes from their water too.
  app.get("/api/flotsam", async (c) => c.json(await flotsamTaken(c.env.DB, c.get("player").id)));
  app.post("/api/flotsam/take", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}) as { id?: unknown });
    const player = c.get("player");
    const where = await harborStanding(c.env, player.id);
    const result = await takeFlotsam(c.env.DB, player.id, body.id, where);
    if (typeof result === "string") return c.json({ error: result }, 409);
    if (where) {
      const room = c.env.HARBOR_ROOM.get(c.env.HARBOR_ROOM.idFromName(where.crewId));
      c.executionCtx.waitUntil(room.fetch(`https://harbor/flotsam?id=${encodeURIComponent(result.id)}`, { headers: { "x-crew-id": where.crewId } }).then(() => undefined, () => undefined));
    }
    return c.json(result);
  });

  // Move a kept fish between the icebox and the trophy chest.
  app.post("/api/fish/move", async (c) => {
    const body = await c.req.json<{ id?: unknown; to?: unknown }>().catch(() => ({}) as { id?: unknown; to?: unknown });
    const result = await moveFish(c.env.DB, c.get("player").id, body.id, body.to);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // The Catch Book, the crew's records and the pub wall, and hanging fish at home.
  app.get("/api/fish/book", async (c) => c.json(await catchBook(c.env.DB, c.get("player").id)));
  app.get("/api/fish/wall", async (c) => {
    const result = await pubWall(c.env.DB, c.get("player").id);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });
  app.post("/api/fish/wall", async (c) => {
    const body = await c.req.json<{ fishId?: unknown; down?: boolean }>().catch(() => ({}) as { fishId?: unknown; down?: boolean });
    const id = c.get("player").id;
    const result = body.down ? await unmountInPub(c.env.DB, id, body.fishId) : await mountInPub(c.env.DB, id, body.fishId);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });
  app.post("/api/fish/hang", async (c) => {
    const body = await c.req.json<{ furnishingId?: unknown; fishId?: unknown }>().catch(() => ({}) as { furnishingId?: unknown; fishId?: unknown });
    const result = await hangAtHome(c.env, c.get("player").id, body.furnishingId, body.fishId ?? null);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });
}
