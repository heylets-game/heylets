// ZoneRoom: one Durable Object per zone (a map a party walks freely and
// fights on), addressed by the zone's code.
//
// Its rules:
// - WebSockets use the hibernation API, so an idle room costs nothing.
// - D1 is the system of record. this.zone is only a cache and is reloaded
//   from zones.state_json after hibernation.
// - Every change is persisted before it is broadcast, in as few trips to
//   D1 as the order allows: what a hero used from their pack and the zone
//   itself go in one batch, the pack first.
// - The turn timer is a DO Alarm. Enemy turns resolve inside the reducer, so
//   nothing waits on a connected client to make progress. Out of a fight the
//   same alarm is the clock: while someone is here and something is running
//   out (a condition, a cooldown, the ground, a torch), it wakes the room as
//   each round falls due (zone/clock.ts nextTick), and the round is counted
//   and shown then, not only when someone next does something.
// - What a won fight pays (XP and materials) is written before the zone is
//   saved, as the pack is.
//
// What a hero carries to drink or throw is their own pack's (consumables.ts):
// it is read as they walk in and again before each one is used, and what was
// used is taken out of the pack before the zone is saved.
//
// Walking freely needs no clock at all: the reducer walks a hero's whole
// path at once and says where they ended up, as the Harbor does.
//
// A client may show what it did before it hears back (client/zone/ahead.ts),
// so it numbers its actions. The number comes back to that socket alone: on
// the update that carries what the action did, or on the error that refused
// it. That is all the room does for it: the room still decides everything.
//
// A player may bring a party (party.ts): more of their account's heroes, each a
// hero of their own, all on the player's one connection. Each message says
// which of them it is from (`as`), and only a hero of that connection's party
// is taken at its word; anything else is the player's own hero.
//
// The tiles of a map never change, and they are most of what a state weighs,
// so a client that says it keeps them (x-zone-lean) is sent them once per
// socket and not with every update after. That they have been sent is
// written on the socket itself, which outlives the room's hibernation.

import { DurableObject } from "cloudflare:workers";
import { EMOTE_MIN_MS, HARBOR_MAX_SAY, THROWABLE_KINDS, ZONE_CLIENT_ACTIONS, createZone, hiddenEnemies, loadZone, nextTick, stepZone, zoneAwaiting, zoneHero, zoneOptions, zoneUntimed, zoneView, validEmote, type ZoneAction, type ZoneEvent, type ZoneState } from "@gantt-quest/world";
import { consumablesOf, gainConsumables, kitStatements, spendConsumables, type Consumables } from "./consumables";
import { returnLuck, takeLuck } from "./well";
import { applyZoneGrant, crewFor, heroInitFor, refreshHarbor, type Env } from "./db";
import { isDev } from "./dev";
import { clearNode } from "./atlas";
import { clearPresence, getZoneRow, saveZoneStatement, setPresence, zoneStatus } from "./zones";
import { closeBack, sendTo, tellTrades } from "./walk-room";

/** How long a turn in a fight may take before it ends itself. */
export const ZONE_TURN_MS = 90_000;

interface Attachment {
  playerId: string;
  /** The other heroes of the player's party, played on this connection too. */
  party?: string[];
  /** This client keeps the map's tiles from the first update it is sent, and needs them only once. */
  lean?: boolean;
  /** This socket has been sent the tiles. */
  tiles?: boolean;
}

/** The action being answered: whose socket asked, and the number they gave it (if they gave one). */
interface Asked {
  ws: WebSocket;
  n?: number;
}

const isHex = (v: unknown): v is { q: number; r: number } => !!v && typeof v === "object" && Number.isInteger((v as { q: unknown }).q) && Number.isInteger((v as { r: unknown }).r);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const SURFACES = ["poison", "fire", "oil", "water", "ice", "slime"];

/**
 * A client's message as an action, or null if it is not one. Who it is from comes from the socket,
 * never from the message, and anything misshapen is dropped here so the reducer only sees whole actions.
 * Dev actions pass only on a development deployment.
 */
export function zoneActionFrom(raw: unknown, by: string, dev: boolean): ZoneAction | null {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!ZONE_CLIENT_ACTIONS.has(a.type as ZoneAction["type"])) return null;
  const hex = (v: unknown) => (isHex(v) ? { q: v.q, r: v.r } : undefined);
  const target = text(a.target) ? a.target : undefined;
  if (a.type === "dev") {
    const d = (a.dev && typeof a.dev === "object" ? a.dev : {}) as Record<string, unknown>;
    if (!dev) return null;
    if (d.op === "spawn" && Array.isArray(d.kinds) && isHex(d.at)) return { type: "dev", by, dev: { op: "spawn", kinds: d.kinds.filter(text).slice(0, 6), at: hex(d.at)!, ...(Number.isFinite(d.level) ? { level: Number(d.level) } : {}) } };
    if (d.op === "set_level" && text(d.unit) && Number.isFinite(d.level)) return { type: "dev", by, dev: { op: "set_level", unit: d.unit, level: Number(d.level) } };
    if (d.op === "hero_levels" && Number.isFinite(d.level)) return { type: "dev", by, dev: { op: "hero_levels", level: Number(d.level) } };
    if (d.op === "paint" && Array.isArray(d.hexes) && (d.kind === null || SURFACES.includes(d.kind as string))) {
      return { type: "dev", by, dev: { op: "paint", kind: d.kind as never, hexes: d.hexes.filter(isHex).slice(0, 60).map((p) => hex(p)!) } };
    }
    if (d.op === "standin" && text(d.classId)) return { type: "dev", by, dev: { op: "standin", classId: d.classId } };
    if (d.op === "ai") return { type: "dev", by, dev: { op: "ai", off: !!d.off } };
    if (d.op === "strike" && text(d.unit) && text(d.ability)) {
      return { type: "dev", by, dev: { op: "strike", unit: d.unit, ability: d.ability, ...(text(d.target) ? { target: d.target } : {}), ...(isHex(d.at) ? { at: hex(d.at)! } : {}), ...(d.anywhere ? { anywhere: true } : {}) } };
    }
    if (d.op === "place" && text(d.unit) && isHex(d.at)) return { type: "dev", by, dev: { op: "place", unit: d.unit, at: hex(d.at)! } };
    if (d.op === "set_turn" && text(d.unit)) return { type: "dev", by, dev: { op: "set_turn", unit: d.unit } };
    if (d.op === "sandbox") return { type: "dev", by, dev: { op: "sandbox", on: !!d.on } };
    if (d.op === "next_turn") return { type: "dev", by, dev: { op: "next_turn", ...(d.round ? { round: true } : {}) } };
    if (d.op === "undying") return { type: "dev", by, dev: { op: "undying", on: !!d.on } };
    if (d.op === "heroes_idle") return { type: "dev", by, dev: { op: "heroes_idle", on: !!d.on } };
    if (d.op === "timer") return { type: "dev", by, dev: { op: "timer", off: !!d.off } };
    if (d.op === "kit" && text(d.unit) && text(d.classId) && text(d.weapon) && Array.isArray(d.abilities)) {
      return { type: "dev", by, dev: { op: "kit", unit: d.unit, classId: d.classId, weapon: d.weapon, level: Number(d.level) || 1, abilities: d.abilities.filter(text).slice(0, 20) } };
    }
    if (d.op === "heal" || d.op === "end_fight" || d.op === "start_fight" || d.op === "clear_surfaces" || d.op === "clear_enemies") return { type: "dev", by, dev: { op: d.op } };
    return null;
  }
  if (!text(a.unit)) return null;
  // `from`: where the hero has got to on a walk still being played, to call it off there (the reducer decides whether it may).
  if (a.type === "move") return isHex(a.to) ? { type: "move", by, unit: a.unit, to: hex(a.to)!, ...(isHex(a.from) ? { from: hex(a.from)! } : {}) } : null;
  // `lean`: where in `at` it is aimed; the rules keep it inside that hex (leanWithin).
  const lean = a.lean && typeof a.lean === "object" && Number.isFinite((a.lean as { q: unknown }).q) && Number.isFinite((a.lean as { r: unknown }).r) ? { q: Number((a.lean as { q: number }).q), r: Number((a.lean as { r: number }).r) } : undefined;
  if (a.type === "use") return text(a.ability) ? { type: "use", by, unit: a.unit, ability: a.ability, target, at: hex(a.at), ...(lean ? { lean } : {}) } : null;
  if (a.type === "common") return text(a.what) ? { type: "common", by, unit: a.unit, what: a.what as never, target, at: hex(a.at) } : null;
  // A voyage's stations: an aim in the ship's own frame (finite numbers, nothing more is asked of it here), or which way to put the helm.
  if (a.type === "harpoon") {
    const aim = (a.aim && typeof a.aim === "object" ? a.aim : {}) as { x?: unknown; y?: unknown };
    return text(a.station) && Number.isFinite(aim.x) && Number.isFinite(aim.y) ? { type: "harpoon", by, unit: a.unit, station: a.station, aim: { x: Number(aim.x), y: Number(aim.y) } } : null;
  }
  if (a.type === "steer") return a.dir === 1 || a.dir === -1 ? { type: "steer", by, unit: a.unit, dir: a.dir } : null;
  if (a.type === "cannon") return text(a.station) && target ? { type: "cannon", by, unit: a.unit, station: a.station, target } : null;
  if (a.type === "throw") return text(a.item) && isHex(a.at) ? { type: "throw", by, unit: a.unit, item: a.item as never, at: hex(a.at)! } : null;
  if (a.type === "drink") return text(a.item) ? { type: "drink", by, unit: a.unit, item: a.item as never } : null;
  if (a.type === "pickup") return isHex(a.at) ? { type: "pickup", by, unit: a.unit, at: hex(a.at)! } : null;
  if (a.type === "open") return text(a.poi) ? { type: "open", by, unit: a.unit, poi: a.poi } : null;
  if (a.type === "loot") return text(a.spot) ? { type: "loot", by, unit: a.unit, spot: a.spot } : null;
  if (a.type === "take") {
    // Which thing: by its own number (`uid`), or by its place in a share of the taker's own. Neither: all of it,
    // so one that is given and makes no sense is dropped, never read as "all".
    const whole = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
    for (const v of [a.index, a.uid]) if (v !== undefined && !whole(v)) return null;
    return text(a.spot) ? { type: "take", by, unit: a.unit, spot: a.spot, ...(whole(a.index) ? { index: a.index } : {}), ...(whole(a.uid) ? { uid: a.uid } : {}) } : null;
  }
  if (a.type === "unlock") return text(a.poi) ? { type: "unlock", by, unit: a.unit, poi: a.poi } : null;
  if (a.type === "forage") return text(a.poi) ? { type: "forage", by, unit: a.unit, poi: a.poi } : null;
  if (a.type === "light") return { type: "light", by, unit: a.unit, ...(a.hand === "main" ? { hand: "main" as const } : {}) };
  if (a.type === "stow") return { type: "stow", by, unit: a.unit };
  return { type: "end_turn", by, unit: a.unit };
}

/** How many of each kind a hero has fewer of after a step than before it (`sign` 1), or more of (`sign` -1). */
function usedBy(prev: ZoneState, next: ZoneState, id: string, sign: 1 | -1 = 1): Consumables {
  const had = prev.units.find((u) => u.id === id)?.items ?? {};
  const has = next.units.find((u) => u.id === id)?.items ?? {};
  const used: Consumables = {};
  for (const kind of THROWABLE_KINDS) {
    const n = sign * ((had[kind] ?? 0) - (has[kind] ?? 0));
    if (n > 0) used[kind] = n;
  }
  return used;
}

export class ZoneRoom extends DurableObject<Env> {
  private zone: ZoneState | null = null;
  /** On a zone the atlas made: whose chart and which node of it, and whether that node has been marked cleared from here. */
  private landfall: { crewId: string; node: string; told: boolean } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Whether each player here was last written down as fighting, so presence is only rewritten when it changes. */
  private fighting = new Map<string, boolean>();
  /** When each player last emoted, so a held key cannot flood the map. In memory only: a hibernation resets it. */
  private emotedAt = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Run `fn` after everything queued before it. Keeps actions strictly ordered across awaits. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch((err) => console.error("zone-room:queue-error", err));
    return next;
  }

  private async load(code?: string): Promise<ZoneState> {
    if (this.zone) return this.zone;
    const zoneCode = code ?? (await this.ctx.storage.get<string>("code"));
    if (!zoneCode) throw new Error("zone room has no code");
    const row = await getZoneRow(this.env.DB, zoneCode);
    if (!row) throw new Error(`zone ${zoneCode} not found`);
    // A saved zone is brought up to date: a cave gets a mouth, an enemy its abilities (loadZone).
    this.zone = row.state_json ? loadZone(JSON.parse(row.state_json) as ZoneState) : createZone(row.code, row.seed, zoneOptions(JSON.parse(row.options_json)));
    this.landfall = row.kind === "atlas" && row.crew_id && row.node ? { crewId: row.crew_id, node: row.node, told: row.status === "cleared" } : null;
    if (code) await this.ctx.storage.put("code", code);
    return this.zone;
  }

  /**
   * Bring a hero onto the map (or back onto it), as their sheet and pack stand now. `near`: whose side to come on at.
   * `party`: the key of the party they come with (one share of the spoils between them), or "" on their own.
   */
  private async walkOn(heroId: string, near?: string, party = ""): Promise<string | null> {
    // Read afresh each time: the hero may have changed gear since they were last here.
    const hero = await heroInitFor(this.env.DB, heroId);
    if (!hero) return "You need a character first.";
    // Coins tossed in the town well come onto the map as lucky rolls; if the map cannot take them, they go back.
    const luck = await takeLuck(this.env.DB, heroId);
    const refused = await this.apply({ type: "join", hero: { ...zoneHero(hero, await consumablesOf(this.env.DB, heroId), luck), party }, near });
    if (refused && luck > 0) await returnLuck(this.env.DB, heroId, luck);
    return refused;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      // A trade changed: tell the player it concerns to look again, if they are here and connected.
      const url = new URL(request.url);
      // A muster set out with too many, and its caller left these heroes behind (harbor-room.ts): they do not come
      // onto the map with their party. Played on their own, they still may, if there is room.
      if (url.pathname === "/bench") {
        const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
        const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length <= 64).slice(0, 32) : [];
        const bench = new Set([...((await this.ctx.storage.get<string[]>("bench")) ?? []), ...ids]);
        await this.ctx.storage.put("bench", [...bench]);
        return new Response(null, { status: 204 });
      }
      if (url.pathname !== "/trades") return new Response("expected websocket", { status: 426 });
      return tellTrades(this.ctx, url.searchParams.getAll("to"));
    }
    const code = request.headers.get("x-zone-code");
    const playerId = request.headers.get("x-player-id");
    const near = request.headers.get("x-zone-near") ?? undefined;
    if (!code || !playerId) return new Response("missing zone or player", { status: 400 });
    const asked = (request.headers.get("x-party-ids") ?? "").split(",").filter((id) => id && id !== playerId).slice(0, 8);

    const party: string[] = [];
    // The party's key: the same whichever of them the player went in as, so it is one party's share of the spoils.
    const key = asked.length > 0 ? [playerId, ...asked].sort()[0] : "";
    const error = await this.serial(async () => {
      await this.load(code);
      const refused = await this.walkOn(playerId, near, key);
      if (refused) return refused;
      // The party comes on beside the hero the player went in as. One who cannot is left behind; the rest still come.
      // So is one a muster left behind, unless they are on the map already.
      const bench = new Set((await this.ctx.storage.get<string[]>("bench")) ?? []);
      for (const id of asked) {
        if (bench.has(id) && !this.zone?.units.some((u) => u.id === id)) continue;
        if (!(await this.walkOn(id, playerId, key))) party.push(id);
      }
      return null;
    });
    if (error) return new Response(error, { status: 409 });

    // One socket per hero: a new tab takes over from the old one, and so does a party that has one of its heroes.
    const heroes = [playerId, ...party];
    for (const id of heroes) for (const old of this.ctx.getWebSockets(id)) old.close(4000, "replaced by a newer connection");
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], heroes);
    pair[1].serializeAttachment({ playerId, ...(party.length > 0 ? { party } : {}), ...(request.headers.get("x-zone-lean") === "1" ? { lean: true } : {}) } satisfies Attachment);

    await this.serial(async () => {
      await this.resumeTimer();
      for (const id of heroes) this.fighting.delete(id);
      this.tellHarbor(await this.notePresence());
      this.broadcast([]);
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 8000) return;
    let msg: { type?: string; action?: unknown; n?: unknown; emote?: unknown; text?: unknown; as?: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const seat = ws.deserializeAttachment() as Attachment;
    // Which hero of the party this is from: one of this connection's, else the player's own.
    const playerId = typeof msg.as === "string" && seat.party?.includes(msg.as) ? msg.as : seat.playerId;
    if (msg.type === "sheet") {
      // Gear was changed in the bag: the hero is read again. In a fight the reducer leaves them as they were.
      await this.serial(async () => {
        await this.load();
        const hero = await heroInitFor(this.env.DB, playerId);
        if (hero) await this.apply({ type: "join", hero: zoneHero(hero, await consumablesOf(this.env.DB, playerId)) });
      });
      return;
    }
    if (msg.type === "emote") return this.serial(() => this.emote(playerId, msg.emote));
    // Chat is the player's own, whichever of their party they are acting as.
    if (msg.type === "say") return this.serial(() => this.say(seat.playerId, msg.text));
    if (msg.type !== "action") return;
    // The client's own number for this action, sent back with its answer so it can tell which of its actions was answered.
    const n = typeof msg.n === "number" && Number.isSafeInteger(msg.n) && msg.n >= 0 ? msg.n : undefined;
    const action = zoneActionFrom(msg.action, playerId, isDev(this.env));
    if (!action) {
      // Not an action at all. A client waiting on a number is told so; anything else is dropped as before.
      if (n !== undefined) ws.send(JSON.stringify({ type: "error", message: "That could not be done.", ack: n }));
      return;
    }
    // Throwing, drinking, lighting a torch, picking one up or putting one away as your own hero draws on (or adds to) your own pack. (A stand-in has no pack: it carries the kit it was given.)
    const pack = (action.type === "throw" || action.type === "drink" || action.type === "light" || action.type === "pickup" || action.type === "stow") && action.unit === playerId ? playerId : undefined;
    const error = await this.serial(async () => {
      await this.load();
      return this.apply(action, pack, { ws, n });
    });
    if (error) ws.send(JSON.stringify({ type: "error", message: error, ...(n !== undefined ? { ack: n } : {}) }));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    closeBack(ws, code);
    const seat = (ws.deserializeAttachment() as Attachment | null) ?? { playerId: "" };
    await this.serial(async () => {
      const zone = await this.load();
      // Each hero on it (the player's, and their party's) is gone from the zone, unless another tab has them here.
      for (const playerId of [seat.playerId, ...(seat.party ?? [])]) {
        if (!playerId || this.ctx.getWebSockets(playerId).some((other) => other !== ws)) continue;
        // Their hero (and any stand-in they play) stays where it is, but nothing draws it into a fight while they are gone.
        if (zone.units.some((u) => u.side === "hero" && (u.id === playerId || u.controller === playerId) && !u.away)) await this.apply({ type: "away", player: playerId, away: true });
        this.fighting.delete(playerId);
        await clearPresence(this.env.DB, playerId, zone.code);
        this.tellHarbor([playerId]);
      }
      this.broadcast([]);
    });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }

  async alarm(): Promise<void> {
    await this.serial(async () => {
      const zone = await this.load();
      // Nobody here: pause. resumeTimer restarts the clock when someone comes back.
      if (this.ctx.getWebSockets().length === 0) return;
      // Out of a fight: a round (or a torch's) has fallen due. Counting it sets the next (apply, armClock).
      if (!zone.encounter) {
        await this.apply({ type: "time", now: Date.now() });
        return;
      }
      const deadline = zone.encounter?.deadline ?? null;
      // No time limit on turns (DevOp "timer", or the sandbox): nothing to run out.
      if (zoneUntimed(zone)) return;
      if (deadline && Date.now() < deadline - 500) {
        await this.ctx.storage.setAlarm(deadline);
        return;
      }
      if (zone.encounter) await this.apply({ type: "timeout" });
    });
  }

  /**
   * Step the zone, persist, then broadcast. Returns an error string or null. `pack`: the player whose own
   * hero this draws a potion or flask from; their pack is read first and what was used is taken out of it.
   * `from`: the socket that asked, which is told its own number back on the update (or, by the caller, on the error).
   */
  private async apply(action: ZoneAction, pack?: string, from?: Asked): Promise<string | null> {
    const db = this.env.DB;
    // A walk is timed, so the next may call it off while it is still being played (zone.ts, cutShort).
    if (action.type === "move") action = { ...action, now: Date.now() };
    let prev = this.zone!;
    // Time out of a fight has gone by since the last thing done here (zone/clock.ts): it passes first.
    let passed: ZoneEvent[] = [];
    if (action.type !== "time") {
      const timed = stepZone(prev, { type: "time", now: Date.now() });
      if (timed.ok) {
        prev = timed.state;
        passed = timed.events;
      }
    }
    if (pack) {
      // What they carry is what their pack holds now, whatever the map last heard.
      const held = stepZone(prev, { type: "stock", unit: pack, items: await consumablesOf(db, pack) });
      if (held.ok) prev = held.state;
    }
    let res: ReturnType<typeof stepZone>;
    try {
      res = stepZone(prev, action);
    } catch (err) {
      console.error("zone-room:step-failed", { type: action.type, err: err instanceof Error ? err.message : String(err) });
      return "That could not be done.";
    }
    if (!res.ok) {
      // Refused, but the count may have been wrong on screen (the pack held fewer than the map thought): put it right.
      if (prev !== this.zone) {
        this.zone = prev;
        await saveZoneStatement(db, prev).run();
        this.broadcast(passed);
      }
      return res.error;
    }
    const next = res.state;
    // A new turn, or turns timed or untimed again (DevOp "timer", "sandbox").
    if (zoneAwaiting(next) !== zoneAwaiting(prev) || zoneUntimed(next) !== zoneUntimed(prev)) await this.armTimer(next);
    // Out of a fight, the clock's next round.
    if (!zoneAwaiting(next)) await this.armClock(next);
    this.zone = next;
    // The pack first: a potion drunk is gone from it even if the room goes away before the zone is saved.
    const writes: D1PreparedStatement[] = [];
    if (pack) writes.push(...spendConsumables(db, pack, usedBy(prev, next, pack)), ...gainConsumables(db, pack, usedBy(prev, next, pack, -1)));
    // The dev toolbox's restock is real too, for every player's hero here.
    if (action.type === "dev" && action.dev.op === "heal") for (const u of next.units) if (u.side === "hero" && !u.controller) writes.push(...kitStatements(db, u.id));
    const grants = res.effects.filter((effect) => effect.type === "grant");
    // Whose crew's Harbor has something new to show once all of this is written: it is told once, at the end.
    const news = new Set<string>();
    if (grants.length === 0) {
      // The common case, and one trip to D1 for all of it: the pack's rows and then the zone, in that order.
      await db.batch([...writes, saveZoneStatement(db, next)]);
    } else {
      if (writes.length > 0) await db.batch(writes);
      // What a won fight paid, written before the zone is saved (and so before anyone is told of it).
      for (const effect of grants) {
        const { place } = await applyZoneGrant(db, effect.heroId, effect);
        // A full pack never loses what was found, but the hero hears where it went.
        if (effect.item && (place === "storage" || place === "overfull")) res.events.push({ t: "stowed", id: effect.heroId, item: effect.item.name, place });
        // The roster shows each hero's level.
        news.add(effect.heroId);
      }
      await saveZoneStatement(db, next).run();
    }
    // A landfall cleared (nobody left to fight, nothing left to open) is cleared on the crew's chart: once, and
    // the Harbor is told, so a chart that is open there shows the routes beyond it.
    const landfall = this.landfall;
    let charted: string | null = null;
    if (landfall && !landfall.told && zoneStatus(next) === "cleared") {
      landfall.told = true;
      await clearNode(db, landfall.crewId, landfall.node);
      charted = landfall.crewId;
    }
    for (const playerId of await this.notePresence()) news.add(playerId);
    this.tellHarbor(news, charted);
    this.broadcast([...passed, ...res.events], from);
    return null;
  }

  /**
   * Write down, for everyone connected, that they are here and whether they are in a fight: only what has changed.
   * Gives whose record changed, for the Harbor to be told of (`tellHarbor`).
   */
  private async notePresence(): Promise<string[]> {
    const zone = this.zone;
    if (!zone) return [];
    const changed: string[] = [];
    for (const playerId of this.online()) {
      const now = !!zone.encounter?.order.includes(playerId);
      if (this.fighting.get(playerId) === now) continue;
      this.fighting.set(playerId, now);
      changed.push(playerId);
    }
    // One player's record does not wait on another's.
    await Promise.all(changed.map((playerId) => setPresence(this.env.DB, playerId, zone.code, this.fighting.get(playerId) === true)));
    return changed;
  }

  /**
   * The crew's Harbor shows where its members are and their levels: tell it to look again. Once for each crew,
   * however many of its members there is news of. `crewId`: a crew to tell whoever the players are (its chart changed).
   * Nothing waits for it, and it is called once everything it is to show has been written.
   */
  private tellHarbor(players: Iterable<string>, crewId: string | null = null) {
    const ids = [...new Set(players)];
    if (ids.length === 0 && !crewId) return;
    const crewOf = (playerId: string) =>
      crewFor(this.env.DB, playerId).then(
        (crew) => crew?.id ?? null,
        (err) => (console.warn("zone-room:harbor-refresh-failed", { err: err instanceof Error ? err.message : String(err) }), null),
      );
    this.ctx.waitUntil(
      Promise.all(ids.map(crewOf)).then((crews) => Promise.all([...new Set([crewId, ...crews])].map((crew) => refreshHarbor(this.env, crew)))),
    );
  }

  /**
   * An emote (see EMOTES), shown to everyone here and not kept: only for show, so the
   * reducer never hears of it, and in a fight it costs nothing and takes no turn. Not from a hero who is down, and at
   * most one per EMOTE_MIN_MS.
   */
  private async emote(playerId: string, asked: unknown) {
    const emote = validEmote(asked);
    const now = Date.now();
    if (!emote || now - (this.emotedAt.get(playerId) ?? -Infinity) < EMOTE_MIN_MS) return;
    const zone = await this.load();
    const hero = zone.units.find((u) => u.id === playerId);
    if (!hero || hero.down) return;
    this.emotedAt.set(playerId, now);
    for (const ws of this.ctx.getWebSockets()) sendTo(ws, { type: "emoted", id: playerId, emote });
  }

  /**
   * A line of chat, tidied and cut to length, to everyone on the map (the speaker too), in a fight or out of one, and
   * from a hero who is down as well: words cost nothing and take no turn. Not kept, and the reducer never hears of it.
   */
  private async say(playerId: string, said: unknown) {
    const text = (typeof said === "string" ? said : "").replace(/\s+/g, " ").trim().slice(0, HARBOR_MAX_SAY);
    if (!text) return;
    const zone = await this.load();
    const hero = zone.units.find((u) => u.id === playerId && u.side === "hero");
    if (!hero) return;
    for (const ws of this.ctx.getWebSockets()) sendTo(ws, { type: "said", id: playerId, name: hero.name, text });
  }

  /** Heroes connected right now: each player's, and their party's. */
  private online(): string[] {
    return [...new Set(this.ctx.getWebSockets().flatMap((ws) => {
      const seat = ws.deserializeAttachment() as Attachment;
      return [seat.playerId, ...(seat.party ?? [])];
    }))];
  }

  /** Tell everyone here the state and what happened. `from`: whose action this answers; their socket alone gets their number back. */
  private broadcast(events: ZoneEvent[], from?: Asked) {
    const zone = this.zone;
    if (!zone) return;
    const online = this.online();
    // Who is out of sight is the same whoever is looking: worked out once for everyone here.
    const hidden = hiddenEnemies(zone);
    for (const ws of this.ctx.getWebSockets()) {
      const seat = ws.deserializeAttachment() as Attachment;
      const view = zoneView(zone, seat.playerId, hidden, seat.party);
      // The tiles go once to a client that keeps them: everything else about the map (its places) goes every time.
      const { tiles: _tiles, ...rest } = view.map;
      const state = seat.lean && seat.tiles ? { ...view, map: rest } : view;
      try {
        // `acks` tells a client that this room answers numbered actions, so it is safe for it to show them ahead.
        ws.send(JSON.stringify({ type: "update", state, events, online, acks: true, ...(from?.ws === ws && from.n !== undefined ? { ack: from.n } : {}) }));
        if (seat.lean && !seat.tiles) ws.serializeAttachment({ ...seat, tiles: true } satisfies Attachment);
      } catch {
        // Socket is closing; webSocketClose will follow.
      }
    }
  }

  /** A new turn is being waited on (or none is): set its deadline and the alarm that ends it. None while the dev switch has turns untimed. */
  private async armTimer(zone: ZoneState) {
    const deadline = zoneAwaiting(zone) && !zoneUntimed(zone) ? Date.now() + ZONE_TURN_MS : null;
    if (zone.encounter) zone.encounter.deadline = deadline;
    if (deadline) await this.ctx.storage.setAlarm(deadline);
    else await this.ctx.storage.deleteAlarm();
  }

  /**
   * Out of a fight: wake the room when the next round falls due, if anything is running out (zone/clock.ts nextTick);
   * else no alarm at all. A fight's own timer (armTimer) is left alone.
   */
  private async armClock(zone: ZoneState) {
    if (zoneAwaiting(zone)) return;
    const due = nextTick(zone);
    if (due === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(due, Date.now() + 100));
  }

  /** Called when someone connects: restart a clock that lapsed while the zone was empty. */
  private async resumeTimer() {
    const zone = this.zone!;
    if (!zoneAwaiting(zone)) return this.armClock(zone);
    const deadline = zone.encounter?.deadline ?? null;
    const alarm = await this.ctx.storage.getAlarm();
    if (!zoneUntimed(zone) && (alarm === null || !deadline || deadline < Date.now())) {
      await this.armTimer(zone);
      await saveZoneStatement(this.env.DB, zone).run();
    }
  }
}
