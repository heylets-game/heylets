// HarborRoom: one Durable Object per crew, holding that crew's shared,
// walkable Harbor.
//
// It is a relay, not a simulation. Players walk freely; the object checks
// each requested path against the fixed Harbor map and tells everyone
// present. There is no tick loop. Who is here and where they stand lives in
// each socket's attachment, so it survives hibernation without touching D1.
// Crew membership and the crew's board are read from D1, which stays
// the system of record. The relay itself (who is here, walking, looking,
// chat, leaving) is the one the huts and the pub use too: walk-room.ts.
//
// The one thing it keeps of its own is the crew's muster (packages/world/
// src/muster.ts): someone setting out for a place on the atlas, and who of
// those in town is coming. That is in the object's storage, with an alarm
// for when its time runs out, so it outlives a hibernation too; when it
// starts, the map is made here, for as many as said they were ready.

import { DurableObject } from "cloudflare:workers";
import {
  HARBOR_BUILDINGS,
  HARBOR_PLOTS,
  HARBOR_PUB,
  HARBOR_SPAWN,
  isKeeperHouse,
  generateHarbor,
  fishFrom,
  harborPath,
  type HarborBoard,
  type HarborClientMessage,
  type HarborPlayer,
  type HarborServerMessage,
  type Vessel,
  MUSTER_ANSWERS,
  MUSTER_LINGER_MS,
  answerMuster,
  callMuster,
  musterDue,
  musterGoing,
  musterOpen,
  musterShown,
  settleMuster,
  type Muster,
  type MusterAnswer,
  type MusterMember, } from "@gantt-quest/world";
import type { HexPos } from "@gantt-quest/core";
import { getCrew, harborBoard, heroInitFor, type Env } from "./db";
import { gildedRod, partyVessel } from "./fishmarket";
import { clearPresence } from "./zones";
import { openNode } from "./atlas";
import { Walkers, hexAsked, tellTrades, walkerFrom, withHero } from "./walk-room";
import { partyNamed, partyOf } from "./party";

/**
 * Someone answering a muster, as the worker sent them (routes/atlas.ts): with the heroes they bring, their party, or
 * (from an older worker) how many heroes that makes.
 */
function memberFrom(m: MusterMember): MusterMember {
  const party = Array.isArray(m.party) ? m.party.filter((h) => typeof h?.id === "string" && typeof h.name === "string").slice(0, 8).map((h) => ({ id: h.id, name: h.name })) : null;
  if (party) return { id: m.id, name: m.name, ...(party.length > 0 ? { party } : {}) };
  return { id: m.id, name: m.name, ...(typeof m.heroes === "number" && Number.isInteger(m.heroes) && m.heroes > 1 ? { heroes: m.heroes } : {}) };
}

/** A muster as it is kept: with the crew it is for and the lodestone set into the place, neither of which is sent to anyone. */
interface KeptMuster {
  crewId: string;
  stone?: unknown;
  muster: Muster;
  /** Its map is being made right now: it takes no more answers, and nothing starts it a second time. */
  starting?: boolean;
}

const MAP = generateHarbor();

/** A hex asked for as "q,r", if a hero could have walked (or, with this boat, rowed) there from where heroes arrive. */
function standingAt(at: string | null, vessel: Vessel | null): HexPos | undefined {
  const m = at?.match(/^(-?\d{1,3}),(-?\d{1,3})$/);
  if (!m) return undefined;
  const pos = { q: Number(m[1]), r: Number(m[2]) };
  return harborPath(MAP, HARBOR_SPAWN, pos, vessel) ? pos : undefined;
}

/**
 * The building a hero asked to be marked inside (`?inside=`), as everyone is told it, and its door: "pub", a keeper's
 * house, or "hut:<owner id>" for a hut that stands. Null for anything else.
 */
function insideAt(asked: string | null, board: HarborBoard): { inside: string; door: HexPos } | null {
  if (asked === "pub") return { inside: asked, door: HARBOR_PUB };
  if (isKeeperHouse(asked)) {
    const door = HARBOR_BUILDINGS.find((b) => b.id === asked)?.door;
    return door ? { inside: asked, door } : null;
  }
  const owner = asked?.match(/^hut:([A-Za-z0-9-]{1,64})$/)?.[1];
  const plot = owner ? board.members.find((m) => m.id === owner && !m.bin)?.plot : null;
  return plot != null && HARBOR_PLOTS[plot] ? { inside: asked!, door: HARBOR_PLOTS[plot] } : null;
}

export class HarborRoom extends DurableObject<Env> {
  /** Who is here: presence, walking and chat. */
  private here: Walkers<HarborServerMessage>;
  /** The muster whose map is being made this moment (its id): set before anything is waited on, so nothing in this room starts it twice. */
  private startingMuster: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.here = new Walkers(ctx);
  }

  async fetch(request: Request): Promise<Response> {
    const crewId = request.headers.get("x-crew-id");
    if (!crewId) return new Response("missing crew", { status: 400 });
    const { pathname, searchParams } = new URL(request.url);

    // Something the board shows changed (a member, a hut, a project, a map opened): re-read it.
    if (pathname === "/refresh") {
      if (this.ctx.getWebSockets().length > 0) {
        this.here.broadcast({ type: "board", ...(await harborBoard(this.env.DB, crewId)) });
      }
      return new Response("ok");
    }

    // A piece of flotsam was taken: it goes from everyone's beach or water at once.
    if (pathname === "/flotsam") {
      const id = searchParams.get("id");
      if (id) this.here.broadcast({ type: "flotsam", id });
      return new Response("ok");
    }

    // A trade changed: tell the player it concerns to look again, if they are here. Nobody else hears of it.
    if (pathname === "/trades") return tellTrades(this.ctx, searchParams.getAll("to"));

    // Who is walking the Harbor right now: the crewmates who would go down into the caves together.
    if (pathname === "/present") {
      return Response.json({ ids: this.here.players().filter((p) => !p.inside).map((p) => p.id) });
    }

    // Where a hero is standing in the Harbor (or afloat), if they are here: a line is cast from where the hero is,
    // never from where their client says they are (server/gather.ts).
    if (pathname === "/where") {
      const who = searchParams.get("id");
      const player = who ? this.here.players().find((p) => p.id === who && !p.inside) : undefined;
      return Response.json({ pos: player?.pos ?? null });
    }

    // The crew's muster: how it stands; one called; an answer to it. (The worker has checked who is asking.)
    if (pathname === "/muster") return Response.json({ muster: await this.musterNow() });
    if (pathname === "/muster/call") {
      const body = (await request.json().catch(() => null)) as { by?: MusterMember; to?: { node: string; place: string; site?: string; level?: number; most?: number }; stone?: unknown } | null;
      if (!body?.by?.id || !body.to?.node) return Response.json({ error: "Nothing to muster for." }, { status: 400 });
      const kept = await this.ctx.storage.get<KeptMuster>("muster");
      if (kept && musterOpen(kept.muster)) {
        return Response.json({ error: kept.muster.by.id === body.by.id ? "You are mustering already." : `${kept.muster.by.name} is mustering for ${kept.muster.place}: answer that first.` }, { status: 409 });
      }
      // Nobody else in town: there is nobody to ask, and the worker makes the map at once. (Someone inside a building
      // is not asked: they cannot see the muster from in there.)
      const asked = this.here.players().filter((p) => p.id !== body.by!.id && !p.inside).map((p) => ({ id: p.id, name: p.name }));
      if (asked.length === 0) return Response.json({ alone: true });
      const muster = callMuster(crypto.randomUUID().slice(0, 8), memberFrom(body.by), body.to, asked, Date.now());
      await this.ctx.storage.put("muster", { crewId, stone: body.stone, muster } satisfies KeptMuster);
      await this.ctx.storage.setAlarm(muster.deadline);
      this.here.broadcast({ type: "muster", muster });
      return Response.json({ muster });
    }
    if (pathname === "/muster/answer") {
      const body = (await request.json().catch(() => null)) as { who?: MusterMember; answer?: MusterAnswer; left?: unknown } | null;
      const kept = await this.ctx.storage.get<KeptMuster>("muster");
      if (!body?.who?.id || !body.answer || !MUSTER_ANSWERS.includes(body.answer)) return Response.json({ error: "That is no answer." }, { status: 400 });
      if (!kept || !musterOpen(kept.muster)) return Response.json({ error: "There is no muster to answer." }, { status: 409 });
      if (kept.starting || this.startingMuster === kept.muster.id) return Response.json({ error: "They are setting out this moment." }, { status: 409 });
      const res = answerMuster(kept.muster, memberFrom(body.who), body.answer, Date.now());
      if ("error" in res) return Response.json({ error: res.error }, { status: 409 });
      if (res.cancel) return Response.json({ muster: await this.endMuster({ ...kept, muster: { ...res.muster, failed: `${res.muster.by.name} called it off.` } }) });
      if (res.start) return Response.json({ muster: await this.startMuster({ ...kept, muster: res.muster }, body.answer === "start" ? body.left : undefined) });
      await this.ctx.storage.put("muster", { ...kept, muster: res.muster } satisfies KeptMuster);
      this.here.broadcast({ type: "muster", muster: res.muster });
      return Response.json({ muster: res.muster });
    }

    // A hero earned XP: show it over their head, if they are here.
    if (pathname === "/xp") return this.here.xpPosted(request);

    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const id = request.headers.get("x-player-id");
    if (!id) return new Response("missing player or crew", { status: 400 });
    // The crew, and what everyone will see of this hero (their party's best boat, their look, a gilded rod). The four readings
    // do not wait on one another, so they are asked for together.
    const db = this.env.DB;
    const [crew, vessel, hero, gilded] = await Promise.all([getCrew(db, crewId), partyVessel(db, id), heroInitFor(db, id), gildedRod(db, id)]);
    if (!crew) return new Response("missing player or crew", { status: 400 });

    // Here, so not out on a zone: whatever a room that went away without saying so left written down is cleared.
    // (Before the board is read, so the board does not show them out on one.)
    await clearPresence(this.env.DB, id);
    const board = await harborBoard(this.env.DB, crewId);

    // One socket per player. A new tab takes over, standing where the old one stood.
    // Someone stepping out of a hut or the pub arrives at its door.
    // Someone back from being away (their socket was closed while idle) asks to stand where they stood.
    // Someone inside one of the town's buildings (`inside`) is kept here, at its door and out of the street, so the
    // crew can see where they are: their portrait over its roof.
    const at = searchParams.get("at");
    const asked = (at === "pub" ? HARBOR_PUB : at !== null && /^\d{1,2}$/.test(at) ? HARBOR_PLOTS[Number(at)] : standingAt(at, vessel)) ?? HARBOR_SPAWN;
    // (Inside somewhere this room cannot place, they are still kept out of the street, with no roof to show them over.)
    const indoors = searchParams.has("inside") ? insideAt(searchParams.get("inside"), board) ?? { inside: "elsewhere", door: asked } : null;
    const stood = this.here.takeOver(id, indoors?.door ?? asked);
    const pos = indoors?.door ?? stood;
    const player: HarborPlayer = { ...walkerFrom(request, id, hero, pos), vessel, gilded, ...(indoors ? { inside: indoors.inside } : {}) };

    // The muster as it stands, looked up before this socket is in the room: if looking drops one that has lapsed,
    // the room is told so once, and this socket once below.
    const muster = await this.musterNow();
    const pair = new WebSocketPair();
    this.here.admit(pair[1], player);

    pair[1].send(JSON.stringify({ type: "snapshot", you: id, crew, players: this.here.players(), ...board } satisfies HarborServerMessage));
    // Someone is mustering: one who walks in while it is on is asked too. (And one who walks back in after it is
    // over is told there is none, so nothing they last heard is left showing.)
    pair[1].send(JSON.stringify({ type: "muster", muster } satisfies HarborServerMessage));
    this.here.broadcast({ type: "joined", player }, pair[1]);
    // Their arrival may also be news for the roster (a brand-new member).
    this.here.broadcast({ type: "board", ...board }, pair[1]);
    // Gone indoors, where the muster cannot be seen: it stops waiting for them, as for someone who left town.
    if (indoors) await this.musterLeft(id);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ---------- the muster ----------

  /** The muster worth telling anyone about: one waiting for answers, or one that ended a moment ago. */
  private async musterNow(): Promise<Muster | null> {
    const kept = await this.ctx.storage.get<KeptMuster>("muster");
    if (!kept) return null;
    if (musterShown(kept.muster, Date.now())) return kept.muster;
    await this.dropMuster();
    return null;
  }

  /** It has been told long enough: forgotten, and the room is told there is none. */
  private async dropMuster(): Promise<void> {
    await this.ctx.storage.delete("muster");
    this.here.broadcast({ type: "muster", muster: null });
  }

  /** Someone a muster was waiting on has left town without answering: it stops waiting for them, and starts if they were the last. */
  private async musterLeft(id: string): Promise<void> {
    const kept = await this.ctx.storage.get<KeptMuster>("muster");
    if (!kept || kept.starting || this.startingMuster === kept.muster.id || !musterOpen(kept.muster)) return;
    const { muster } = kept;
    if (!muster.asked.some((a) => a.id === id) || muster.ready.some((r) => r.id === id) || muster.declined.includes(id)) return;
    const next: KeptMuster = { ...kept, muster: { ...muster, asked: muster.asked.filter((a) => a.id !== id) } };
    if (musterDue(next.muster, Date.now())) return void (await this.startMuster(next));
    await this.ctx.storage.put("muster", next);
    this.here.broadcast({ type: "muster", muster: next.muster });
  }

  /** It is over, one way or the other: kept a little while so everyone hears how it ended, and told to the room. */
  private async endMuster(kept: KeptMuster): Promise<Muster> {
    const muster: Muster = { ...kept.muster, endedAt: Date.now() };
    await this.ctx.storage.put("muster", { crewId: kept.crewId, muster } satisfies KeptMuster);
    await this.ctx.storage.setAlarm(Date.now() + MUSTER_LINGER_MS);
    this.here.broadcast({ type: "muster", muster });
    return muster;
  }

  /**
   * They set out: the map is made for as many heroes as the ready bring (their parties too), with the caller's
   * lodestone, and everyone is told its code. Unless that is more than the crew's ship carries (the muster's `most`): then the caller is given time to
   * choose who stays behind (`left`: who they chose, with their "start"), and it sets out once they have, or once
   * their time is up.
   */
  private async startMuster(kept: KeptMuster, left?: unknown): Promise<Muster> {
    // Making the map waits on the database, and the room hears other things meanwhile (an answer, the alarm, the
    // caller's "start"): it is marked as starting first, in the room's own storage, so none of them starts it again.
    if (this.startingMuster === kept.muster.id) return kept.muster;
    this.startingMuster = kept.muster.id;
    const now = await this.ctx.storage.get<KeptMuster>("muster");
    if (now && now.muster.id === kept.muster.id && (now.starting || !musterOpen(now.muster))) return now.muster;
    // Each party as it is now, not as it was when its hero answered: it may have changed since.
    const fresh: Muster = { ...kept.muster, ready: await Promise.all(kept.muster.ready.map(async (r) => this.withParty(r))) };
    fresh.by = fresh.ready.find((r) => r.id === fresh.by.id) ?? fresh.by;
    const settled = settleMuster(fresh, Date.now(), left);
    if (!settled.start) {
      // Too many: the caller chooses. Nothing has been made, so it is not starting after all.
      this.startingMuster = null;
      await this.ctx.storage.put("muster", { ...kept, muster: settled.muster } satisfies KeptMuster);
      await this.ctx.storage.setAlarm(settled.muster.deadline);
      this.here.broadcast({ type: "muster", muster: settled.muster });
      return settled.muster;
    }
    const muster = settled.muster;
    kept = { ...kept, muster };
    await this.ctx.storage.put("muster", { ...kept, starting: true } satisfies KeptMuster);
    const went = await openNode(this.env.DB, kept.crewId, muster.by.id, muster.node, musterGoing(muster, muster.left), kept.stone).catch((err: unknown) => ({ error: err instanceof Error ? err.message : "The map could not be made.", status: 409 as const }));
    // Those left behind do not come onto it with their party (zone-room.ts): only the ones the caller took.
    if (!("error" in went) && muster.left?.length) {
      try {
        const zone = this.env.ZONE_ROOM.get(this.env.ZONE_ROOM.idFromName(went.code));
        await zone.fetch("https://zone/bench", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: muster.left }) });
      } catch (err) {
        console.error("harbor-room:bench", err);
      }
    }
    const ended = await this.endMuster({ ...kept, muster: "error" in went ? { ...muster, failed: went.error } : { ...muster, code: went.code } });
    // The chart has changed: the board says so.
    if (!("error" in went) && this.ctx.getWebSockets().length > 0) this.here.broadcast({ type: "board", ...(await harborBoard(this.env.DB, kept.crewId)) });
    return ended;
  }

  /** A muster member with their party as it stands now (party.ts), names and all. */
  private async withParty(r: MusterMember): Promise<MusterMember> {
    const party = await partyNamed(this.env.DB, r.id).catch(() => null);
    if (!party) return r;
    const { heroes: _heroes, party: _party, ...rest } = r;
    return { ...rest, ...(party.length > 0 ? { party } : {}) };
  }

  /** The muster's time is up (it starts with whoever is ready), or one that ended has been told long enough. */
  async alarm(): Promise<void> {
    const kept = await this.ctx.storage.get<KeptMuster>("muster");
    if (!kept) return;
    const now = Date.now();
    if (kept.starting) return;
    if (musterOpen(kept.muster)) {
      if (musterDue(kept.muster, now)) await this.startMuster(kept);
      else await this.ctx.storage.setAlarm(kept.muster.deadline);
    } else if (!musterShown(kept.muster, now)) await this.dropMuster();
    else await this.ctx.storage.setAlarm((kept.muster.endedAt ?? now) + MUSTER_LINGER_MS);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const heard = this.here.read<HarborClientMessage>(ws, message);
    if (!heard) return;
    const { player, msg } = heard;
    // Someone inside a building is only shown, over its roof: they do not walk, fish, talk or look about out here.
    // (A change of gear still shows on their portrait.)
    if (player.inside && msg.type !== "refresh") return;

    if (msg.type === "move") {
      const to = hexAsked(msg.to);
      if (!to) return;
      // With a boat, out onto the water: a barrel along the coast, a rowboat anywhere. Asked for while the last walk
      // is still being played: that one stops where it had got to, and this one goes on from there (its first hex).
      const cut = this.here.cutAt(player, msg.from);
      const fromCut = cut && (cut.q === to.q && cut.r === to.r ? [] : harborPath(MAP, cut, to, player.vessel ?? null));
      const path = cut && fromCut ? [cut, ...fromCut] : harborPath(MAP, player.pos, to, player.vessel ?? null);
      if (!path) {
        // No way there. A client shows its own walks at the click and counts the answers (client/useHarbor.ts), so
        // it is told this one was not made, and where its hero really stands. Nobody else saw anything, so nobody else is told.
        ws.send(JSON.stringify({ type: "stayed", id: player.id, pos: player.pos } satisfies HarborServerMessage));
        return;
      }
      // Walking off rolls the bedroll back up, and puts the rod away.
      this.here.walk(ws, player, path, { bedroll: undefined, fishing: undefined }, cut && fromCut ? cut : null);
    } else if (msg.type === "refresh") {
      // They changed gear or levelled: re-read the character and show everyone the new look. The three
      // readings do not wait on one another, so they are asked for together. One figure walks the town for a whole
      // party (party.ts): it is drawn as whichever of the party they are acting as, and only as one of their party, and rows the best boat any of them owns.
      const asked = typeof msg.as === "string" ? msg.as : player.as ?? player.id;
      const as = asked === player.id || (await partyOf(this.env.DB, player.id)).includes(asked) ? asked : player.id;
      const [hero, vessel, gilded] = await Promise.all([heroInitFor(this.env.DB, as), partyVessel(this.env.DB, player.id), gildedRod(this.env.DB, player.id)]);
      if (hero) this.here.show(ws, { ...withHero(player, hero), vessel, gilded, as: as === player.id ? undefined : as });
    } else if (msg.type === "bedroll") {
      // Purely for show: the rest itself is decided by the server over HTTP. Not on a place, a street corner is fine.
      if (MAP.pois.some((p) => p.pos.q === player.pos.q && p.pos.r === player.pos.r)) return;
      this.here.show(ws, { ...player, bedroll: player.pos, sat: undefined });
    } else if (msg.type === "fishing") {
      // Purely for show, like the bedroll: the sitting itself is the server's over HTTP. Only at a fishing spot.
      const on = msg.on === true && fishFrom(MAP, player.pos, player.vessel ?? null) !== null;
      if (!!player.fishing === on) return;
      this.here.show(ws, { ...player, fishing: on || undefined, sat: undefined });
    } else if (msg.type === "look") {
      this.here.look(ws, player, msg.look);
    } else if (msg.type === "unstick") {
      // Back where heroes arrive, with the bedroll rolled up.
      this.here.unstick(ws, player, HARBOR_SPAWN, { bedroll: undefined });
    } else if (msg.type === "say") {
      this.here.say(player, msg.text);
    } else if (msg.type === "emote") {
      this.here.emote(ws, player, msg.emote);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const player = this.here.closed(ws, code);
    // Nobody waits for an answer from someone who has walked out of town. (They can still say they are coming,
    // from wherever they went: the atlas shows the muster too.)
    if (player && this.ctx.getWebSockets(player.id).every((other) => other === ws)) await this.musterLeft(player.id);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }
}
