// The bridge between the dev toolbox and the zone on screen. The toolbox
// sits beside every view and knows nothing of what is open; a zone, while
// it is open, registers itself here so the toolbox's Maps tab can send it
// dev actions and arm a tool that takes its next clicks on the map (place
// a group, paint a surface).

import { useSyncExternalStore } from "react";
import type { DevOp, SurfaceKind } from "@gantt-quest/world";

/** A tool that takes clicks on the map until it is put down. `pick`: the next click on a unit of that side picks it (`picked`), and puts the tool down. */
export type ZoneDevTool = { tool: "spawn"; kinds: string[] } | { tool: "paint"; surface: SurfaceKind | null; wide: boolean } | { tool: "pick"; side: "hero" | "enemy" };

export interface ZoneDevState {
  /** The zone on screen, if there is one. */
  open: { code: string; seed?: string; send(op: DevOp): void } | null;
  tool: ZoneDevTool | null;
  /** The heroes on the map that are yours to play (yourself, and stand-ins), for the Maps tab to change. */
  heroes: KitHero[];
  /** The map's dev switches as they stand, for the Maps tab's checkboxes. */
  flags: ZoneDevFlags;
  /** Everyone standing on the map that you can see, for the Combat section to pick from. */
  units: DevUnit[];
  /** The unit last picked (the `pick` tool, or from a list), by id: drawn ringed on the map. */
  picked: string | null;
}

export interface DevUnit {
  id: string;
  name: string;
  side: "hero" | "enemy";
  /** Its abilities, by id. */
  abilities: string[];
}

export interface ZoneDevFlags {
  aiOff: boolean;
  undying: boolean;
  timerOff: boolean;
}

const NO_FLAGS: ZoneDevFlags = { aiOff: false, undying: false, timerOff: false };

export interface KitHero {
  id: string;
  name: string;
  classId: string;
  level: number;
  /** The weapon in hand, by id, if it is one of the class weapons. */
  weapon?: string;
  abilities: string[];
}

let state: ZoneDevState = { open: null, tool: null, heroes: [], flags: NO_FLAGS, units: [], picked: null };
const listeners = new Set<() => void>();

export function setZoneDev(next: Partial<ZoneDevState>): void {
  state = { ...state, ...next };
  for (const tell of listeners) tell();
}

// Escape puts an armed tool down rather than opening the game's menu. Listened for as this module loads, ahead of
// the menu's own listener on the same target, so stopping it here keeps the menu shut.
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !state.tool) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setZoneDev({ tool: null });
    },
    true,
  );
}

export function useZoneDev(): ZoneDevState {
  return useSyncExternalStore(
    (tell) => {
      listeners.add(tell);
      return () => listeners.delete(tell);
    },
    () => state,
  );
}
