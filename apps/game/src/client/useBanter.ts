// The townsfolk talking among themselves (packages/world/src/banter.ts says who and what, from the clock): each
// line hung in a bubble over its speaker's head as its moment comes, the two turned to each other while they talk
// and let go after. Everyone in a crew sees the same exchange at the same time. What the crew has been up to (the
// server's gossip, /api/gossip) is fetched as it starts and every few minutes after, for them to talk about too.
//
// `busy`: units a player here is talking to, or walking up to: they are left out (their bubbles would be hidden, and
// turning them would fight the conversation's own turn).

import { useEffect, useRef, useState, type RefObject } from "react";
import { BANTER_GAP_MS, BANTER_SLOT_MS, banterAt, banterPair, type BanterLine, type Gossip } from "@gantt-quest/world";
import { api } from "./api";
import type { WorldRenderer } from "./render/WorldRenderer";

/** How often the clock is looked at for the next line, in ms. */
const LOOK_MS = 300;
/** How often the crew's gossip is asked for again, in ms. */
const GOSSIP_MS = 5 * 60_000;

export function useBanter(world: RefObject<WorldRenderer | null>, crewId: string | undefined, place: "pub" | "harbor", on: boolean, busy: (string | null | undefined)[]) {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [gossip, setGossip] = useState<Gossip[]>([]);

  useEffect(() => {
    if (!crewId || !on) return;
    let live = true;
    // (Kept as it was when nothing has changed, so what is being said is not started over.)
    const fetchIt = () => void api.gossip().then((r) => live && setGossip((was) => (JSON.stringify(was) === JSON.stringify(r.gossip) ? was : r.gossip)), () => undefined);
    fetchIt();
    const t = setInterval(fetchIt, GOSSIP_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [crewId, on]);

  useEffect(() => {
    if (!crewId || !on) return;
    /** Lines already said, by when they were due, so each is said once. */
    const said = new Set<number>();
    /** The pair turned to each other now, and when to let them go. */
    let turned: { pair: [string, string]; until: number } | null = null;
    const letGo = () => {
      if (!turned) return;
      for (const unit of turned.pair) world.current?.turnUnit(unit, null);
      turned = null;
    };
    /** The slot's exchange, worked out once a slot. */
    let slot: { n: number; lines: BanterLine[] | null } | null = null;
    const look = () => {
      const r = world.current;
      if (!r) return;
      const now = Date.now();
      if (turned && now >= turned.until) letGo();
      const n = Math.floor(now / BANTER_SLOT_MS);
      if (slot?.n !== n) slot = { n, lines: banterAt(crewId, place, now, gossip) };
      const lines = slot.lines;
      const pair = lines ? banterPair(lines) : null;
      if (!lines || !pair) return;
      // Someone in it is busy with a player here: the exchange is not heard here (they are elsewhere in their head).
      if (pair.some((u) => busyRef.current.includes(u))) return;
      for (const line of lines) {
        // Due now (or within the last moment: a line missed by more than a gap is not said late).
        if (line.at > now || now - line.at > BANTER_GAP_MS || said.has(line.at)) continue;
        said.add(line.at);
        r.say(line.unit, line.text);
        if (!turned) {
          const [a, b] = pair;
          const pa = r.unitSpot(a);
          const pb = r.unitSpot(b);
          if (pa && pb) {
            r.turnUnit(a, { x: pb.x, z: pb.z });
            r.turnUnit(b, { x: pa.x, z: pa.z });
            turned = { pair, until: lines[lines.length - 1].at + BANTER_GAP_MS };
          }
        }
      }
      if (said.size > 64) said.clear();
    };
    look();
    const t = setInterval(look, LOOK_MS);
    return () => {
      clearInterval(t);
      letGo();
    };
  }, [world, crewId, place, on, gossip]);
}
