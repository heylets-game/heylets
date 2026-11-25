// What the route modules share: the app's types, and the questions more
// than one of them puts to a room. A helper only one module uses lives in
// that module.

import type { Hono } from "hono";
import type { HexPos } from "@gantt-quest/core";
import { crewFor, homeCrewOf, hutHeaders, hutRoomOf, type Env, type Player } from "../db";
import type { Standing } from "../gather";
import { partyOf } from "../party";
import { crewPlaces } from "../zones";

/** What every handler is given: the Worker's bindings, and (past the sign-in check) the player asking. */
export type AppEnv = { Bindings: Env; Variables: { player: Player } };
/** The app each route module registers its routes on (worker.ts makes it and calls them in order). */
export type GameApp = Hono<AppEnv>;

/** True if the player has a socket open in their own hut's room (in the world they are in now) right now: they are standing in it. */
export async function inOwnHut(env: Env, playerId: string): Promise<boolean> {
  try {
    const crew = await homeCrewOf(env.DB, playerId);
    const res = await hutRoomOf(env, playerId, crew).fetch("https://hut/present", { headers: { ...hutHeaders(playerId, crew), "x-player-id": playerId } });
    return (await res.text()) === "yes";
  } catch {
    return false;
  }
}

/** Whoever of a crew is in the Harbor now, and the asker and their party with them: who a map made this moment is sized for. */
export async function harborParty(env: Env, crewId: string, playerId: string) {
  const here = await env.HARBOR_ROOM.get(env.HARBOR_ROOM.idFromName(crewId))
    .fetch("https://harbor/present", { headers: { "x-crew-id": crewId } })
    .then((r) => (r.ok ? (r.json() as Promise<{ ids: string[] }>) : { ids: [] }))
    .then((r) => new Set([...r.ids, playerId]), () => new Set([playerId]));
  // A player's party comes with them, from wherever in the world its members are.
  for (const id of await partyOf(env.DB, playerId)) here.add(id);
  return (await crewPlaces(env.DB, crewId)).filter((m) => here.has(m.id));
}

/**
 * Where the player is standing in their crew's Harbor right now, as its room knows it (the room checked every step
 * of the way there), and whose Harbor it is; null if they are not walking it. One figure walks the town for a whole
 * party (party.ts): a member of it who is not that figure stands where the figure does.
 */
export async function harborStanding(env: Env, playerId: string): Promise<Standing | null> {
  const crew = await crewFor(env.DB, playerId);
  if (!crew) return null;
  const where = async (id: string): Promise<HexPos | null> => {
    try {
      const res = await env.HARBOR_ROOM.get(env.HARBOR_ROOM.idFromName(crew.id)).fetch(`https://harbor/where?id=${encodeURIComponent(id)}`, { headers: { "x-crew-id": crew.id } });
      return ((await res.json()) as { pos: HexPos | null }).pos;
    } catch {
      return null;
    }
  };
  const own = await where(playerId);
  if (own) return { crewId: crew.id, pos: own };
  // Not walking it themselves: the party is only looked up then, and only if they are in it.
  for (const id of await partyOf(env.DB, playerId, true)) {
    const pos = await where(id);
    if (pos) return { crewId: crew.id, pos };
  }
  return null;
}
