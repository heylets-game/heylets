// The pub: the socket into its room, the menu, the leaderboard, the
// traveling salesman, the regulars and their errands, and a word with the
// barkeep.

import { TALK_PER_DAY } from "@gantt-quest/world";
import { orderAtPub, refreshHut } from "../db";
import { dropErrand, handInErrand, regularsView, takeErrand, tradeWithRegular } from "../errands";
import { announceXp } from "../harbor-xp";
import { enterPub } from "../pub-room";
import { pubLeaderboard } from "../pub-scores";
import { buyFromSalesman, getSalesman } from "../salesman";
import { talkLeft } from "../talk";
import type { GameApp } from "./shared";
import { askTownsperson } from "./talk";

export function pubRoutes(app: GameApp): void {
  // ---------- the pub ----------

  app.get("/api/pub/ws", (c) => enterPub(c.env, c.get("player"), c.req.raw));

  // The crew's leaderboard for the pub's game tables, on the board on the back wall.
  app.get("/api/pub/leaderboard", async (c) => {
    const result = await pubLeaderboard(c.env.DB, c.get("player").id);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Eat a meal off the menu, one a day. The price is the menu's. `outings` is how many gathering outings it gave
  // back; `rested`, whether any did, is for a page still open from before meals did more than that.
  app.post("/api/pub/order", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ itemId?: unknown }>().catch(() => ({}) as { itemId?: unknown });
    const result = await orderAtPub(c.env.DB, player.id, String(body.itemId ?? ""));
    if (typeof result === "string") return c.json({ error: result }, 409);
    return c.json({ outings: result.outings, rested: result.outings > 0 });
  });

  // The traveling salesman in the pub, if one is in, and their stock as this player sees it; otherwise when the next is due.
  // `x-gq-salesman` forces a visitor in the dev server only (see server/salesman.ts).
  app.get("/api/pub/salesman", async (c) => {
    const result = await getSalesman(c.env.DB, c.get("player").id, c.req.header("x-gq-salesman"));
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Buy one entry of the salesman's stock. Only the index is named; the stock and its prices are derived here.
  app.post("/api/pub/salesman/buy", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ index?: unknown }>().catch(() => ({}) as { index?: unknown });
    const result = await buyFromSalesman(c.env.DB, player.id, body.index, c.req.header("x-gq-salesman"));
    if (typeof result === "string") return c.json({ error: result }, 409);
    // A blueprint or a furnishing shows up in their hut, if they have it open in another tab.
    if (result.got.goods.kind === "blueprint" || result.got.goods.kind === "furnishing") c.executionCtx.waitUntil(refreshHut(c.env, player.id));
    return c.json(result);
  });

  // The pub's regulars: who is in today, the job each has going, and where this player stands with each.
  app.get("/api/pub/regulars", async (c) => {
    const result = await regularsView(c.env.DB, c.get("player").id);
    return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
  });

  // Take on, hand in, trade or give up a regular's job. Only the regular is named; the terms are derived here.
  app.post("/api/pub/errand", async (c) => {
    const player = c.get("player");
    const body = await c.req.json<{ regular?: unknown; action?: unknown }>().catch(() => ({}) as { regular?: unknown; action?: unknown });
    const db = c.env.DB;
    if (body.action === "accept") {
      const result = await takeErrand(db, player.id, body.regular);
      return typeof result === "string" ? c.json({ error: result }, 409) : c.json(result);
    }
    if (body.action === "drop") {
      const error = await dropErrand(db, player.id, body.regular);
      return error ? c.json({ error }, 409) : c.json({ ok: true });
    }
    if (body.action === "handin" || body.action === "trade") {
      const result = body.action === "handin" ? await handInErrand(db, player.id, body.regular) : await tradeWithRegular(db, player.id, body.regular);
      if (typeof result === "string") return c.json({ error: result }, 409);
      if (result.xp) c.executionCtx.waitUntil(announceXp(c.env, player.id, result.xp));
      return c.json(result);
    }
    return c.json({ error: "Accept, hand in, trade or drop." }, 400);
  });

  // A word with the barkeep, for a page still open from before anyone else could be asked (now /api/talk, for anyone).
  app.get("/api/pub/talk", async (c) => c.json({ left: await talkLeft(c.env.DB, c.get("player").id), cap: TALK_PER_DAY }));
  app.post("/api/pub/talk", async (c) => {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
    return askTownsperson(c, "barkeep", body.text);
  });
}
