// The party (party.ts) as the Harbor knows it, and the list that changes it.
//
// The party is shown in the crew roster (CrewRoster's `party`): the heroes you
// play first, outlined as yours. In town a "+" under the roster opens
// PartyPicker, the account's heroes to add to the party or take out of it.
// Out on a map the party is as it set out (the server refuses a change there).

import { useEffect, useState } from "react";
import { api, type HeroSlot } from "./api";
import { label } from "./labels";
import { actAs, useActingHero } from "./party";
import { spriteDataUrl } from "./render/sprites";
import "./party.css";

/** The account's heroes, to add to the party of `leader` (the hero this device plays) or take out of it. */
export function PartyPicker({ leader, onClose, onChanged }: { leader: string; onClose(): void; onChanged(): void }) {
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
        <p className="muted">Heroes in your party come onto a map with you, and you play each of them. Each keeps their own sheet, pack and XP; the party takes one share of a place's spoils.</p>
        {!heroes && !error && <p className="muted">Looking for your heroes…</p>}
        {heroes && others.length === 0 && <p className="muted">You have no other heroes yet. Make one from the main menu (Change hero), then add them here.</p>}
        <ul className="party-list">
          {others.map((h) => {
            const elsewhere = !h.party && h.crew?.id !== world?.id;
            return (
              <li key={h.id}>
                <img className="party-face" src={spriteDataUrl(h.classId)} alt="" />
                <span className="party-who">
                  <span className="party-name">{h.name}</span>
                  <span className="party-sub muted">
                    Lv {h.level} {label("class", h.classId)}
                    {elsewhere ? (h.crew ? ` · in ${h.crew.name}: comes into this world` : " · comes into this world") : ""}
                  </span>
                </span>
                <button className={`small ${h.party ? "" : "primary"}`} disabled={busy !== null} onClick={() => void change(h)}>
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
 * The party in town: the hero this device plays (`you`, who walks the town for all of them) and the rest of the party
 * in the same world, in that order; which of them is being acted as; and the way to act as another, or to read the
 * party again once it has changed. A hero no longer in it is no longer acted as.
 */
export function useTownParty(you: string | null, worldId: string | null): { ids: string[]; acting: string; pick(id: string): void; reload(): void } | null {
  const [heroes, setHeroes] = useState<HeroSlot[] | null>(null);
  const selected = useActingHero();
  const reload = () => void api.heroes().then((r) => setHeroes(r.heroes), () => {});
  useEffect(reload, [you]);
  const ids = you ? [you, ...(heroes ?? []).filter((h) => h.id !== you && h.party && h.crew?.id === worldId).map((h) => h.id)] : [];
  const acting = selected && ids.includes(selected) ? selected : you;
  useEffect(() => {
    if (heroes && selected && acting !== selected) actAs(null);
  }, [heroes, selected, acting]);
  if (!you || !acting) return null;
  return { ids, acting, pick: (id) => actAs(id === you ? null : id), reload };
}
