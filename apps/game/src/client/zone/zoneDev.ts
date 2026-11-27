// The bridge between the dev toolbox and the zone on screen. The toolbox
// sits beside every view and knows nothing of what is open; a zone, while
// it is open, registers itself here so the toolbox's Maps tab can send it
// dev actions and arm a tool that takes its next clicks on the map (place
// a group, paint a surface).

import { useSyncExternalStore } from "react";
import type { DevOp, SurfaceKind } from "@gantt-quest/world";

/**
 * A tool that takes clicks on the map until it is put down. `place`: each click puts the one being played straight on that hex (the enemy
 * picked, in the sandbox, if there is one). `strike`: the combat sandbox's enemy ability, armed: the next click aims it.
 */
export type ZoneDevTool = { tool: "spawn"; kinds: string[]; level?: number } | { tool: "paint"; surface: SurfaceKind | null; wide: boolean } | { tool: "place" } | { tool: "strike"; unit: string; ability: string };

export interface ZoneDevState {
  /** The zone on screen, if there is one. */
  open: { code: string; seed?: string; send(op: DevOp): void } | null;
  tool: ZoneDevTool | null;
  /** The heroes on the map that are yours to play (yourself, and stand-ins), for the Maps tab to change. */
  heroes: KitHero[];
  /** The map's dev switches as they stand, for the Maps tab's checkboxes. */
  flags: ZoneDevFlags;
  /** In the combat sandbox, the enemy being played (clicked on the map), by id: drawn ringed on the map. */
  picked: string | null;
  /** The sandbox's enemy abilities reach anywhere: no range or line of sight asked. */
  anywhere: boolean;
  /** The camera never moves of itself (WorldRenderer.setStill). This viewer's alone, and remembered on this device (setCameraStill). */
  cameraStill: boolean;
}


export interface ZoneDevFlags {
  aiOff: boolean;
  undying: boolean;
  timerOff: boolean;
  heroesIdle: boolean;
  sandbox: boolean;
}

export const NO_FLAGS: ZoneDevFlags = { aiOff: false, undying: false, timerOff: false, heroesIdle: false, sandbox: false };

export interface KitHero {
  id: string;
  name: string;
  classId: string;
  level: number;
  /** The weapon in hand, by id, if it is one of the class weapons. */
  weapon?: string;
  abilities: string[];
}

const STILL_KEY = "gq.dev.cameraStill";
const recallStill = (): boolean => {
  try {
    return localStorage.getItem(STILL_KEY) === "1";
  } catch {
    return false;
  }
};

let state: ZoneDevState = { open: null, tool: null, heroes: [], flags: NO_FLAGS, picked: null, anywhere: false, cameraStill: recallStill() };
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

/** Turn the camera that never moves of itself on or off, and remember it on this device. */
export function setCameraStill(on: boolean): void {
  try {
    if (on) localStorage.setItem(STILL_KEY, "1");
    else localStorage.removeItem(STILL_KEY);
  } catch {
    // Blocked storage: it lasts until the page is closed.
  }
  setZoneDev({ cameraStill: on });
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
