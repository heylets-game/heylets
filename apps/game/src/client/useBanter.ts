// The townsfolk talking among themselves (packages/world/src/banter.ts says who and what, from the clock): each
// line hung in a bubble over its speaker's head as its moment comes, the two turned to each other while they talk
// and let go after. Everyone in a crew sees the same exchange at the same time.
//
// `busy`: units a player here is talking to, or walking up to: they are left out (their bubbles would be hidden, and
// turning them would fight the conversation's own turn).

import { useEffect, useRef, type RefObject } from "react";
import { BANTER_GAP_MS, banterAt, banterPair } from "@gantt-quest/world";
import type { WorldRenderer } from "./render/WorldRenderer";

/** How often the clock is looked at for the next line, in ms. */
const LOOK_MS = 300;

export function useBanter(world: RefObject<WorldRenderer | null>, crewId: string | undefined, place: "pub" | "harbor", on: boolean, busy: (string | null | undefined)[]) {
  const busyRef = useRef(busy);
  busyRef.current = busy;

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
    const look = () => {
      const r = world.current;
      if (!r) return;
      const now = Date.now();
      if (turned && now >= turned.until) letGo();
      const lines = banterAt(crewId, place, now);
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
  }, [world, crewId, place, on]);
}
