// "Hold to confirm in fights": on a touch screen, a quick tap on a hex in a
// fight only shows where it would take you, and holding a finger still on it
// for a moment is what moves or acts. So the map can be dragged about without
// a stray tap walking your hero off. Off until chosen; remembered on this device.

const KEY = "gq.holdTap";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let current = read();
const listeners = new Set<() => void>();

export const holdTap = {
  get: () => current,
  set(next: boolean) {
    if (next === current) return;
    current = next;
    try {
      if (next) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {
      // Private windows and blocked storage: the setting lasts until the page closes.
    }
    for (const fn of listeners) fn();
  },
  /** Calls `fn` whenever the setting changes; returns the way to stop. */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Whether this device has a touch screen, for offering the setting at all. */
export function touchScreen(): boolean {
  try {
    return navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
