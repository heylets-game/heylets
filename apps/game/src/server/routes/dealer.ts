// Hollis Crane, the pub's dealer in materials: his board and what you hold with him, trading at his prices, and
// his supply contracts.

import { buyFromDealer, dealerView, deliverContract, dropContract, sellToDealer, takeContract } from "../dealer";
import type { GameApp } from "./shared";

export function dealerRoutes(app: GameApp): void {
  app.get("/api/dealer", async (c) => c.json(await dealerView(c.env.DB, c.get("player").id)));

  // Sell to him ("sell") or buy from him ("buy"): `qty` of one material, at his price now.
  app.post("/api/dealer/trade", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ side?: unknown; kind?: unknown; qty?: unknown }>().catch(() => ({}) as { side?: unknown; kind?: unknown; qty?: unknown });
    const done = body.side === "sell" ? await sellToDealer(c.env.DB, player.id, body.kind, body.qty)
      : body.side === "buy" ? await buyFromDealer(c.env.DB, player.id, body.kind, body.qty)
      : "Buy or sell.";
    if (typeof done === "string") return c.json({ error: done }, 409);
    return c.json({ ...done, view: await dealerView(c.env.DB, player.id) });
  });

  // A contract: take one of today's ("take", with `offer`), hand in toward the one you hold ("deliver"), or give it up ("drop").
  app.post("/api/dealer/contract", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ action?: unknown; offer?: unknown }>().catch(() => ({}) as { action?: unknown; offer?: unknown });
    const done = body.action === "take" ? await takeContract(c.env.DB, player.id, body.offer)
      : body.action === "deliver" ? await deliverContract(c.env.DB, player.id)
      : body.action === "drop" ? await dropContract(c.env.DB, player.id)
      : "Take, deliver or drop.";
    if (typeof done === "string") return c.json({ error: done }, 409);
    return c.json({ done, view: await dealerView(c.env.DB, player.id) });
  });
}
