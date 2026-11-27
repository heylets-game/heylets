// The bar across the top of a place you walk into: its name, then a row of
// tabs in the timber of the new UI (theme.css `.timber`). A tab is either a
// plain button (Decorate, Lamp, Leave) or a drop: pressing it opens its panel
// under the bar, and only one is open at a time.
//
//   [ Your hut · Cottage | Hut v | Craft v | Decorate | ... | Lamp | Leave ]
//                          +--------------+
//                          | Craft     x  |
//                          | ...          |
//                          +--------------+
//
// On a computer the bar sits in the top left and a drop hangs under its own
// tab. On a phone the bar runs the width of the screen, the tabs are icons
// alone, and a drop opens across the whole width under it. A press anywhere
// else, or Escape, closes the drop.
//
// Which drop is open belongs to the view (`open`, `onOpen`), so it can open
// one itself (Storage on starting to decorate) or close it (on picking a
// piece up). `strip` is a line under the bar for what is going on right now
// (what is being carried), shown while no drop is open. Both are marked
// `data-closes-on-escape`, so Escape shuts them before it opens the game menu
// (OptionsMenu): the strip's view must clear what it shows on Escape itself.
//
// Written for any walk-in place, not the hut alone: the pub or a keeper's room
// can hand it their own tabs.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PixelIcon } from "../PixelIcon";
import "./topbar.css";

export interface TopBarItem {
  key: string;
  label: string;
  /** A pixel glyph (PixelIcon rows). On a phone it stands for the label. */
  icon?: string[];
  /** The tooltip, and what a screen reader says. */
  title?: string;
  /** A drop: the panel opened under the bar. Left out, the tab is a plain button. */
  panel?: ReactNode;
  /** The drop's width on a computer, in pixels (340 if left out). */
  width?: number;
  /** A plain button's press. */
  run?(): void;
  /** Pressed in: a mode that is on. */
  active?: boolean;
  /** Drawn in green: what to do next here (Leave, standing at the door). */
  primary?: boolean;
  disabled?: boolean;
  /** Set at the far end of the bar, after a gap. */
  end?: boolean;
}

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  items: TopBarItem[];
  open: string | null;
  onOpen(key: string | null): void;
  strip?: ReactNode;
  className?: string;
}

export function TopBar({ title, subtitle, items, open, onOpen, strip, className = "" }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const shown = items.find((i) => i.key === open && i.panel !== undefined) ?? null;
  /** Where the open drop starts, in the bar's own pixels: under its tab, kept on the screen. */
  const [x, setX] = useState(0);

  useLayoutEffect(() => {
    const bar = root.current;
    const tab = shown && tabs.current.get(shown.key);
    const box = drop.current;
    if (!bar || !tab || !box) return;
    // Measured in layout pixels (the view may be zoomed: offsets are before the zoom, as is the room's width).
    const room = (bar.offsetParent as HTMLElement | null)?.clientWidth ?? innerWidth;
    const want = tab.offsetLeft + tab.offsetWidth / 2 - box.offsetWidth / 2;
    setX(Math.max(-bar.offsetLeft + 8, Math.min(want, room - bar.offsetLeft - box.offsetWidth - 8)));
  }, [shown?.key]);

  // A press outside the bar and its drop, or Escape, closes the drop.
  useEffect(() => {
    if (!shown) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpen(null);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [shown?.key, onOpen]);

  const tab = (i: TopBarItem) => {
    const isDrop = i.panel !== undefined;
    const on = isDrop ? open === i.key : !!i.active;
    return (
      <button
        key={i.key}
        ref={(el) => void (el ? tabs.current.set(i.key, el) : tabs.current.delete(i.key))}
        className={`top-tab ${isDrop ? "drops" : ""} ${on ? "selected" : ""} ${i.primary ? "primary" : ""}`}
        aria-pressed={isDrop ? undefined : !!i.active}
        aria-expanded={isDrop ? open === i.key : undefined}
        aria-label={i.title ?? i.label}
        title={i.title ?? i.label}
        disabled={i.disabled}
        onClick={() => (isDrop ? onOpen(open === i.key ? null : i.key) : i.run?.())}
      >
        {i.icon && <PixelIcon rows={i.icon} size={14} />}
        <span className="top-tab-label">{i.label}</span>
      </button>
    );
  };

  return (
    <div className={`top-bar ${shown ? "dropped" : ""} ${className}`} ref={root}>
      <div className="top-row timber">
        <span className="top-name">
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </span>
        <span className="top-tabs">{items.filter((i) => !i.end).map(tab)}</span>
        <span className="top-tabs end">{items.filter((i) => i.end).map(tab)}</span>
      </div>
      {shown ? (
        <div className="top-drop timber" ref={drop} role="dialog" data-closes-on-escape aria-label={shown.label} style={{ "--drop-x": `${x}px`, "--drop-w": `${shown.width ?? 340}px` } as CSSProperties}>
          <div className="top-drop-head timber-head">
            {shown.icon && <PixelIcon rows={shown.icon} size={14} />}
            <strong>{shown.label}</strong>
            <span className="spacer" />
            <button className="top-drop-close" aria-label={`Close ${shown.label}`} title="Close (Esc)" onClick={() => onOpen(null)}>×</button>
          </div>
          <div className="top-drop-body">{shown.panel}</div>
        </div>
      ) : (
        strip && <div className="top-strip timber" data-closes-on-escape>{strip}</div>
      )}
    </div>
  );
}
