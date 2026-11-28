// The crew's ship: mending her hull at the yard. (Which ship the crew sails, and how her hull stands, is told with
// the Harbor's board; the bigger ships are paid for as crew projects, routes/projects.ts.)

import { crewFor, mendShip, refreshHarbor } from "../db";
import { projectStock } from "../projects";
import type { GameApp } from "./shared";

export function shipRoutes(app: GameApp): void {
  // Mend the crew's ship with your own wood: as much as she needs, or as far as your wood goes.
  app.post("/api/ship/mend", async (c) => {
    const player = c.get("player");
    const crew = await crewFor(c.env.DB, player.id);
    if (!crew) return c.json({ error: "Join a crew first." }, 409);
    const mended = await mendShip(c.env.DB, crew.id, player.id);
    if ("error" in mended) return c.json({ error: mended.error }, 409);
    c.executionCtx.waitUntil(refreshHarbor(c.env, crew.id));
    return c.json({ ...mended, stock: await projectStock(c.env.DB, player.id) });
  });
}
