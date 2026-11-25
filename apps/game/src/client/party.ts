import { useSyncExternalStore } from "react";

// Which of the party this tab is acting as: the party member selected (on a
// map, ZoneView; in town, the party strip), or none, which is the hero this
// device plays (its hero cookie). Every request names it (api.ts, the
// x-gq-hero header), so the hero sheet, the bag and everything else the
// hotkeys open are that hero's, and App reads /api/me again whenever it
// changes.
//
// A room's socket does not name it: the Harbor and a map are always joined as
// the hero this device plays, and in town that one figure walks for the whole
// party. On a map that one connection carries every member of it
// (server/zone-room.ts). Menus already open follow the selection: each is
// drawn for `me`, which App reads again, and is keyed on whose it is.

let acting: string | null = null;
const heard = new Set<() => void>();

/** The party member this tab is acting as, or null for the hero this device plays. */
export function actingHero(): string | null {
  return acting;
}

/** Act as another party member (null: the hero this device plays). Tells whoever listens, if it changed. */
export function actAs(id: string | null): void {
  if (id === acting) return;
  acting = id;
  for (const fn of heard) fn();
}

/** Hear when the hero acted as changes. Returns the way to stop. */
export function onActing(fn: () => void): () => void {
  heard.add(fn);
  return () => void heard.delete(fn);
}

/** The party member this tab is acting as, as a React value (null: the hero this device plays). */
export function useActingHero(): string | null {
  return useSyncExternalStore(onActing, actingHero);
}
