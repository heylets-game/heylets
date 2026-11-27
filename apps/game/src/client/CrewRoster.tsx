// Who is in the crew (or in the room): one tidy row per person with their
// sprite, name, level and class, here-first. Shared by the Harbor's Crew
// panel, a zone's, and the "Inside" panels of the hut and the pub. Where a
// view offers things to do with a crewmate (trade, teleport to them), they
// are on a right-click of that crewmate's row.
//
// It is the party's display too (party.ts): the heroes you play are listed
// first, outlined in gold, and a click on one plays them; everyone else's are
// outlined in blue. In town a "+" under the list changes the party. The list
// folds away to its heading.
//
// With `avatarsOnPhone` (the party's corner of the Harbor and a map), a phone
// shows each person as a round portrait with their level on a badge, and a
// tap opens a card with the rest: their name, class and health, and what can
// be done with them (play them, their sheet, and the right-click's offers).

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { PartyPicker } from "./PartyPicker";
import type { Outfit } from "@gantt-quest/world";
import { label } from "./labels";
import { spriteDataUrl, spriteKey } from "./render/sprites";
import { uiZoom } from "./uiScale";
import { PHONE_QUERY, useMedia } from "./useMedia";
import "./roster.css";

export interface RosterMember {
  id: string;
  name: string;
  classId: string;
  level: number;
  /** In this place right now. Away members are greyed and listed after everyone here. */
  here: boolean;
  /** What they are wearing, when known (only for people present). */
  outfit?: Outfit;
  /** Extra small tags after the name, e.g. "owner". */
  tags?: string[];
  /** On a map: their health now, and any shield over it (shown for the heroes you play). */
  hp?: { now: number; max: number; shield?: number };
}

/** The heroes you play (your party, and any stand-in or creature of yours), and which of them you are acting as. */
export interface RosterParty {
  ids: string[];
  acting: string;
  /**
   * A click on one of them: "only" (a plain click) plays them alone; where the roster takes a group (`selected` given),
   * shift-click is "add", to the group walking with the one being played, and alt-click (Option on a Mac) is "drop".
   */
  onPick(id: string, how?: "only" | "add" | "drop"): void;
  /** On a map: the others of yours selected to walk with the one being played. */
  selected?: string[];
  /** Why one of them cannot be picked right now (down, not their turn). */
  blocked?(id: string): string | undefined;
  /** In town: the "+" under the list, to change the party. `leader` is the hero this device plays. */
  change?: { leader: string; onChanged(): void };
}

/** One thing to do with a crewmate, offered when their row is right-clicked. */
export interface RosterAction {
  label: string;
  /** Why it cannot be done right now: shown greyed out, with this under it. */
  blocked?: string;
  run(): void;
}

interface Props {
  members: RosterMember[];
  you: string | null;
  /** The line above the list, e.g. "3 of 9 here". */
  heading: ReactNode;
  /** Open this person's hero sheet. */
  onOpen?(id: string): void;
  /** Whose sheet is open, to mark their row. */
  openId?: string | null;
  /** What a right-click on someone's row offers (trade, teleport to them). Nothing for an empty list. */
  menu?(member: RosterMember): RosterAction[];
  /** The heroes you play: listed first, outlined as yours, and a click on one plays them. */
  party?: RosterParty;
  /** Kept folded or not between visits, under this name. Without it the list cannot be folded. */
  foldId?: string;
  /** On a phone: round portraits only, a tap opening a card with the rest. */
  avatarsOnPhone?: boolean;
}

const foldKey = (id: string) => `gq.roster.${id}.folded`;
function loadFolded(id: string | undefined): boolean {
  if (!id) return false;
  try {
    return localStorage.getItem(foldKey(id)) === "1";
  } catch {
    return false;
  }
}

// toDataURL is not free: draw each look once.
const faces = new Map<string, string>();
function face(classId: string, outfit?: Outfit): string {
  const key = spriteKey(classId, outfit);
  let url = faces.get(key);
  if (!url) faces.set(key, (url = spriteDataUrl(classId, outfit)));
  return url;
}

const byName = (a: RosterMember, b: RosterMember) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export function CrewRoster({ members, you, heading, onOpen, openId, menu, party, foldId, avatarsOnPhone }: Props) {
  const avatars = useMedia(PHONE_QUERY) && !!avatarsOnPhone;
  const yours = (id: string) => !!party?.ids.includes(id);
  // Yours first, in the party's own order; then whoever is here; then the rest.
  const own = party ? party.ids.flatMap((id) => members.filter((m) => m.id === id)) : [];
  const here = members.filter((m) => m.here && !yours(m.id)).sort(byName);
  const away = members.filter((m) => !m.here && !yours(m.id)).sort(byName);
  const [folded, setFolded] = useState(() => loadFolded(foldId));
  const fold = () =>
    setFolded((f) => {
      try {
        if (foldId) localStorage.setItem(foldKey(foldId), f ? "0" : "1");
      } catch {
        // Storage is off: folded for now only.
      }
      return !f;
    });
  const [picking, setPicking] = useState(false);
  /**
   * The menu that is open: whose, and where on screen it was asked for. A card (`card`) is a phone's tap on a
   * portrait: it stands beside the portrait (`right` from the screen's edge) and has their details and what a click
   * would have done too.
   */
  const [asked, setAsked] = useState<{ id: string; x: number; y: number; card?: boolean; right?: number } | null>(null);
  useEffect(() => {
    if (!asked) return;
    const close = () => setAsked(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // On the next turn of the loop, so the click that opened it does not close it.
    const t = setTimeout(() => {
      addEventListener("pointerdown", close);
      addEventListener("keydown", onKey);
    });
    return () => {
      clearTimeout(t);
      removeEventListener("pointerdown", close);
      removeEventListener("keydown", onKey);
    };
  }, [asked]);
  const askedOf = asked ? members.find((m) => m.id === asked.id) : undefined;
  const offered = askedOf && menu ? menu(askedOf) : [];

  /** What a plain click on someone's row does, as one of the card's entries; null where it does nothing. */
  const clickAction = (m: RosterMember): RosterAction | null => {
    const mine = m.id === (party?.acting ?? you);
    const ofYours = yours(m.id);
    if (ofYours && party && !mine) return { label: `Play ${m.name}`, blocked: party.blocked?.(m.id), run: () => party.onPick(m.id, "only") };
    if (ofYours && party && mine && party.selected?.length && !onOpen) return { label: `Play ${m.name} alone`, run: () => party.onPick(m.id, "only") };
    if (onOpen) return { label: "Hero sheet", run: () => onOpen(m.id) };
    return null;
  };
  const cardActions = askedOf && asked?.card ? [clickAction(askedOf), ...offered].filter((a, i, all): a is RosterAction => !!a && all.findIndex((b) => b?.label === a.label) === i) : offered;

  /** On a phone: a round portrait with their level, and health under it where it is known. A tap opens their card. */
  const avatar = (m: RosterMember) => {
    const mine = m.id === (party?.acting ?? you);
    const ofYours = yours(m.id);
    const grouped = !mine && !!party?.selected?.includes(m.id);
    const hp = m.hp ? Math.max(0, Math.min(100, (100 * m.hp.now) / Math.max(1, m.hp.max))) : null;
    const opened = asked?.card && asked.id === m.id;
    return (
      <li key={m.id} className={`cm-av-li ${m.here || ofYours ? "here" : "away"}${mine ? " mine" : ""}${grouped ? " grouped" : ""}${party ? (ofYours ? " yours" : " theirs") : ""}${opened ? " open" : ""}`}>
        <button
          type="button"
          className="cm-av"
          aria-label={`${m.name}, level ${m.level} ${label("class", m.classId)}${m.hp ? `, ${m.hp.now} of ${m.hp.max} health` : ""}${m.here ? "" : " (away)"}`}
          aria-haspopup="menu"
          aria-expanded={!!opened}
          onClick={(e) => {
            if (opened) return setAsked(null);
            const z = uiZoom() || 1;
            const r = e.currentTarget.getBoundingClientRect();
            setAsked({ id: m.id, card: true, x: r.left / z, y: r.top / z, right: (innerWidth - r.left) / z + 8 });
          }}
        >
          <img className="pixel-icon" src={face(m.classId, m.outfit)} width={36} height={44} alt="" />
          <span className="cm-av-lv" aria-hidden>{m.level}</span>
          {hp !== null && <span className="cm-av-hp" aria-hidden><i style={{ width: `${hp}%` }} /></span>}
        </button>
      </li>
    );
  };

  const row = (m: RosterMember) => {
    const mine = m.id === (party?.acting ?? you);
    const ofYours = yours(m.id);
    const blocked = ofYours && !mine ? party?.blocked?.(m.id) : undefined;
    const cls = label("class", m.classId);
    const body = (
      <>
        <span className="cm-face">
          <img className="pixel-icon" src={face(m.classId, m.outfit)} width={36} height={44} alt="" />
          <i className={`dot ${m.here ? "on" : ""}`} />
        </span>
        <span className="cm-text">
          <span className="cm-line">
            <strong className="cm-name">{m.name}</strong>
            {mine && <span className="cm-tag you">you</span>}
            {m.tags?.map((t) => <span key={t} className="cm-tag">{t}</span>)}
          </span>
          {m.hp ? (
            <span className="cm-hp" aria-label={`${m.hp.now} of ${m.hp.max} health`}>
              <span className="cm-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (100 * m.hp.now) / Math.max(1, m.hp.max)))}%` }} />
              <span className="cm-hp-text">{m.hp.now}/{m.hp.max}{m.hp.shield ? ` +${m.hp.shield}` : ""}</span>
            </span>
          ) : (
            <span className="cm-line">
              <span className="cm-lv">Lv {m.level}</span>
              <span className="cm-class">{cls}</span>
            </span>
          )}
        </span>
      </>
    );
    const grouped = !mine && !!party?.selected?.includes(m.id);
    // A click that changes the group: shift adds to it, alt (Option on a Mac) takes out of it.
    const how = (e: MouseEvent): "only" | "add" | "drop" => (!party?.selected ? "only" : e.shiftKey ? "add" : e.altKey ? "drop" : "only");
    // One of yours you are not playing: a click plays them (the one you are playing opens their sheet, where there is one).
    // With a group walking (on a map), the one you are playing is a click too: back to playing them alone, or (alt) the
    // next of the group leads.
    const pick = ofYours && party && (!mine || (party.selected?.length && !onOpen)) ? (e: MouseEvent) => party.onPick(m.id, how(e)) : null;
    return (
      <li
        key={m.id}
        className={`cm ${m.here || ofYours ? "here" : "away"}${mine ? " mine" : ""}${grouped ? " grouped" : ""}${party ? (ofYours ? " yours" : " theirs") : ""}${m.id === openId ? " open" : ""}`}
        onContextMenu={(e) => {
          if (!menu || menu(m).length === 0) return;
          e.preventDefault();
          setAsked({ id: m.id, x: e.clientX, y: e.clientY });
        }}
      >
        {pick ? (
          <button type="button" className="cm-main" disabled={!!blocked} title={blocked ?? (mine ? `Play ${m.name} alone. Alt-click: leave them, and the next of the group leads` : party?.selected ? `Play ${m.name}. Shift-click: walk with them too; Alt-click: leave them behind; P: everyone` : `Play ${m.name}`)} onClick={pick}>
            {body}
          </button>
        ) : onOpen ? (
          <button type="button" className="cm-main" title={`${m.name}, level ${m.level} ${cls}${m.here ? "" : " (away)"}. Look them over.`} onClick={() => onOpen(m.id)}>
            {body}
          </button>
        ) : (
          <span className="cm-main" title={`${m.name}, level ${m.level} ${cls}`}>{body}</span>
        )}
      </li>
    );
  };

  const card = asked?.card && askedOf ? (
    <div className="cm-card timber" role="menu" aria-label={askedOf.name} style={{ right: asked.right, top: Math.max(6, Math.min(asked.y, innerHeight / (uiZoom() || 1) - 60 - cardActions.length * 40 - 90)) }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cm-card-head">
        <span className="cm-face"><img className="pixel-icon" src={face(askedOf.classId, askedOf.outfit)} width={36} height={44} alt="" /></span>
        <span className="cm-text">
          <span className="cm-line">
            <strong className="cm-name">{askedOf.name}</strong>
            {askedOf.id === (party?.acting ?? you) && <span className="cm-tag you">you</span>}
          </span>
          <span className="cm-line">
            <span className="cm-lv">Lv {askedOf.level}</span>
            <span className="cm-class">{label("class", askedOf.classId)}</span>
          </span>
          {(askedOf.tags?.length || !askedOf.here) && <span className="cm-line cm-card-tags">{[...(askedOf.tags ?? []), ...(askedOf.here || yours(askedOf.id) ? [] : ["away"])].join(" · ")}</span>}
        </span>
      </div>
      {askedOf.hp && (
        <span className="cm-hp" aria-label={`${askedOf.hp.now} of ${askedOf.hp.max} health`}>
          <span className="cm-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (100 * askedOf.hp.now) / Math.max(1, askedOf.hp.max)))}%` }} />
          <span className="cm-hp-text">{askedOf.hp.now}/{askedOf.hp.max}{askedOf.hp.shield ? ` +${askedOf.hp.shield}` : ""}</span>
        </span>
      )}
      {cardActions.map((a) => (
        <button key={a.label} type="button" role="menuitem" className="cm-menu-item" disabled={!!a.blocked} onClick={() => { setAsked(null); a.run(); }}>
          <span>{a.label}</span>
          {a.blocked && <span className="muted">{a.blocked}</span>}
        </button>
      ))}
    </div>
  ) : null;

  if (avatars) {
    return (
      <div className="crew-roster roster-avatars">
        <ul className="roster">
          {own.map(avatar)}
          {here.map(avatar)}
          {away.map(avatar)}
        </ul>
        {party?.change && <button type="button" className="roster-add" title="Add a hero of yours to the party, or take one out" aria-label="Change the party" onClick={() => setPicking(true)}>+</button>}
        {picking && party?.change && <PartyPicker leader={party.change.leader} onClose={() => setPicking(false)} onChanged={party.change.onChanged} />}
        {card}
      </div>
    );
  }

  return (
    <div className={`panel crew-roster${folded ? " roster-folded" : ""}`}>
      <div className="roster-top">
        <h3 className="roster-head">{heading}</h3>
        {foldId && <button type="button" className="roster-fold" aria-expanded={!folded} title={folded ? "Show the list" : "Fold the list away"} onClick={fold}>{folded ? "+" : "\u2013"}</button>}
      </div>
      {!folded && (
        <>
          <ul className="roster">
            {own.map(row)}
            {here.map(row)}
            {away.length > 0 && here.length + own.length > 0 && <li className="roster-sep" aria-hidden>Away</li>}
            {away.map(row)}
          </ul>
          {party?.change && <button type="button" className="roster-add" title="Add a hero of yours to the party, or take one out" aria-label="Change the party" onClick={() => setPicking(true)}>+</button>}
        </>
      )}
      {picking && party?.change && <PartyPicker leader={party.change.leader} onClose={() => setPicking(false)} onChanged={party.change.onChanged} />}
      {card}
      {asked && !asked.card && askedOf && offered.length > 0 && (
        <div className="cm-menu panel" role="menu" aria-label={askedOf.name} style={{ left: Math.min(asked.x, innerWidth - 230), top: Math.min(asked.y, innerHeight - 40 - offered.length * 44) }} onPointerDown={(e) => e.stopPropagation()}>
          <strong className="cm-menu-name">{askedOf.name}</strong>
          {offered.map((a) => (
            <button key={a.label} type="button" role="menuitem" className="cm-menu-item" disabled={!!a.blocked} onClick={() => { setAsked(null); a.run(); }}>
              <span>{a.label}</span>
              {a.blocked && <span className="muted">{a.blocked}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
