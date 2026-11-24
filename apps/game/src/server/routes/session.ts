// Logging in and out, which Better Auth answers under /api/auth/* (auth.ts),
// and the check every route registered after it sits behind: a session that
// names an account, and so a player.

import { createAuth, playerForRequest } from "../auth";
import type { GameApp } from "./shared";

/** The routes anyone may call without being signed in. Registered before `signedInOnly`. */
export function signInRoutes(app: GameApp): void {
  app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env, c.req.raw).handler(c.req.raw));
}

/** The sign-in check. Every route registered after this one answers only to a signed-in player, who is in `c.get("player")`. */
export function signedInOnly(app: GameApp): void {
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    const player = await playerForRequest(c.env, c.req.raw);
    if (!player) return c.json({ error: "not signed in" }, 401);
    c.set("player", player);
    return next();
  });
}
