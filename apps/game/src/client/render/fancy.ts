import type * as THREE from "three";

// "Fancy graphics": the finishing pass
// (glow, tilt-shift blur, colour grade) and the water and weather that go with it. One setting for every view,
// remembered on this device. Off unless the player turns it on: it
// costs a phone some battery.

const KEY = "gq.graphics.fancy";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = read();
const listeners = new Set<() => void>();

export const fancy = {
  get: () => on,
  set(next: boolean) {
    if (next === on) return;
    on = next;
    try {
      if (on) localStorage.setItem(KEY, "1");
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

// "Fancy grass": the thick fields of blades (meadows, tall grass, dry patches) and the oaks' crowns of single
// leaves. Off, the open grass is a scatter of tufts and an oak's crown is a few faceted lumps, as the other
// trees are: far fewer triangles for a phone to draw. One setting for every view, remembered on this device.
// On unless the player turns it off.

const GRASS_KEY = "gq.graphics.grass";

function readGrass(): boolean {
  try {
    return localStorage.getItem(GRASS_KEY) !== "0";
  } catch {
    return true;
  }
}

let grassOn = readGrass();
const grassListeners = new Set<() => void>();

export const fancyGrass = {
  get: () => grassOn,
  set(next: boolean) {
    if (next === grassOn) return;
    grassOn = next;
    try {
      if (grassOn) localStorage.removeItem(GRASS_KEY);
      else localStorage.setItem(GRASS_KEY, "0");
    } catch {
      // Private windows and blocked storage: the setting lasts until the page closes.
    }
    for (const fn of grassListeners) fn();
  },
  /** Calls `fn` whenever the setting changes; returns the way to stop. */
  subscribe(fn: () => void): () => void {
    grassListeners.add(fn);
    return () => grassListeners.delete(fn);
  },
};

// "Outlines": the dark ink line round people, creatures, what they carry, buildings, and the things spells throw.
// One setting for every view, remembered on this device. Off unless the player turns it on. Every outline is still
// built, so turning them on or off shows or hides them at once, with nothing drawn again.

const OUTLINES_KEY = "gq.graphics.outlines";

function readOutlines(): boolean {
  try {
    return localStorage.getItem(OUTLINES_KEY) === "1";
  } catch {
    return false;
  }
}

let outlinesOn = readOutlines();
const outlineListeners = new Set<() => void>();
/** Every outline's material in use, held loosely: one that is let go of is forgotten. */
const inks = new Set<WeakRef<THREE.Material>>();

export const outlines = {
  get: () => outlinesOn,
  set(next: boolean) {
    if (next === outlinesOn) return;
    outlinesOn = next;
    try {
      if (outlinesOn) localStorage.setItem(OUTLINES_KEY, "1");
      else localStorage.removeItem(OUTLINES_KEY);
    } catch {
      // Private windows and blocked storage: the setting lasts until the page closes.
    }
    for (const ref of inks) {
      const material = ref.deref();
      if (material) material.visible = outlinesOn;
      else inks.delete(ref);
    }
    for (const fn of outlineListeners) fn();
  },
  /** Calls `fn` whenever the setting changes; returns the way to stop. */
  subscribe(fn: () => void): () => void {
    outlineListeners.add(fn);
    return () => outlineListeners.delete(fn);
  },
};

/** An outline's material: drawn only while outlines are on, and shown or hidden as the setting changes. */
export function inkLine<M extends THREE.Material>(material: M): M {
  material.visible = outlinesOn;
  const ref = new WeakRef<THREE.Material>(material);
  inks.add(ref);
  material.addEventListener("dispose", () => inks.delete(ref));
  return material;
}
