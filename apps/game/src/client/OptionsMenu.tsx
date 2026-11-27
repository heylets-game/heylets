// The game menu: one window for everything that is not the game itself. The
// cog on the bottom bar (or Escape) opens it over whatever view you are in;
// nothing pauses behind it. It is a window in the new UI's wood (ui/WoodWindow.tsx).
//
//   +-[ Menu ]-----------------------------------------+
//   |        Heylets Harbor  ·  crew · invite code      |
//   | > Resume        |  Sound                         |
//   |   (the view's)  |  ( Sound .............. On )   |
//   |   SETTINGS      |  Volume ===========o    50%    |
//   |   Sound      >  |  ...                           |
//   |   Graphics   >  |                                |
//   |   Interface  >  |                                |
//   |   Reset pos.    |                                |
//   |   Main menu     |                                |
//   +--------------------------------------------------+
//
// Down the left are the view's own actions (the invite link, your account,
// leaving), the settings' pages (Settings.tsx SETTINGS_PAGES), and putting
// your hero back or going out. The page picked fills the right. On a phone
// the list fills the window and a page opens over it as a submenu, with a
// way back.
//
// It closes on Escape, on Resume, or on a press outside the window.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PixelIcon } from "./PixelIcon";
import { SETTINGS_PAGES, SettingsPageBody } from "./Settings";
import { WoodWindow } from "./ui/WoodWindow";
import { COMPASS, DOOR, GEAR, PLAY } from "./ui/menuIcons";

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
  /** A pixel glyph (PixelIcon rows) before the label. */
  icon?: string[];
}

/** The settings page last looked at, opened again next time. */
let lastPage = SETTINGS_PAGES[0].key;

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
  const [pageKey, setPageKey] = useState(lastPage);
  /** On a phone: a page is open over the list. (On a computer both are always shown.) */
  const [inPage, setInPage] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const page = SETTINGS_PAGES.find((p) => p.key === pageKey) ?? SETTINGS_PAGES[0];

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
    else setInPage(false);
  }, [open]);

  const close = () => setOpen(false);
  const openPage = (key: string) => {
    lastPage = key;
    setPageKey(key);
    setInPage(true);
  };

  /** One entry down the left: its glyph, its words, and a chevron if it opens a page. */
  const entry = (icon: string[] | undefined, label: ReactNode, chevron = false) => (
    <>
      <span className="menu-entry-icon">{icon && <PixelIcon rows={icon} size={16} />}</span>
      <span className="menu-entry-label">{label}</span>
      {chevron && <span className="menu-entry-chevron" aria-hidden>›</span>}
    </>
  );

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
          <WoodWindow className={`game-menu ${inPage ? "in-page" : ""}`} id={menuId} plate="Menu">
            <header className="menu-head timber-head">
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </header>
            <div className="menu-body">
              <nav className="menu-rail" aria-label="Menu">
                <button ref={first} className="primary menu-entry menu-resume" onClick={close}>{entry(PLAY, "Resume")}</button>
                {actions.length > 0 && (
                  <div className="menu-group">
                    {actions.map((a, i) => (
                      <button
                        key={i}
                        className={`menu-entry ${a.tone ?? ""}`}
                        disabled={a.disabled}
                        title={a.hint}
                        onClick={() => {
                          a.run();
                          if (!a.stay) close();
                        }}
                      >
                        {entry(a.icon, a.label)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="menu-group" role="tablist" aria-label="Settings">
                  <h3 className="menu-group-head">Settings</h3>
                  {SETTINGS_PAGES.map((p) => (
                    <button
                      key={p.key}
                      role="tab"
                      className={`menu-entry menu-tab ${p.key === page.key ? "selected" : ""}`}
                      aria-selected={p.key === page.key}
                      aria-controls={`${menuId}-page`}
                      onClick={() => openPage(p.key)}
                    >
                      {entry(p.icon, p.label, true)}
                    </button>
                  ))}
                </div>
                <div className="menu-group menu-out">
                  <button
                    className="menu-entry"
                    disabled={!reset}
                    title={reset ? `Stuck or lost? Put your hero back at ${reset.to}` : resetBlocked}
                    onClick={() => {
                      reset?.run();
                      close();
                    }}
                  >
                    {entry(COMPASS, "Reset position")}
                  </button>
                  <p className="menu-why">{reset ? `Stuck or lost? Back to ${reset.to}.` : resetBlocked}</p>
                  <button
                    className="menu-entry"
                    disabled={!!mainMenuBlocked}
                    title={mainMenuBlocked ?? "Your account, your crew, and starting or joining another"}
                    onClick={() => {
                      close();
                      location.hash = MAIN_MENU_HASH;
                    }}
                  >
                    {entry(DOOR, "Main menu")}
                  </button>
                  {mainMenuBlocked && <p className="menu-why">{mainMenuBlocked}</p>}
                </div>
              </nav>

              <section className="menu-page" id={`${menuId}-page`} role="tabpanel" aria-label={page.label}>
                <header className="menu-page-head">
                  <button className="menu-back" aria-label="Back to the menu" onClick={() => setInPage(false)}>‹</button>
                  <PixelIcon rows={page.icon} size={18} />
                  <h3>{page.label}</h3>
                </header>
                <SettingsPageBody page={page} />
              </section>
            </div>
          </WoodWindow>
        </div>,
        gear.current?.closest(".run") ?? document.body,
      )}
    </span>
  );
}
