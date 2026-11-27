// The bestiary: a page of the logbook with a slot for every kind of enemy. A slot is a dark shape with no name
// until you have been in a fight with one; after that it is the creature itself, and opening it shows what it is at
// level 1 (hit points, defence, speed, initiative, saves), everything it can do, and how many you have faced and
// killed. What a kind is comes from the game's own tables (world bestiaryEntry); what you have met, from the server.
//
// Written to be used again: `pick` turns the slots you have met into a choice (the sparring ring's list of who to
// spar with), and `level` writes every kind up at that level, not its base.

import { useEffect, useMemo, useState } from "react";
import { BESTIARY_ALWAYS, BESTIARY_KINDS, bestiaryEntry, bestiaryMet, bestiaryProgress, type BestiaryRecord } from "@gantt-quest/world";
import { spriteDataUrl } from "./render/sprites";

const SEEN_KEY = "gq.bestiary.seen";

/** How many kinds were written up when this browser last had the page open: what the ribbon's mark is counted from. */
export function bestiarySeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSeen(met: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(met));
  } catch {
    // No storage (a private window): the mark just comes back next time.
  }
}

/** The records by kind, as the page and its ribbon read them. */
export const bestiaryBook = (records: readonly BestiaryRecord[]) => new Map(records.map((r) => [r.kind, r]));

/** Whether a kind has been written up since the page was last open here. */
export const bestiaryNews = (records: readonly BestiaryRecord[] | null): boolean => !!records && bestiaryProgress(bestiaryBook(records)).met > bestiarySeen();

const day = (at: number | null) => (at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

interface Props {
  /** Null while it is being fetched. */
  records: readonly BestiaryRecord[] | null;
  error?: string | null;
  /** The level every kind is written up at: its base numbers (1) when not said. */
  level?: number;
  /** Given: each kind you have met can be chosen, and this is told which. */
  pick?: { label: string; run(kind: string): void };
}

export function BestiaryPage({ records, error, level = 1, pick }: Props) {
  const book = useMemo(() => bestiaryBook(records ?? []), [records]);
  const progress = useMemo(() => bestiaryProgress(book), [book]);
  const [open, setOpen] = useState<string | null>(null);
  // Opening the page is having seen what is new on it.
  useEffect(() => {
    if (records) markSeen(progress.met);
  }, [records, progress.met]);
  const entry = open ? bestiaryEntry(open, level) : undefined;

  if (entry) {
    const record = book.get(entry.kind);
    return (
      <>
        <h3>{entry.name} {entry.boss && <span className="book-new">a boss</span>}</h3>
        <button className="book-link beast-back" onClick={() => setOpen(null)}>← All of the bestiary</button>
        <div className="beast-head">
          <div className="beast-portrait"><img src={spriteDataUrl(entry.kind, undefined, true)} alt="" /></div>
          <dl className="book-totals beast-stats">
            <div title="How much harm it takes before it goes down"><dt>Hit points</dt><dd>{entry.hp}</dd></div>
            <div title="What an attack has to roll to hit it"><dt>Defence</dt><dd>{entry.defence}</dd></div>
            <div title="Hexes of open ground 1 Action Point buys it. A hero gets 2."><dt>Speed</dt><dd>{entry.move > 0 ? entry.move : "never moves"}</dd></div>
            <div title="Added to its roll for who goes first"><dt>Initiative</dt><dd>{signed(entry.init)}</dd></div>
            <div title="Added to every saving throw it makes"><dt>Saves</dt><dd>{signed(entry.save)}</dd></div>
          </dl>
        </div>
        <p className="book-note">{level > 1 ? `As it is at level ${level}.` : "As it is at level 1. Its hit points and its damage grow with its level."}</p>
        {entry.moves.map((m, i) => (
          <div key={m.id} className="book-skill">
            <span className="book-skill-n">{m.passive ? "✦" : i + 1}</span>
            <div>
              <strong>{m.name}</strong>{m.passive && <small> always on</small>}
              <p>{m.text}</p>
            </div>
          </div>
        ))}
        <dl className="book-totals beast-record">
          <div title="How many of them you have been in a fight with"><dt>Faced</dt><dd>{record?.faced ?? 0}</dd></div>
          <div title="How many went down in a fight you were in"><dt>Killed</dt><dd>{record?.kills ?? 0}</dd></div>
          {record && <div title="The highest level you have met one at"><dt>Highest level met</dt><dd>{record.topLevel}</dd></div>}
          {record?.firstAt ? <div><dt>First met</dt><dd><small>{day(record.firstAt)}</small></dd></div> : null}
        </dl>
        {!record && BESTIARY_ALWAYS.includes(entry.kind) && <p className="book-note"><em>In every logbook from the first day.</em></p>}
        {pick && <p className="book-foot"><button onClick={() => pick.run(entry.kind)}>{pick.label}</button></p>}
      </>
    );
  }

  return (
    <>
      <h3>Bestiary {records && <span className="book-new">{progress.met} of {progress.of} met · {progress.kills} killed</span>}</h3>
      <p className="book-note">Everything you have been in a fight with is written up here. The rest are still out there.</p>
      {error && <p className="book-error">{error}</p>}
      {!records && !error && <p className="book-note"><em>Turning the pages…</em></p>}
      {records && (
        <div className="beast-grid">
          {BESTIARY_KINDS.map((kind) => {
            const e = bestiaryEntry(kind)!;
            const met = bestiaryMet(book, kind);
            const kills = book.get(kind)?.kills ?? 0;
            return (
              <button key={kind} className={`beast-slot ${met ? "" : "unmet"}`} disabled={!met} title={met ? `${e.name}${e.boss ? " · a boss" : ""} · ${kills} killed` : "Not met yet"} onClick={() => setOpen(kind)}>
                <img src={spriteDataUrl(kind)} alt="" draggable={false} />
                <span>{met ? e.name : "???"}</span>
                {met && kills > 0 && <b title={`${kills} killed`}>{kills}</b>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
