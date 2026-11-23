// Dragging a thing from one part of the screen onto another (loot onto the sea bag, an ability slot onto another,
// a lodestone into a place's slot on the atlas), the same way with a mouse and with a finger.
//
// The browser's own drag and drop is not used: a touch screen does not start it. Instead a press on a source is
// watched with pointer events. A mouse picks the thing up once it has moved a few pixels. A finger has to rest on it
// for a moment first (HOLD_MS), so that a finger that moves straight away scrolls the list it is in, as ever.
// Once picked up, a copy of its icon follows the pointer (above a fingertip, where it can be seen), whatever will
// take it lights up under it, and letting go there hands it over.
//
// A source spreads `dragSource(...)` onto its element. A target spreads what `useDropTarget(...)` gives it, on as
// many elements as share one handler (each is told which element it landed on).

import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { uiZoom } from "./uiScale";

/** What can be dragged. */
export type Dragged =
  | { kind: "loot"; index: number; uid?: number }
  | { kind: "slot"; index: number }
  | { kind: "lodestone"; key: string };

/** How long a finger rests on a thing before it is picked up. */
export const HOLD_MS = 300;
/** How far a press can travel and still be a tap (or, for a finger, still be resting): a fingertip wobbles more. */
const SLOP = { mouse: 6, touch: 10 };
/** How far above the fingertip a thing dragged by a finger rides, beyond half its height, in CSS pixels. */
const FINGER_LIFT = 30;

interface Target {
  accepts: (thing: Dragged, el: HTMLElement) => boolean;
  drop: (thing: Dragged, el: HTMLElement) => void;
}
const targets = new Map<string, Target>();

/**
 * The props that make an element (or several) somewhere to drop things. `accepts` says whether it takes this
 * thing; `drop` is told when one is let go over it. Both always see the latest render's values.
 */
export function useDropTarget(accepts: Target["accepts"], drop: Target["drop"]): { "data-drop": string } {
  const id = useId();
  const latest = useRef({ accepts, drop });
  latest.current = { accepts, drop };
  useEffect(() => {
    targets.set(id, { accepts: (t, el) => latest.current.accepts(t, el), drop: (t, el) => latest.current.drop(t, el) });
    return () => void targets.delete(id);
  }, [id]);
  return { "data-drop": id };
}

interface Options {
  /** Told when the thing comes up off its place, and when it is let go or put back (dropped or not). */
  onLift?: () => void;
  onEnd?: () => void;
}

/** The press now down on a source, if any: only one thing is dragged at a time. */
let active: {
  thing: Dragged;
  opts: Options;
  source: HTMLElement;
  touch: boolean;
  id: number;
  x: number;
  y: number;
  timer: number;
  lifted: boolean;
  /** Moved since it was picked up: a finger resting still that long may instead be asking for a menu. */
  moved: boolean;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
  /** Half the ghost's height plus the lift, in screen pixels: how far above a fingertip it rides. */
  rise: number;
} | null = null;

/** A finger holding a thing must not also scroll what it is in. */
function stopScroll(e: TouchEvent) {
  if (active?.lifted && e.cancelable) e.preventDefault();
}
/** Added once to each source: a touch is told to the element it began on, so only touches that start there pay for it. */
function sourceRef(el: HTMLElement | null) {
  el?.addEventListener("touchmove", stopScroll, { passive: false });
}

interface SourceProps {
  ref?: (el: HTMLElement | null) => void;
  "data-drag-source"?: "";
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
}

/** The props that make an element a thing that can be dragged. Off (no props at all) when `thing` is null. */
export function dragSource(thing: Dragged | null, opts: Options = {}): SourceProps {
  if (!thing) return {};
  return {
    ref: sourceRef,
    "data-drag-source": "",
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => press(e, thing, opts),
  };
}

function press(e: ReactPointerEvent<HTMLElement>, thing: Dragged, opts: Options) {
  if (active || (e.pointerType === "mouse" && (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey))) return;
  const touch = e.pointerType === "touch";
  active = { thing, opts, source: e.currentTarget, touch, id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0, lifted: false, moved: false, ghost: null, over: null, rise: 0 };
  if (touch) {
    const at = { clientX: e.clientX, clientY: e.clientY };
    active.timer = window.setTimeout(() => lift(at), HOLD_MS);
  }
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", key);
  addEventListener("contextmenu", menu, { capture: true });
  addEventListener("blur", cancel);
}

/** Pick the thing up: its icon comes up under (or above) the pointer. */
function lift(at: { clientX: number; clientY: number }) {
  const a = active;
  if (!a || a.lifted) return;
  a.lifted = true;
  const r = a.source.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  const icon = a.source.querySelector("img");
  if (icon) {
    const ir = icon.getBoundingClientRect();
    const copy = icon.cloneNode(true) as HTMLImageElement;
    copy.style.width = `${ir.width}px`;
    copy.style.height = `${ir.height}px`;
    ghost.appendChild(copy);
  }
  document.body.appendChild(ghost);
  document.body.classList.add("drag-carrying");
  a.ghost = ghost;
  a.rise = a.touch ? r.height / 2 + FINGER_LIFT * uiZoom() : 0;
  a.source.setAttribute("data-drag-lifted", "");
  if (a.touch) navigator.vibrate?.(8);
  a.opts.onLift?.();
  follow(at);
}

/** Where the thing is held: on the pointer, or above a fingertip. */
function aim(at: { clientX: number; clientY: number }) {
  return { x: at.clientX, y: at.clientY - (active?.rise ?? 0) };
}

/** The target that will take the thing at a point on the screen, if any. */
function targetAt(x: number, y: number): { el: HTMLElement; target: Target } | null {
  const a = active;
  if (!a) return null;
  for (let el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]"); el; el = el.parentElement?.closest<HTMLElement>("[data-drop]") ?? null) {
    const target = targets.get(el.dataset.drop ?? "");
    if (target?.accepts(a.thing, el)) return { el, target };
  }
  return null;
}

function follow(at: { clientX: number; clientY: number }) {
  const a = active;
  if (!a?.ghost) return;
  const { x, y } = aim(at);
  a.ghost.style.left = `${x}px`;
  a.ghost.style.top = `${y}px`;
  const el = targetAt(x, y)?.el ?? null;
  if (el === a.over) return;
  a.over?.removeAttribute("data-drag-over");
  el?.setAttribute("data-drag-over", "");
  a.over = el;
}

function move(e: PointerEvent) {
  const a = active;
  if (!a || e.pointerId !== a.id) return;
  const far = Math.hypot(e.clientX - a.x, e.clientY - a.y) > SLOP[a.touch ? "touch" : "mouse"];
  if (!a.lifted) {
    if (!far) return;
    // A finger that moves before it has rested is scrolling, or tapping clumsily: not a drag.
    if (a.touch) return end();
    lift(e);
    return;
  }
  if (far) a.moved = true;
  follow(e);
}

function up(e: PointerEvent) {
  const a = active;
  if (!a || e.pointerId !== a.id) return;
  if (a.lifted) {
    const { x, y } = aim(e);
    const hit = targetAt(x, y);
    // Letting go would otherwise count as a click on whatever is under it, or on the source.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
    end();
    hit?.target.drop(a.thing, hit.el);
    return;
  }
  end();
}

function cancel() {
  end();
}

function key(e: KeyboardEvent) {
  if (e.key === "Escape" && active?.lifted) {
    e.stopPropagation();
    end();
  }
}

/** A finger resting still on a thing past the hold may be asking for its menu: then it is put back, not dragged. */
function menu(e: MouseEvent) {
  const a = active;
  if (!a) return;
  if (a.lifted && a.moved) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  end();
}

function end() {
  const a = active;
  if (!a) return;
  active = null;
  clearTimeout(a.timer);
  removeEventListener("pointermove", move);
  removeEventListener("pointerup", up);
  removeEventListener("pointercancel", cancel);
  removeEventListener("keydown", key);
  removeEventListener("contextmenu", menu, { capture: true });
  removeEventListener("blur", cancel);
  a.over?.removeAttribute("data-drag-over");
  a.ghost?.remove();
  a.source.removeAttribute("data-drag-lifted");
  if (a.lifted) {
    document.body.classList.remove("drag-carrying");
    a.opts.onEnd?.();
  }
}
