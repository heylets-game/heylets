// The party: the heroes of yours being played together (party.ts), one card
// each, the one being acted as lit up. Clicking another acts as them. In town,
// a "+" under the cards opens the list of the account's heroes, to add one to
// the party or take one out of it. Out on a map the party is as it set out.
//
// On a map (ZoneView) each card shows the hero's health, and stand-ins and
// creatures of yours are listed with them. In the Harbor (HarborView) one
// figure walks the town for the whole party, and clicking another card acts
// as them from there.

import { useEffect, useState } from "react";
import type { Outfit } from "@gantt-quest/world";
import { api, type HeroSlot } from "./api";
import { actAs, useActingHero } from "./party";
import { label } from "./labels";
import { spriteDataUrl, spriteKey } from "./render/sprites";
import "./party.css";

export interface PartyCard {
  id: string;
  name: string;
  classId: string;
  level: number;
  outfit?: Outfit;
  /** On a map: their health now, and any shield over it. */
  hp?: { now: number; max: number; shield?: number };
  /** Why they cannot be picked right now (down, or waiting on their turn). */
  blocked?: string;
}

interface Props {
  cards: PartyCard[];
  /** Whose card is lit: the one being acted as. */
  acting: string;
  onPick(id: string): void;
  /** The hero this device plays: always in the party, so not offered in the list. */
  leader: string;
  /** Why the party cannot be changed right now. */
  locked?: string;
  /** The party was changed: read it again. Without it there is no "+" (out on a map, the party is as it set out). */
  onChanged?(): void;
  className?: string;
}

// toDataURL is not free: draw each look once.
const faces = new Map<string, string>();
function face(classId: string, outfit?: Outfit): string {
  const key = spriteKey(classId, outfit);
  let url = faces.get(key);
  if (!url) faces.set(key, (url = spriteDataUrl(classId, outfit)));
  return url;
}

export function PartyBar({ cards, acting, onPick, leader, locked, onChanged, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`party-bar ${className}`}>
      {cards.map((c) => (
        <button
          key={c.id}
          className={`party-card panel ${c.id === acting ? "acting" : ""}`}
          disabled={!!c.blocked && c.id !== acting}
          title={c.blocked ?? (c.id === acting ? `Playing ${c.name}` : `Play ${c.name}`)}
          onClick={() => c.id !== acting && onPick(c.id)}
        >
          <img className="party-face" src={face(c.classId, c.outfit)} alt="" />
          <span className="party-who">
            <span className="party-name">{c.name}</span>
            {c.hp ? (
              <span className="party-hp" aria-label={`${c.hp.now} of ${c.hp.max} health`}>
                <span className="party-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (100 * c.hp.now) / Math.max(1, c.hp.max)))}%` }} />
                <span className="party-hp-text">{c.hp.now}/{c.hp.max}{c.hp.shield ? ` +${c.hp.shield}` : ""}</span>
              </span>
            ) : (
              <span className="party-sub muted">Lv {c.level} {label("class", c.classId)}</span>
            )}
          </span>
        </button>
      ))}
      {onChanged && <button className="party-add" title={locked ?? "Add a hero of yours to the party"} aria-label="Change the party" onClick={() => setOpen(true)}>+</button>}
      {open && onChanged && <PartyPicker leader={leader} locked={locked} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </div>
  );
}

/** The account's heroes, to add to the party or take out of it. */
function PartyPicker({ leader, locked, onClose, onChanged }: { leader: string; locked?: string; onClose(): void; onChanged(): void }) {
  const [heroes, setHeroes] = useState<HeroSlot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.heroes().then((r) => setHeroes(r.heroes), (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const world = heroes?.find((h) => h.id === leader)?.crew ?? null;
  const others = (heroes ?? []).filter((h) => h.id !== leader);

  const change = async (hero: HeroSlot) => {
    setBusy(hero.id);
    setError(null);
    try {
      await (hero.party ? api.leaveParty(hero.id) : api.addToParty(hero.id));
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="party-ask" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel party-picker" role="dialog" aria-label="Your party">
        <div className="party-picker-head">
          <h3>Your party</h3>
          <button className="link" onClick={onClose}>Close</button>
        </div>
        <p className="muted">Heroes in your party come onto a map with you, and you play each of them. Each keeps their own sheet, pack, XP and share of the loot.</p>
        {locked && <p className="party-locked">{locked}</p>}
        {!heroes && !error && <p className="muted">Looking for your heroes…</p>}
        {heroes && others.length === 0 && <p className="muted">You have no other heroes yet. Make one from the main menu (Change hero), then add them here.</p>}
        <ul className="party-list">
          {others.map((h) => {
            const elsewhere = !h.party && h.crew?.id !== world?.id;
            return (
              <li key={h.id}>
                <img className="party-face" src={face(h.classId)} alt="" />
                <span className="party-who">
                  <span className="party-name">{h.name}</span>
                  <span className="party-sub muted">
                    Lv {h.level} {label("class", h.classId)}
                    {elsewhere ? (h.crew ? ` · in ${h.crew.name}: comes into this world` : " · comes into this world") : ""}
                  </span>
                </span>
                <button className={`small ${h.party ? "" : "primary"}`} disabled={!!locked || busy !== null} onClick={() => void change(h)}>
                  {busy === h.id ? "…" : h.party ? "Remove" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p className="party-error">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The party in town (and anywhere else only one of them walks): the hero this device plays, and the rest of the party
 * who are in the same world. One figure walks the town for all of them; clicking another card makes the hotkeys and
 * every menu open (the bag, the logbook, their own hero sheet) that hero's, in place (party.ts).
 */
export function TownParty({ you, worldId, outfit, className }: { you: string; worldId: string | null; outfit?: Outfit; className?: string }) {
  const [heroes, setHeroes] = useState<HeroSlot[] | null>(null);
  const selected = useActingHero();
  const load = () => api.heroes().then((r) => setHeroes(r.heroes), () => {});
  useEffect(() => {
    void load();
  }, [you]);
  const self = heroes?.find((h) => h.id === you);
  const party = (heroes ?? []).filter((h) => h.id !== you && h.party && h.crew?.id === worldId);
  // One taken out of the party (or gone to another world) is not acted as any longer.
  const acting = selected && party.some((h) => h.id === selected) ? selected : you;
  useEffect(() => {
    if (heroes && selected && acting !== selected) actAs(null);
  }, [heroes, selected, acting]);
  const card = (h: HeroSlot): PartyCard => ({ id: h.id, name: h.name, classId: h.classId, level: h.level, ...(h.id === you && outfit ? { outfit } : {}) });
  if (!self) return null;
  return (
    <PartyBar
      className={className}
      cards={[card(self), ...party.map(card)]}
      acting={acting}
      leader={you}
      onPick={(id) => actAs(id === you ? null : id)}
      onChanged={() => void load()}
    />
  );
}
