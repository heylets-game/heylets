// The townsfolk: a question for one of them (Old Tam, Hollis, a regular, a salesman, a keeper, Bram or Nell), and
// what they have heard about the crew, for their talk among themselves. They only talk: nothing they say changes
// anything. Every question is a call to the model, so it is counted first (server/talk.ts), and one past the day's
// limit is never sent.

import type { Context } from "hono";
import { PUB_MAX_TALK, TALK_PER_DAY, isTownsperson, type Townsperson } from "@gantt-quest/world";
import { townsfolkReply } from "../ai";
import { crewFor, getCharacter } from "../db";
import { crewGossip } from "../gossip";
import { spendTalk, talkLeft } from "../talk";
import { TOWNSFOLK_MINDS, factsFor } from "../townsfolk";
import type { AppEnv, GameApp } from "./shared";

/** Ask `who` the question in the request's body, `text`: their answer and how many questions are left today. */
export async function askTownsperson(c: Context<AppEnv>, who: Townsperson, raw: unknown) {
  const player = c.get("player");
  const text = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, PUB_MAX_TALK);
  if (!text) return c.json({ error: "Say something first." }, 400);
  const [character, crew] = await Promise.all([getCharacter(c.env.DB, player.id), crewFor(c.env.DB, player.id)]);
  if (character?.status !== "active" || !crew) return c.json({ error: "The townsfolk talk to crews." }, 409);
  // Counted before the model is asked, so a question past the day's limit is never sent.
  const left = await spendTalk(c.env.DB, player.id);
  if (left === null) return c.json({ error: `That is all the talk for today: ${TALK_PER_DAY} questions a day.`, left: 0 }, 429);
  const scene = { crewId: crew.id, now: Date.now() };
  const mind = TOWNSFOLK_MINDS[who];
  // In the pub everyone sees the exchange over the two heads; the conversation itself stays on the asker's screen.
  const unit = mind.inPub(scene);
  const room = unit ? c.env.PUB_ROOM.get(c.env.PUB_ROOM.idFromName(crew.id)) : null;
  const bubble = (id: string, line: string) => room?.fetch("https://pub/bubble", { method: "POST", body: JSON.stringify({ id, text: line }) }).then(() => {}, () => {});
  if (room) c.executionCtx.waitUntil(bubble(player.id, text)!);
  const say = await townsfolkReply(c.env, mind, { hero: character.name, crew: crew.name, text, facts: factsFor(who, scene) });
  if (room && unit) c.executionCtx.waitUntil(bubble(unit, say)!);
  return c.json({ say, left });
}

export function talkRoutes(app: GameApp): void {
  // What the townsfolk have heard about the player's crew, to talk about among themselves.
  app.get("/api/gossip", async (c) => {
    const crew = await crewFor(c.env.DB, c.get("player").id);
    return c.json({ gossip: crew ? await crewGossip(c.env.DB, crew.id) : [] });
  });

  // How many questions the player may still ask today, of all of them together.
  app.get("/api/talk", async (c) => c.json({ left: await talkLeft(c.env.DB, c.get("player").id), cap: TALK_PER_DAY }));

  app.post("/api/talk", async (c) => {
    const body = await c.req.json<{ who?: unknown; text?: unknown }>().catch(() => ({}) as { who?: unknown; text?: unknown });
    if (!isTownsperson(body.who)) return c.json({ error: "Nobody by that name here." }, 400);
    return askTownsperson(c, body.who, body.text);
  });
}
