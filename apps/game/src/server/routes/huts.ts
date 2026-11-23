// Huts: what a player owns for theirs, crafting for it and making it
// bigger, what its containers hold, the socket into its room, and the plot it
// stands on with the bin that raises the shack.

import { HARBOR_PLOTS } from "@gantt-quest/world";
import { buyPlot, craftFurnishing, crewFor, fillBin, getCharacter, getHut, refreshHarbor, refreshHut, stashMaterial, stowGear, unstowGear, upgradeHut } from "../db";
import { announceXp } from "../harbor-xp";
import { buyFinish, finishesView, setFinish } from "../finishes";
import { enterHut } from "../hut-room";
import { inOwnHut, type GameApp } from "./shared";

export function hutRoutes(app: GameApp): void {
  // ---------- huts ----------

  // Everything the player owns for their hut, and the gold they could spend on it.
  app.get("/api/hut", async (c) => {
    const player = c.get("player");
    const [hut, character] = await Promise.all([getHut(c.env.DB, player.id), getCharacter(c.env.DB, player.id)]);
    return c.json({ ...hut, gold: character?.gold ?? 0 });
  });

  // Build a furnishing from materials. It lands in storage.
  app.post("/api/hut/craft", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ defId?: string }>().catch(() => ({}) as { defId?: string });
    const result = await craftFurnishing(c.env.DB, player.id, String(body.defId));
    if (typeof result === "string") return c.json({ error: result }, 409);
    // Written to D1 above; now the room they are standing in is told.
    await refreshHut(c.env, player.id);
    if (result.xp) c.executionCtx.waitUntil(announceXp(c.env, player.id, result.xp));
    return c.json({ ok: true, xp: result.xp });
  });

  // Make the hut one tier bigger, for the gold and materials in HUT_TIERS.
  app.post("/api/hut/upgrade", async (c) => {
    const player = c.get("player");
    const result = await upgradeHut(c.env.DB, player.id);
    if (typeof result === "string") return c.json({ error: result }, 409);
    await refreshHut(c.env, player.id);
    // The building in the Harbor grows too.
    c.executionCtx.waitUntil(crewFor(c.env.DB, player.id).then((crew) => refreshHarbor(c.env, crew?.id ?? null)));
    return c.json(result);
  });

  // Materials in or out of one of your hut's containers: `qty` > 0 puts that many in, < 0 takes them out.
  app.post("/api/hut/stash", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ container?: number; kind?: string; qty?: number }>().catch(() => ({}) as { container?: number; kind?: string; qty?: number });
    const error = await stashMaterial(c.env.DB, player.id, Number(body.container), body.kind, body.qty);
    return error ? c.json({ error }, 409) : c.json({ ok: true });
  });

  // A piece of gear from the bag into a container, or (with no container) back out into the bag.
  app.post("/api/hut/stow", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ container?: number | null; itemId?: number }>().catch(() => ({}) as { container?: number | null; itemId?: number });
    const itemId = Number(body.itemId);
    // Putting gear away works from anywhere; taking it out only while standing in your own hut.
    if (body.container == null && !(await inOwnHut(c.env, player.id))) return c.json({ error: "What you keep at home can only be taken out at home. Walk into your hut first." }, 409);
    const error = body.container == null ? await unstowGear(c.env.DB, player.id, itemId) : await stowGear(c.env.DB, player.id, Number(body.container), itemId);
    if (error) return c.json({ error }, 409);
    c.executionCtx.waitUntil(refreshHut(c.env, player.id));
    return c.json({ ok: true });
  });

  // ---------- home finishes: Nell's wallpaper, floors and roofs ----------

  // Her catalogue as you see it: what you own, what your hut wears, your gold.
  app.get("/api/finishes", async (c) => c.json(await finishesView(c.env.DB, c.get("player").id)));

  // Buy a finish from Nell, for good.
  app.post("/api/finishes/buy", async (c) => {
    const body = await c.req.json<{ id?: unknown }>().catch(() => ({}) as { id?: unknown });
    const result = await buyFinish(c.env.DB, c.get("player").id, body.id);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Dress your hut's walls, floor or roof in a finish you own (`id` null: back to plain). Everyone inside sees it at
  // once, and a new roof is seen from the Harbor.
  app.post("/api/hut/finish", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ kind?: unknown; id?: unknown }>().catch(() => ({}) as { kind?: unknown; id?: unknown });
    const result = await setFinish(c.env.DB, player.id, body.kind, body.id ?? null);
    if (typeof result === "string") return c.json({ error: result }, 409);
    await refreshHut(c.env, player.id);
    if (body.kind === "roof") c.executionCtx.waitUntil(crewFor(c.env.DB, player.id).then((crew) => refreshHarbor(c.env, crew?.id ?? null)));
    return c.json({ finish: result });
  });

  // Walk into a hut's room: your own, or a crewmate's.
  app.get("/api/hut/:owner/ws", (c) => enterHut(c.env, c.get("player"), c.req.param("owner"), c.req.raw));

  // Buy a plot of land in the crew's Harbor: the ground a hut stands on.
  app.post("/api/hut/plot", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ plot?: unknown }>().catch(() => ({}) as { plot?: unknown });
    const crew = await crewFor(c.env.DB, player.id);
    if (!crew) return c.json({ error: "Join a crew first." }, 409);
    const error = await buyPlot(c.env.DB, crew.id, player.id, Number(body.plot), HARBOR_PLOTS.length);
    if (error) return c.json({ error }, 409);
    c.executionCtx.waitUntil(refreshHarbor(c.env, crew.id));
    return c.json({ plot: Number(body.plot) });
  });

  // Put materials into the resource bin on your plot. When it is full the shack goes up (`bin` comes back null).
  app.post("/api/hut/bin", async (c) => {
    const player = c.get("player");
    const crew = await crewFor(c.env.DB, player.id);
    if (!crew) return c.json({ error: "Join a crew first." }, 409);
    const result = await fillBin(c.env.DB, player.id);
    if (typeof result === "string") return c.json({ error: result }, 409);
    c.executionCtx.waitUntil(refreshHarbor(c.env, crew.id));
    return c.json(result);
  });
}
