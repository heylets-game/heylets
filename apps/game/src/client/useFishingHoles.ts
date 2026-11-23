// The crew's fishing holes as they are now (packages/world/src/fishingholes.ts works them out from the crew and the
// clock), for the Harbor: handed to the renderer to draw on the water, and returned for the prompts. Looked at every
// second; a new list only when a hole has moved or turned, so nothing re-renders for nothing.

import { useEffect, useState, type RefObject } from "react";
import { fishingHoles, type FishingHole } from "@gantt-quest/world";
import type { WorldRenderer } from "./render/WorldRenderer";

const LOOK_MS = 1000;

export function useFishingHoles(world: RefObject<WorldRenderer | null>, crewId: string | undefined, on: boolean): FishingHole[] {
  const [holes, setHoles] = useState<FishingHole[]>([]);
  useEffect(() => {
    if (!crewId || !on) {
      setHoles([]);
      world.current?.setFishingHoles([]);
      return;
    }
    let shown = "";
    // The renderer told last (it may not be there yet, or be a new one): a new one is told again.
    let told: WorldRenderer | null = null;
    const look = () => {
      const now = fishingHoles(crewId, Date.now());
      const key = now.map((h) => h.id).join(" ");
      if (key !== shown) {
        shown = key;
        setHoles(now);
      } else if (told === world.current) return;
      told = world.current;
      told?.setFishingHoles(now.map(({ id, pos, kind }) => ({ id, pos, kind })));
    };
    look();
    const t = setInterval(look, LOOK_MS);
    return () => {
      clearInterval(t);
      world.current?.setFishingHoles([]);
    };
  }, [crewId, on, world]);
  return holes;
}
