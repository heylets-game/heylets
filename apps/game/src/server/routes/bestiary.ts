// The bestiary: the log book's page of every enemy the player has met.

import { bestiaryOf } from "../bestiary";
import type { GameApp } from "./shared";

export function bestiaryRoutes(app: GameApp): void {
  // The asker's book: what they have faced and killed of each kind. What each kind is, the client has (bestiaryEntry).
  app.get("/api/bestiary", async (c) => c.json(await bestiaryOf(c.env.DB, c.get("player").id)));
}
