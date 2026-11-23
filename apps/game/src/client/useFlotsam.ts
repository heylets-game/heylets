// The flotsam lying in the crew's Harbor right now (packages/world/src/flotsam.ts works it out from the crew and the
// clock), less what the crew has taken: handed to the renderer to draw bobbing on the water, and returned for
// the prompts. What was taken is asked of the server as the Harbor opens and with each new tide, and the room says
// at once when somebody takes a piece (`gone`). Looked at every second; a new list only when it has changed.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FLOTSAM_TIDE_MS, JUNK, flotsamAt, type Flotsam } from "@gantt-quest/world";
import { api } from "./api";
import type { WorldRenderer } from "./render/WorldRenderer";

const LOOK_MS = 1000;

/**
 * @param gone pieces the room has said were taken since it last connected
 * @param sync goes up with every new connection to the room: what was taken is asked for again
 */
export function useFlotsam(world: RefObject<WorldRenderer | null>, crewId: string | undefined, on: boolean, gone: readonly string[], sync: number): { pieces: Flotsam[]; took(id: string): void } {
  const [tide, setTide] = useState(() => Math.floor(Date.now() / FLOTSAM_TIDE_MS));
  const [taken, setTaken] = useState<string[]>([]);
  // A new tide every so often, looked for once a second.
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setTide(Math.floor(Date.now() / FLOTSAM_TIDE_MS)), LOOK_MS);
    return () => clearInterval(t);
  }, [on]);
  // What the crew has taken of this tide, as the Harbor opens, with each new tide, and on a new connection.
  useEffect(() => {
    if (!crewId || !on) return;
    let live = true;
    api.flotsam().then((r) => live && setTaken(r.taken), () => undefined);
    return () => {
      live = false;
    };
  }, [crewId, on, tide, sync]);
  const pieces = useMemo(() => {
    if (!crewId || !on) return [];
    const out = new Set([...taken, ...gone]);
    return flotsamAt(crewId, tide * FLOTSAM_TIDE_MS).filter((f) => !out.has(f.id));
  }, [crewId, on, tide, taken, gone]);
  // Told to the renderer whenever the list changes, and again to a new renderer (it may not be there yet).
  const told = useRef<{ to: WorldRenderer | null; pieces: Flotsam[] | null }>({ to: null, pieces: null });
  useEffect(() => {
    const tell = () => {
      const to = world.current;
      if (!to || (told.current.to === to && told.current.pieces === pieces)) return;
      told.current = { to, pieces };
      to.setFlotsam(pieces.map(({ id, pos, kind, junk }) => ({ id, pos, kind, ...(kind === "junk" ? { look: JUNK[junk ?? 0].look } : {}) })));
    };
    tell();
    const t = setInterval(tell, LOOK_MS);
    return () => clearInterval(t);
  }, [pieces, world]);
  useEffect(
    () => () => {
      world.current?.setFlotsam([]);
      told.current = { to: null, pieces: null };
    },
    [world],
  );
  return { pieces, took: (id: string) => setTaken((t) => (t.includes(id) ? t : [...t, id])) };
}
