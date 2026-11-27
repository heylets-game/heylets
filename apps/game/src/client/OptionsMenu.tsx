// The game menu: one window for everything that is not the game itself. The
// cog on the bottom bar (or Escape) opens it over whatever view you are in;
// nothing pauses behind it. Down the left are the view's own actions (the
// invite link, your account, leaving) and putting things back; beside them
// the sound and the display.
//
// It closes on Escape, on Resume, or on a press outside the window.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PixelIcon } from "./PixelIcon";
import { SettingsSections } from "./Settings";
import { GEAR } from "./ui/menuIcons";

export interface ResetPosition {
  /** Ask the server to put your hero back. */
  run(): void;
  /** Where that is, for the hint: "the landing", "the door". */
  to: string;
}

/** Something the view you are in adds to the menu: its invite link, the way out. */
export interface MenuAction {
  label: ReactNode;
  run(): void;
  hint?: string;
  disabled?: boolean;
  /** Stay in the menu after it runs (copying a link); otherwise the menu closes. */
  stay?: boolean;
  tone?: "primary" | "danger" | "nudge";
}

/** Out to the main menu (#menu in App.tsx), from wherever you are. */
export const MAIN_MENU_HASH = "#menu";
/** The main menu, straight into making a new hero (the party picker's "Make a new hero"). */
export const NEW_HERO_HASH = "#menu/new-hero";

export function OptionsMenu({ reset, resetBlocked, mainMenuBlocked, title = "The Harbor of Heylets", subtitle, actions = [] }: {
  /** Offered where your hero can safely be put back. */
  reset?: ResetPosition;
  /** Why it is not offered here; shown greyed out with this as the reason. */
  resetBlocked?: string;
  /** Why you cannot go to the main menu from here right now (in a fight); shown greyed out with this as the reason. */
  mainMenuBlocked?: string;
  /** Where you are: the menu's heading. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** The view's own entries, listed first. */
  actions?: MenuAction[];
}) {
  const [open, setOpen] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Escape opens the menu when nothing else is open over the view, and closes it again. Anything that shuts on
  // Escape itself (a drop of the top bar, a piece being carried) says so with `data-closes-on-escape`, and has it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (open) {
        e.stopPropagation();
        setOpen(false);
        gear.current?.focus();
      } else if (!document.querySelector(".overlay, .look-dialog-backdrop, .emote-veil, [data-closes-on-escape]") && !(e.target as HTMLElement | null)?.closest?.("input, textarea, select")) {
        setOpen(true);
      }
    };
    // Heard before anyone else: a view that shuts its own window on Escape must not leave the menu thinking nothing was open.
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [open]);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  const close = () => setOpen(false);

  return (
    <span className="options">
      <button
        ref={gear}
        className="hud-btn options-gear"
        title="Menu (Esc)"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <PixelIcon rows={GEAR} size={20} />
      </button>
      {/* Drawn into the view itself, not here in the bar: the bar is filtered, and a filtered box would pin the menu inside it. */}
      {open && createPortal(
        <div className="overlay menu-overlay" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="panel window game-menu" id={menuId} role="dialog" aria-label="Menu">
            <span className="win-plate">Menu</span>
            <header className="menu-head">
              <h2>{title}</h2>
              {subtitle && <p className="muted">{subtitle}</p>}
            </header>
            <div className="menu-cols">
              <section className="menu-col">
                <h3>Game</h3>
                <button ref={first} className="primary menu-action" onClick={close}>Resume</button>
                {actions.map((a, i) => (
                  <button
                    key={i}
                    className={`menu-action ${a.tone ?? ""}`}
                    disabled={a.disabled}
                    title={a.hint}
                    onClick={() => {
                      a.run();
                      if (!a.stay) close();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
                <button
                  className="menu-action"
                  disabled={!reset}
                  title={reset ? `Put your hero back at ${reset.to}` : resetBlocked}
                  onClick={() => {
                    reset?.run();
                    close();
                  }}
                >
                  Reset position
                </button>
                <p className="options-note muted">{reset ? `Stuck or lost? This puts your hero back at ${reset.to}.` : resetBlocked}</p>
                <button
                  className="menu-action"
                  disabled={!!mainMenuBlocked}
                  title={mainMenuBlocked ?? "Your account, your crew, and starting or joining another"}
                  onClick={() => {
                    close();
                    location.hash = MAIN_MENU_HASH;
                  }}
                >
                  Main menu
                </button>
                {mainMenuBlocked && <p className="options-note muted">{mainMenuBlocked}</p>}
              </section>

              <SettingsSections />
            </div>
          </div>
        </div>,
        gear.current?.closest(".run") ?? document.body,
      )}
    </span>
  );
}
