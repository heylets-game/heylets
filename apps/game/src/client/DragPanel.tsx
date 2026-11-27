// A HUD panel. Most are set in place and only fold down to their title; a
// `resizable` one (the big windows) can also be dragged about and resized.
//
// With a mouse, drag from any part of the panel that is not a control. On
// touch, drag from the grip in the corner, so swiping inside a panel still
// scrolls it. Double-click (or double-tap) the grip to put the panel back.
// Each panel remembers where it was left, per browser.
//
// Every panel also has a minimize button that folds it down to its title.
// The larger ones start folded on a phone so they do not cover the map.
//
// A `movable` one (the place chats) can be dragged about but not resized: by
// its title strip or its grip only, so a drag inside it still selects its
// words and scrolls them. Double-click the grip to put it back.
//
// A `resizable` panel also has a handle in each corner. Dragging one changes
// the panel's size while the opposite corner stays put; double-click a
// handle to go back to the default size.
//
// The title and tools sit outside `.panel-body`. A panel whose content can
// run long scrolls only its body (see styles.css), so they stay at the top.
//
// The offset is applied with the CSS `translate` property, which stacks with
// whatever `transform` the panel's own styles use for centring. The view the
// panel sits in may be zoomed (the UI scale in Options), so pointer movement,
// which is in screen pixels, is divided by that zoom before it is applied.
//
// Options can also put every panel back as it started: `resetPanels()`.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { onUiScaleChange, uiZoom } from "./uiScale";

interface Offset {
  x: number;
  y: number;
}

const ZERO: Offset = { x: 0, y: 0 };
const INTERACTIVE = "button, input, select, textarea, a, label, [data-nodrag]";
/** Pixels of movement before a press becomes a drag. */
const THRESHOLD = 5;
/** How much of a panel must stay on screen. */
const KEEP = 48;

const PREFIX = "gq.panel.";
const storageKey = (id: string) => `${PREFIX}${id}`;

const resetListeners = new Set<() => void>();

/**
 * Forget where every panel was left, its size and whether it was minimized,
 * and put the open ones back as they start. Panels not on screen pick up
 * their defaults the next time they are shown.
 */
export function resetPanels() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // Nothing remembered to forget.
  }
  for (const fn of resetListeners) fn();
}

interface Size {
  w: number;
  h: number;
}

/** Smallest a panel may be resized to. */
const MIN_SIZE: Size = { w: 300, h: 240 };
const CORNERS = [
  { name: "nw", sx: -1, sy: -1 },
  { name: "ne", sx: 1, sy: -1 },
  { name: "sw", sx: -1, sy: 1 },
  { name: "se", sx: 1, sy: 1 },
] as const;

function loadSize(id: string): Size | null {
  try {
    const raw = JSON.parse(localStorage.getItem(`${storageKey(id)}.size`) ?? "null") as Size | null;
    if (!raw || !Number.isFinite(raw.w) || !Number.isFinite(raw.h)) return null;
    // A size saved on a bigger screen (or at a smaller UI scale) is trimmed to fit this one.
    const z = uiZoom();
    return { w: Math.min(raw.w, innerWidth / z), h: Math.min(raw.h, innerHeight / z) };
  } catch {
    return null;
  }
}

function saveSize(id: string, size: Size | null) {
  try {
    if (size) localStorage.setItem(`${storageKey(id)}.size`, JSON.stringify(size));
    else localStorage.removeItem(`${storageKey(id)}.size`);
  } catch {
    // Not remembered.
  }
}

function load(id: string): Offset {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(id)) ?? "null") as Offset | null;
    return raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? raw : ZERO;
  } catch {
    return ZERO;
  }
}

function save(id: string, offset: Offset) {
  try {
    if (offset.x === 0 && offset.y === 0) localStorage.removeItem(storageKey(id));
    else localStorage.setItem(storageKey(id), JSON.stringify(offset));
  } catch {
    // Storage unavailable (private mode): the panel just will not remember.
  }
}

/**
 * Follow a press on a panel as a move, once it has gone past THRESHOLD: `set` is given each new offset (from
 * `from`, in the panel's own zoomed pixels) and `done` the last, on release. A strip of the panel stays on screen.
 */
function startMove(e: ReactPointerEvent<HTMLElement>, panel: HTMLElement, from: Offset, set: (o: Offset) => void, dragging: (on: boolean) => void, done: (o: Offset) => void) {
  const start = { x: e.clientX, y: e.clientY };
  const rect = panel.getBoundingClientRect();
  const z = uiZoom();
  let moved = false;
  // Tracked here as well as in state, so the release saves the final position even if React has not re-rendered yet.
  let latest = from;

  const move = (ev: PointerEvent) => {
    let dx = ev.clientX - start.x;
    let dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < THRESHOLD) return;
    moved = true;
    dragging(true);
    // Keep a strip of the panel on screen so it can always be grabbed again.
    dx = Math.max(KEEP - rect.right, Math.min(innerWidth - KEEP - rect.left, dx));
    dy = Math.max(-rect.top, Math.min(innerHeight - KEEP - rect.top, dy));
    latest = { x: Math.round(from.x + dx / z), y: Math.round(from.y + dy / z) };
    set(latest);
  };
  const up = () => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    if (!moved) return;
    dragging(false);
    done(latest);
    // The release would otherwise count as a click on whatever is under it.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

/**
 * A window of its own make (not a DragPanel: the sea bag) that can be dragged about, and remembers where it was
 * left, as a DragPanel does. `grab` says whether a press on `target` picks the window up; one on a control never
 * does. Double-clicking where it is grabbed puts it back. Spread `bind` on the window.
 *
 * `keep` holds something in it where it is on screen while the window changes shape around it (the bag's buttons,
 * as it is minimized): call `keep.before(thing)` just before the change. That shift is for as long as the window
 * is shown, and is never remembered as where it was left.
 */
export function useMovable<T extends HTMLElement>(id: string, grab: (target: HTMLElement, panel: T) => boolean) {
  const el = useRef<T>(null);
  /** Where it was left, as remembered. */
  const [offset, setOffset] = useState<Offset>(() => load(id));
  /** Added to that while it is shown, to keep something in it in place as it changes shape. */
  const [shift, setShift] = useState<Offset>(ZERO);
  const [dragging, setDragging] = useState(false);
  const at = { x: offset.x + shift.x, y: offset.y + shift.y };
  const live = useRef(at);
  live.current = at;
  const shiftNow = useRef(shift);
  shiftNow.current = shift;
  const held = useRef<{ thing: HTMLElement; x: number; y: number } | null>(null);
  const reset = useCallback(() => {
    setOffset(ZERO);
    setShift(ZERO);
    save(id, ZERO);
  }, [id]);
  // Out of reach on a smaller screen than it was left on: back where it starts. And back with every panel, from Options.
  useEffect(() => {
    const check = () => {
      const r = el.current?.getBoundingClientRect();
      if (!r || (live.current.x === 0 && live.current.y === 0)) return;
      if (r.right < KEEP || r.left > innerWidth - KEEP || r.bottom < KEEP || r.top > innerHeight - KEEP) reset();
    };
    check();
    addEventListener("resize", check);
    const stop = onUiScaleChange(() => requestAnimationFrame(check));
    const back = () => (setOffset(ZERO), setShift(ZERO));
    resetListeners.add(back);
    return () => {
      removeEventListener("resize", check);
      stop();
      resetListeners.delete(back);
    };
  }, [reset]);
  // After the change `keep.before` was told of: whatever it named is put back where it was, before it is painted.
  useLayoutEffect(() => {
    const h = held.current;
    if (!h) return;
    held.current = null;
    const r = h.thing.getBoundingClientRect();
    const box = el.current?.getBoundingClientRect();
    const z = uiZoom();
    let sx = h.x - r.left;
    let sy = h.y - r.top;
    // But the window, grown, stays on the screen (its top-left corner first, where it is too big for it).
    if (box) {
      sx = Math.max(Math.min(sx, innerWidth - box.right), -box.left);
      sy = Math.max(Math.min(sy, innerHeight - box.bottom), -box.top);
    }
    const dx = sx / z;
    const dy = sy / z;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setShift((s) => ({ x: Math.round(s.x + dx), y: Math.round(s.y + dy) }));
  });
  const grabbed = (e: { target: EventTarget }) => {
    const target = e.target as HTMLElement;
    return !!el.current && !target.closest(INTERACTIVE) && grab(target, el.current);
  };
  /** A move sets where it is shown; what is remembered is that less the shift. */
  const moveTo = (o: Offset) => setOffset({ x: o.x - shiftNow.current.x, y: o.y - shiftNow.current.y });
  return {
    dragging,
    keep: {
      before(thing: HTMLElement | null) {
        const r = thing?.getBoundingClientRect();
        held.current = thing && r ? { thing, x: r.left, y: r.top } : null;
      },
    },
    bind: {
      ref: el,
      // No offset, no translate: one would make the window the frame of anything fixed inside it (the bag's card, on a phone).
      style: (at.x || at.y ? { translate: `${at.x}px ${at.y}px` } : {}) as CSSProperties,
      onPointerDown: (e: ReactPointerEvent<T>) => {
        if (e.button !== 0 || !grabbed(e)) return;
        startMove(e, el.current!, live.current, moveTo, setDragging, (o) => save(id, { x: o.x - shiftNow.current.x, y: o.y - shiftNow.current.y }));
      },
      onDoubleClick: (e: ReactMouseEvent<T>) => {
        if (grabbed(e)) reset();
      },
    },
  };
}

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** Stable name used to remember this panel's position. */
  id: string;
  /** Names the panel. Shown when it is minimized, and as its header unless `compact`. */
  title: string;
  /** A slim bar with no room for a header: the title only appears once minimized. */
  compact?: boolean;
  /** Give the panel a resize handle in each corner. It can be dragged about too. */
  resizable?: boolean;
  /** Let the panel be dragged about (by its title strip or its grip), without resizing it. Where it is left is remembered. */
  movable?: boolean;
  /** Start folded on narrow screens. The player's own choice, once made, wins. */
  foldOnPhone?: boolean;
  /** Let the panel be dragged taller or shorter by its top edge (the chat, which sits on the bottom of the view). The height is remembered. */
  expandable?: boolean;
  /** Start folded everywhere, until the player unfolds it once. */
  startFolded?: boolean;
  /** Change this number to unfold the panel from outside (it does not change the remembered choice). */
  unfold?: number;
  children: ReactNode;
}

/** A phone, held either way: narrow, or (on its side) short. The stylesheets say the same. */
const isPhone = () => typeof matchMedia === "function" && matchMedia("(max-width: 760px), (max-height: 520px)").matches;

function loadFolded(id: string, foldOnPhone: boolean, startFolded = false): boolean {
  try {
    const raw = localStorage.getItem(`${storageKey(id)}.folded`);
    if (raw !== null) return raw === "1";
  } catch {
    // Fall through to the default.
  }
  return startFolded || (foldOnPhone && isPhone());
}

export function DragPanel({ id, title, compact = false, resizable = false, movable = false, expandable = false, foldOnPhone = false, startFolded = false, unfold = 0, className = "", children, style, ...rest }: Props) {
  const [size, setSize] = useState<Size | null>(() => (resizable ? loadSize(id) : null));
  /** While a corner is being dragged: where the opposite corner must stay. */
  const pin = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const [folded, setFolded] = useState(() => loadFolded(id, foldOnPhone, startFolded));
  const toggle = () => {
    setFolded((f) => {
      try {
        localStorage.setItem(`${storageKey(id)}.folded`, f ? "0" : "1");
      } catch {
        // Not remembered, but still toggles.
      }
      return !f;
    });
  };
  useEffect(() => {
    if (unfold) setFolded(false);
  }, [unfold]);
  /** How tall the player has dragged the panel's lines, in CSS pixels; null for the stylesheet's own height. */
  const [tall, setTall] = useState<number | null>(() => {
    try {
      const n = Number(localStorage.getItem(`${storageKey(id)}.tall`));
      return expandable && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
  // What sits above the panel (the crew's cards) makes room for it: the stylesheet reads the height from the page.
  useEffect(() => {
    if (!expandable) return;
    const root = document.documentElement.style;
    if (tall && !folded) root.setProperty("--chat-tall", `${tall}px`);
    else if (folded) root.setProperty("--chat-tall", "0px");
    else root.removeProperty("--chat-tall");
    return () => {
      root.removeProperty("--chat-tall");
    };
  }, [expandable, tall, folded]);
  const el = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<Offset>(() => load(id));
  const [dragging, setDragging] = useState(false);
  const live = useRef(offset);
  live.current = offset;

  const reset = useCallback(() => {
    setOffset(ZERO);
    save(id, ZERO);
  }, [id]);

  // A position saved on a bigger screen can leave the panel out of reach on a smaller one.
  useEffect(() => {
    const check = () => {
      const r = el.current?.getBoundingClientRect();
      if (!r || (live.current.x === 0 && live.current.y === 0)) return;
      if (r.right < KEEP || r.left > innerWidth - KEEP || r.bottom < KEEP || r.top > innerHeight - KEEP) reset();
    };
    check();
    addEventListener("resize", check);
    const stop = onUiScaleChange(() => requestAnimationFrame(check));
    return () => {
      removeEventListener("resize", check);
      stop();
    };
  }, [reset]);

  // Options asked for every panel to go back as it started.
  useEffect(() => {
    const back = () => {
      pin.current = null;
      setOffset(ZERO);
      setSize(null);
      setFolded(loadFolded(id, foldOnPhone, startFolded));
      setTall(null);
    };
    resetListeners.add(back);
    return () => {
      resetListeners.delete(back);
    };
  }, [id, foldOnPhone, startFolded]);

  // The panel may be centred by its parent, so growing it would move both edges.
  // After each size change, shift the panel so the pinned corner is back where it was.
  useLayoutEffect(() => {
    const p = pin.current;
    const r = el.current?.getBoundingClientRect();
    if (!p || !r) return;
    const z = uiZoom();
    const dx = (p.x - (p.sx > 0 ? r.left : r.right)) / z;
    const dy = (p.y - (p.sy > 0 ? r.top : r.bottom)) / z;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setOffset((o) => ({ x: Math.round(o.x + dx), y: Math.round(o.y + dy) }));
  });

  const startResize = (sx: number, sy: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !el.current) return;
    e.stopPropagation();
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const rect = el.current.getBoundingClientRect();
    pin.current = { sx, sy, x: sx > 0 ? rect.left : rect.right, y: sy > 0 ? rect.top : rect.bottom };
    // Measured on screen, applied in the panel's own (zoomed) pixels.
    const z = uiZoom();
    let latest: Size = { w: rect.width / z, h: rect.height / z };
    setDragging(true);

    const move = (ev: PointerEvent) => {
      // The dragged corner cannot pass the pinned one, nor leave the screen.
      const maxW = (sx > 0 ? innerWidth - rect.left : rect.right) / z;
      const maxH = (sy > 0 ? innerHeight - rect.top : rect.bottom) / z;
      latest = {
        w: Math.round(Math.max(Math.min(MIN_SIZE.w, maxW), Math.min(maxW, (rect.width + sx * (ev.clientX - start.x)) / z))),
        h: Math.round(Math.max(Math.min(MIN_SIZE.h, maxH), Math.min(maxH, (rect.height + sy * (ev.clientY - start.y)) / z))),
      };
      setSize(latest);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      setDragging(false);
      saveSize(id, latest);
      // Let the last corner correction land before saving where the panel ended up.
      setTimeout(() => {
        pin.current = null;
        save(id, live.current);
      }, 60);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };

  const saveTall = (n: number | null) => {
    setTall(n);
    try {
      if (n) localStorage.setItem(`${storageKey(id)}.tall`, String(n));
      else localStorage.removeItem(`${storageKey(id)}.tall`);
    } catch {
      // Not remembered.
    }
  };
  /** Drag the top edge: the panel sits on the bottom of the view, so up is taller. */
  const startTall = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !el.current) return;
    e.preventDefault();
    e.stopPropagation();
    const lines = el.current.querySelector<HTMLElement>(".chat-lines");
    const z = uiZoom();
    const from = (lines?.getBoundingClientRect().height ?? 110) / z;
    const startY = e.clientY;
    // Never taller than leaves the panel's top on screen, nor than a little under half the view.
    const max = Math.min(from + (el.current.getBoundingClientRect().top - 12) / z, (innerHeight * 0.45) / z);
    let latest = from;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      latest = Math.round(Math.max(48, Math.min(max, from + (startY - ev.clientY) / z)));
      setTall(latest);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
      setDragging(false);
      saveTall(latest);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
  };

  const resetSize = () => {
    pin.current = null;
    setSize(null);
    saveSize(id, null);
    reset();
  };

  /** It can be moved: a window, or a panel that says so. The docked panels stay where the layout puts them. */
  const moves = resizable || movable;
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!moves || e.button !== 0 || !el.current) return;
    const target = e.target as HTMLElement;
    if (target.closest(".resize")) return;
    const onGrip = !!target.closest(".grip");
    // A movable panel is picked up by its title strip as well (the click that would fold it is swallowed after a drag).
    const onTitle = movable && !resizable && !!target.closest(".panel-title");
    // Anywhere else only a window is picked up, and only with a mouse and off its controls.
    if (!onGrip && !onTitle && (!resizable || e.pointerType !== "mouse" || target.closest(INTERACTIVE))) return;
    startMove(e, el.current, live.current, setOffset, setDragging, (at) => save(id, at));
  };

  return (
    <div
      ref={el}
      {...rest}
      className={`${className} draggable ${dragging ? "dragging" : ""} ${folded ? "folded" : ""} ${resizable ? "resizable" : ""} ${movable ? "movable" : ""}`}
      style={{
        ...style,
        translate: moves ? `${offset.x}px ${offset.y}px` : undefined,
        ...(tall && !folded ? ({ "--tall": `${tall}px` } as CSSProperties) : {}),
        // A minimized panel shrinks to its title whatever size it was given.
        ...(size && !folded ? { width: size.w, height: size.h, maxWidth: "none", maxHeight: "none" } : {}),
      }}
      onPointerDown={onPointerDown}
    >
      {expandable && !folded && <span className="tall-handle" title="Drag to make it taller or shorter. Double-click for the usual height." onPointerDown={startTall} onDoubleClick={() => saveTall(null)} aria-hidden />}
      <span className="panel-tools">
        <button className="min-btn" aria-expanded={!folded} aria-label={folded ? `Show ${title}` : `Minimize ${title}`} title={folded ? "Show" : "Minimize"} onClick={toggle}>
          {folded ? "+" : "–"}
        </button>
        {moves && (
          <span className="grip" title="Drag to move. Double-click to put it back." onDoubleClick={reset} aria-hidden>
            ⠿
          </span>
        )}
      </span>
      {(folded || !compact) && (
        <button className="panel-title" tabIndex={-1} onClick={toggle}>
          {title}
        </button>
      )}
      {/* The panel's own content. Long panels scroll this, not the whole frame, so the title and tools stay put. */}
      <div className="panel-body">{children}</div>
      {resizable &&
        !folded &&
        CORNERS.map((c) => (
          <span
            key={c.name}
            className={`resize ${c.name}`}
            title="Drag to resize. Double-click for the default size."
            onPointerDown={startResize(c.sx, c.sy)}
            onDoubleClick={resetSize}
            aria-hidden
          />
        ))}
    </div>
  );
}
