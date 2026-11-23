// The pub's regulars where they are now (packages/world/src/wander.ts works it out from the clock), for a view that
// draws them: the Harbor by day, the pub by night. Looked at a few times a second; each hex they step onto is
// handed to the renderer as a walk of one step, at their strolling pace, so they are seen to walk, not slide.
//
// `hold`: a regular you are walking up to, or talking to, waits where they are for you (in this browser only),
// and picks up their day where it has got to once you are done.

import { useEffect, useRef, useState, type RefObject } from "react";
import { hexDistance, type HexPos } from "@gantt-quest/core";
import { WANDER_STEP_MS, regularsAbout, regular as regularById, type RegularAbout, type RegularId, type Regular } from "@gantt-quest/world";
import type { RenderHero, WorldRenderer } from "./render/WorldRenderer";

/** How often where they are is looked at, in ms: well inside a step, so each is handed on as it starts. */
const LOOK_MS = 200;
/** A hero crosses a hex (√3 world units) at 4.2 units a second; a regular takes WANDER_STEP_MS over one. */
const PACE = Math.sqrt(3) / (4.2 * (WANDER_STEP_MS / 1000));

/** A regular's unit id in a scene. */
export const regularUnit = (id: string) => `regular:${id}`;

export function useRegularsAbout(world: RefObject<WorldRenderer | null>, crewId: string | undefined, place: "harbor" | "pub", hold: RegularId | null, on: boolean): RegularAbout[] {
  const [about, setAbout] = useState<RegularAbout[]>([]);
  const last = useRef(new Map<RegularId, RegularAbout>());
  const held = useRef(hold);
  held.current = hold;

  useEffect(() => {
    if (!crewId || !on) {
      last.current.clear();
      setAbout([]);
      return;
    }
    const look = () => {
      const now = Date.now();
      const next: RegularAbout[] = [];
      let changed = false;
      for (const r of regularsAbout(crewId, now)) {
        const was = last.current.get(r.id);
        // Waiting for you where they stood.
        const here = r.id === held.current && was ? { ...was, walking: false } : r;
        if (here.place !== place) {
          if (was) changed = true;
          last.current.delete(r.id);
          continue;
        }
        next.push(here);
        if (!was || was.pos.q !== here.pos.q || was.pos.r !== here.pos.r) {
          changed = true;
          // A step from where they were: walked, at their pace. Just come into view, or far along their way after
          // waiting for you (a straight walk there would cut through whatever stands between), they are simply there.
          if (was && was.place === here.place && hexDistance(was.pos, here.pos) <= 2) world.current?.playEvents([{ t: "moved", heroId: regularUnit(r.id), path: [here.pos] }]);
        }
        last.current.set(r.id, here);
      }
      if (changed) setAbout(next);
    };
    look();
    const t = setInterval(look, LOOK_MS);
    return () => clearInterval(t);
  }, [crewId, place, on, world]);

  return about;
}

/**
 * The regular a click or a pointer on a hex means: whoever stands there, or whoever is walking off it (their spot
 * is the hex they are stepping onto, while they are still drawn on the one before).
 */
export function regularOn(about: RegularAbout[], hex: HexPos): RegularAbout | undefined {
  return about.find((r) => r.pos.q === hex.q && r.pos.r === hex.r) ?? about.find((r) => r.walking && hexDistance(r.pos, hex) === 1);
}

/** How a regular out and about is drawn: their look and name, at their stroll. */
export function regularHero(r: RegularAbout): RenderHero {
  const who = regularById(r.id) as Regular;
  return { id: regularUnit(r.id), classId: who.look, pos: r.pos, label: who.name, pace: PACE };
}
