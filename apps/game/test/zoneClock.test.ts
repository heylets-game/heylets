// The clock out of a fight (zone-room.ts, zone/clock.ts): while someone is on a map and something is running out,
// the room's alarm is set for the next round and, when it goes off, the round is counted and shown, though nobody
// did anything. With nothing running out there is no alarm.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORE_ROUND_MS, zoneOptions, type ZoneView } from "@gantt-quest/world";
import { createZoneRow } from "../src/server/zones";
import { addHero, openDb } from "./d1";
import { FakeSocket as RoomSocket, fakeRoomState, fakeUpgrades } from "./rooms";

const serveNext = fakeUpgrades();
const { ZoneRoom } = await import("../src/server/zone-room");

type Update = { type: "update"; state: ZoneView } | { type: "error"; message: string };
class FakeSocket extends RoomSocket<Update, { playerId: string }> {
  get state(): ZoneView {
    const last = this.sent.filter((m): m is Extract<Update, { type: "update" }> => m.type === "update").at(-1);
    if (!last) throw new Error("nothing sent yet");
    return last.state;
  }
}

const T0 = Date.UTC(2026, 10, 24, 12);
let db: D1Database;
let zone: InstanceType<typeof ZoneRoom>;
let alarm: number | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  const opened = openDb();
  db = opened.db;
  addHero(opened.sql, { id: "ann", name: "Ann", str: 9, int_stat: 4, vit: 9, agi: 4, dex: 4, crew: "CREWCL", at: T0 });
  const state = fakeRoomState<FakeSocket>();
  alarm = null;
  Object.assign(state.ctx, { waitUntil: () => {} });
  Object.assign(state.ctx.storage, { setAlarm: async (t: number) => void (alarm = t), getAlarm: async () => alarm, deleteAlarm: async () => void (alarm = null) });
  const harbors = { idFromName: (c: string) => c, get: () => ({ fetch: async () => new Response("ok") }) };
  zone = new ZoneRoom(state.ctx as never, { DB: db, ENVIRONMENT: "dev", HARBOR_ROOM: harbors } as never);
});
afterEach(() => vi.useRealTimers());

describe("the clock out of a fight", () => {
  it("counts each round as it falls due while something is running out, and sets no alarm once nothing is", async () => {
    const code = await createZoneRow(db, "ann", zoneOptions({ size: "small", biome: "meadow", groups: 1, kinds: ["wolf"], elevation: 0, obstacles: 0, clear: 3, party: 1 }), "clock");
    const ws = new FakeSocket();
    serveNext(ws);
    expect((await zone.fetch({ headers: new Headers({ Upgrade: "websocket", "x-zone-code": code, "x-player-id": "ann" }) } as never)).status).toBe(101);
    // Nothing running out yet: no alarm.
    expect(alarm).toBeNull();
    // Oil poured where Ann stands (the dev toolbox's paint): it wears a round at a time.
    const at = ws.state.units.find((u) => u.id === "ann")!.pos;
    const key = `${at.q},${at.r}`;
    await zone.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: "action", action: { type: "dev", dev: { op: "paint", kind: "oil", hexes: [at] } } }));
    const rounds = ws.state.surfaces[key].rounds;
    expect(alarm).toBe(T0 + EXPLORE_ROUND_MS);
    // The round falls due: nobody acts, and still it is counted and everyone is shown it.
    vi.setSystemTime(T0 + EXPLORE_ROUND_MS);
    await zone.alarm();
    expect(ws.state.surfaces[key].rounds).toBe(rounds - 1);
    expect(alarm).toBe(T0 + 2 * EXPLORE_ROUND_MS);
    // Worn away: the clock stops.
    for (let n = 2; n <= rounds; n++) {
      vi.setSystemTime(T0 + n * EXPLORE_ROUND_MS);
      await zone.alarm();
    }
    expect(ws.state.surfaces[key]).toBeUndefined();
    expect(alarm).toBeNull();
  });
});
