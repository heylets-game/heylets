// A party on a map (zone-room.ts): one player's connection brings the rest of
// their party on beside them, acts for whichever of them a message names
// (and for nobody else's hero), and marks them all away when it closes.

import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { hexDistance } from "@gantt-quest/core";
import { zoneOptions, type ZoneView } from "@gantt-quest/world";
import { createZoneRow } from "../src/server/zones";
import { addHero, openDb } from "./d1";
import { FakeSocket as RoomSocket, fakeRoomState, fakeUpgrades } from "./rooms";

const serveNext = fakeUpgrades();
const { ZoneRoom } = await import("../src/server/zone-room");

type Update = { type: "update"; state: ZoneView } | { type: "error"; message: string };
class FakeSocket extends RoomSocket<Update, { playerId: string; party?: string[] }> {
  get state(): ZoneView {
    const last = this.sent.filter((m): m is Extract<Update, { type: "update" }> => m.type === "update").at(-1);
    if (!last) throw new Error("nothing sent yet");
    return last.state;
  }
  get errors(): string[] {
    return this.sent.flatMap((m) => (m.type === "error" ? [m.message] : []));
  }
}

const CREW = "CREWPP";
let sql: DatabaseSync;
let db: D1Database;
let zone: InstanceType<typeof ZoneRoom>;

async function connect(code: string, playerId: string, party: string[] = []): Promise<FakeSocket> {
  const ws = new FakeSocket();
  serveNext(ws);
  const res = await zone.fetch({ headers: new Headers({ Upgrade: "websocket", "x-zone-code": code, "x-player-id": playerId, "x-party-ids": party.join(",") }) } as never);
  if (res.status !== 101) throw new Error(`refused: ${await res.text()}`);
  return ws;
}

const send = (ws: FakeSocket, action: Record<string, unknown>, as?: string) => zone.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: "action", action, ...(as ? { as } : {}) }));

/** A free hex of open ground a step or two from a unit. */
function stepFrom(view: ZoneView, id: string) {
  const at = view.units.find((u) => u.id === id)!.pos;
  const free = (t: { q: number; r: number }) => !view.units.some((u) => u.pos.q === t.q && u.pos.r === t.r);
  const t = view.map.tiles.find((t) => t.biome !== "water" && !t.prop && hexDistance(t, at) <= 2 && hexDistance(t, at) > 0 && free(t))!;
  return { q: t.q, r: t.r };
}

beforeEach(() => {
  ({ sql, db } = openDb());
  const at = Date.now();
  for (const [id, name] of [["ann", "Ann"], ["ann2", "Annika"], ["bo", "Bo"]]) addHero(sql, { id, name, str: 9, int_stat: 4, vit: 9, agi: 4, dex: 4, crew: CREW, at });
  const state = fakeRoomState<FakeSocket>();
  let alarm: number | null = null;
  Object.assign(state.ctx, { waitUntil: () => {} });
  Object.assign(state.ctx.storage, { setAlarm: async (t: number) => void (alarm = t), getAlarm: async () => alarm, deleteAlarm: async () => void (alarm = null) });
  const harbors = { idFromName: (c: string) => c, get: () => ({ fetch: async () => new Response("ok") }) };
  zone = new ZoneRoom(state.ctx as never, { DB: db, ENVIRONMENT: "dev", HARBOR_ROOM: harbors } as never);
});

const options = zoneOptions({ size: "small", biome: "meadow", groups: 1, kinds: ["wolf"], elevation: 0, obstacles: 0, clear: 3, party: 2 });

describe("a party on a map", () => {
  it("brings the party on beside the player, each a hero of their own, with every share of the loot sent", async () => {
    const code = await createZoneRow(db, "ann", options, "party-on");
    const ws = await connect(code, "ann", ["ann2"]);
    const view = ws.state;
    expect(view.you).toBe("ann");
    expect(view.party).toEqual(["ann2"]);
    const [ann, annika] = ["ann", "ann2"].map((id) => view.units.find((u) => u.id === id)!);
    expect(annika.side).toBe("hero");
    // A hero of their own, not a stand-in someone plays.
    expect(annika.controller).toBeUndefined();
    expect(hexDistance(ann.pos, annika.pos)).toBeLessThanOrEqual(2);
  });

  it("gives the party one key, whichever of them the player goes in as, for one share of the spoils", async () => {
    const code = await createZoneRow(db, "ann", options, "party-key");
    let ws = await connect(code, "ann2", ["ann"]);
    await connect(code, "bo");
    const keys = () => Object.fromEntries(ws.state.units.filter((u) => u.side === "hero").map((u) => [u.id, u.party]));
    expect(keys()).toEqual({ ann: "ann", ann2: "ann", bo: undefined });
    ws.close();
    await zone.webSocketClose(ws as unknown as WebSocket, 1000);
    ws = await connect(code, "ann", ["ann2"]);
    expect(keys()).toEqual({ ann: "ann", ann2: "ann", bo: undefined });
    // On their own again: no longer one of a party.
    ws.close();
    await zone.webSocketClose(ws as unknown as WebSocket, 1000);
    ws = await connect(code, "ann");
    expect(keys().ann).toBeUndefined();
  });

  it("moves whichever of the party a message names, and never someone else's hero", async () => {
    const code = await createZoneRow(db, "ann", options, "party-acts");
    const ws = await connect(code, "ann", ["ann2"]);
    await connect(code, "bo");

    const to = stepFrom(ws.state, "ann2");
    await send(ws, { type: "move", unit: "ann2", to }, "ann2");
    expect(ws.state.units.find((u) => u.id === "ann2")!.pos).toEqual(to);

    // Naming a hero who is not of this connection's party is read as the player's own: Bo is not theirs to move.
    const bo = ws.state.units.find((u) => u.id === "bo")!.pos;
    await send(ws, { type: "move", unit: "bo", to: { q: bo.q + 1, r: bo.r } }, "bo");
    expect(ws.state.units.find((u) => u.id === "bo")!.pos).toEqual(bo);
    expect(ws.errors.at(-1)).toMatch(/not yours/i);
  });

  it("pays each of the party their own XP for a fight won", async () => {
    const code = await createZoneRow(db, "ann", options, "party-xp");
    const ws = await connect(code, "ann", ["ann2"]);
    await send(ws, { type: "dev", dev: { op: "ai", off: true } });
    await send(ws, { type: "dev", dev: { op: "start_fight" } });
    expect(ws.state.encounter?.order).toEqual(expect.arrayContaining(["ann", "ann2"]));
    await send(ws, { type: "dev", dev: { op: "end_fight" } });
    const xp = (id: string) => (sql.prepare("SELECT xp + level * 100000 AS n FROM characters WHERE player_id = ?").get(id) as { n: number }).n;
    expect(xp("ann")).toBeGreaterThan(100000);
    expect(xp("ann2")).toBeGreaterThan(100000);
  });

  it("marks the whole party away when the connection closes", async () => {
    const code = await createZoneRow(db, "ann", options, "party-away");
    const ws = await connect(code, "ann", ["ann2"]);
    const other = await connect(code, "bo");
    ws.close();
    await zone.webSocketClose(ws as unknown as WebSocket, 1000);
    const away = (id: string) => other.state.units.find((u) => u.id === id)?.away;
    expect([away("ann"), away("ann2"), away("bo")]).toEqual([true, true, undefined]);
  });
});
