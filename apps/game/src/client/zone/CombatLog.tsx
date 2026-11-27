// The combat log: the whole fight, line by line, at the bottom right of the
// view. This is where a player reads what happened: whose turn began, what
// was tried, the dice as they fell, whether it landed, and what it did.
//
//   ── Round 2 ──
//   Mira's turn
//   Mira · Attack roll ▸ Dire Wolf
//     [14] + 5 = 19 vs 13                      HIT
//   Mira hits Dire Wolf with Cleave              9
//     1d8 <6> + 3 = 9
//
// A d20 is a six-sided chip, and both are shown when two were rolled (with
// advantage or disadvantage), the one that did not count struck through.
// Damage and healing dice are chips in the shape of their die: a d4's three
// corners, a square d6, a d8's diamond. Lines are coloured by side: your crew
// warm gold, the enemy red.
//
// The log keeps everything it is handed (the view caps it), scrolls, and
// stays at the newest line unless the player has scrolled up to read; then a
// button brings them back. Folded, it is a single strip showing the last line.
// What the crew say on the map is in it too, between the rolls, and open it
// has a line at its foot to say something: in a fight or out of one, words
// cost nothing and take no turn.
//
// RollToast is the one newest roll shown large for a moment over the turn
// bar: the d20 tumbles in and lands on its number, then the sum, then how it
// came out. It is the roll's card: it takes the same `Roll` the view already
// shows as a blow lands (ZoneView's `roll`), so it stands in that card's place.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { swingsOf, type Roll, type RollMod, type Rolled, type Swing } from "@gantt-quest/world";
import { ChatInput } from "../ChatInput";
import "./fight.css";

export type LogSide = "hero" | "enemy" | "none";

export type LogEntry =
  /** A heading: "Round 2", "Combat begins". */
  | { k: "head"; id: number; text: string }
  /** Whose turn starts. */
  | { k: "turn"; id: number; name: string; side: LogSide }
  /** Anything else. */
  /** `mods`: what of the moment went into what it tells of (a shield and what it was given for), shown as chips. */
  | { k: "note"; id: number; text: string; tone?: "good" | "bad" | "dim"; mods?: RollMod[] }
  /** A d20: an attack, a save, a shove, initiative. */
  | { k: "roll"; id: number; who: string; side: LogSide; roll: Roll; target?: string }
  | { k: "hit"; id: number; actor?: string; side: LogSide; target: string; what: string; amount: number; dice?: Rolled; crit?: boolean; blocked?: number }
  | { k: "miss"; id: number; actor: string; side: LogSide; target: string; what: string }
  | { k: "heal"; id: number; actor?: string; target: string; what: string; amount: number; dice?: Rolled }
  /** Something a crewmate (or you) said. */
  | { k: "chat"; id: number; who: string; text: string; mine?: boolean };

export interface CombatLogProps {
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
  /** More classes for the log's own box: "above" holds it over the rack and the turn bar whatever room there is beside them. */
  className?: string;
  /** Say a line of chat to everyone on the map. Left out: the log has no line to type into. */
  onSay?: (text: string) => void;
}

/** How a roll came out, in a word, and how it is coloured: "ok", "no", "crit" (a critical hit) or "flat" (nothing to beat). */
export function rollOutcome(roll: Roll): { word: string; tone: "ok" | "no" | "crit" | "flat" } {
  if (roll.kind === "initiative") return { word: "Initiative", tone: "flat" };
  if (roll.crit && roll.ok) return { word: "Critical", tone: "crit" };
  if (roll.kind === "attack") return roll.ok ? { word: "Hit", tone: "ok" } : { word: "Miss", tone: "no" };
  if (roll.kind === "save") return roll.ok ? { word: "Saved", tone: "ok" } : { word: "Failed", tone: "no" };
  return roll.ok ? { word: "Shoved", tone: "ok" } : { word: "Held firm", tone: "no" };
}

/** Which of the d20s rolled is the one that counted (the first that shows `kept`). */
const keptIndex = (roll: Roll) => Math.max(0, roll.d20.indexOf(roll.kept));
const signed = (n: number) => `${n < 0 ? "−" : "+"} ${Math.abs(n)}`;
const SHAPES = new Set([4, 6, 8, 10, 12, 20]);

/** What a roll that went against its roller lost them, in a word: "cost the hit". */
const LOST: Record<Roll["kind"], string> = { attack: "hit", save: "save", shove: "shove", initiative: "roll" };
const listOf = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * Everything that made the difference to a roll (swingsOf), as few clauses as it takes, each with whether it went the
 * roller's way: "High ground and advantage (Inspired) both made the difference", "Trees cost the hit", "Advantage
 * (Exposed) made it a critical hit". What turned the hit or the save shares one clause, and what turned a critical
 * another, so a roll has two at most: a bonus that landed a blow, and disadvantage that cost it a critical.
 */
export function swingClauses(roll: Roll, swings: Swing[]): { text: string; good: boolean }[] {
  const groups = new Map<string, Swing[]>();
  for (const s of swings) {
    const key = `${s.crit ? "crit" : "roll"}:${s.helped}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()].map((group) => {
    const { helped, crit } = group[0];
    const did = crit ? (helped ? "made it a critical hit" : "cost the critical hit") : helped ? "made the difference" : `cost the ${LOST[roll.kind]}`;
    const who = group.flatMap((s) => {
      if (s.adv) {
        const which = roll.adv > 0 ? "advantage" : "disadvantage";
        return [s.names.length > 0 ? `${which} (${s.names.join(", ")})` : which];
      }
      return s.between ? [`${listOf(s.names)} between them`] : s.names;
    });
    const each = group.some((s) => s.between) ? "" : who.length === 2 ? "both " : who.length > 2 ? "all " : "";
    const line = `${listOf(who)} ${each}${did}`;
    return { text: line[0].toUpperCase() + line.slice(1), good: helped };
  });
}

/** What made the difference to a roll as one line of plain words (swingClauses, joined), or null if nothing did. */
export const swingText = (roll: Roll, swings: Swing[]): string | null => swingClauses(roll, swings).map((c) => c.text).join("; ") || null;

/** What made the difference to a roll as it is shown under it: its clauses, each in its own colour. */
function SwingLine({ roll, swings, className }: { roll: Roll; swings: Swing[]; className: string }) {
  const clauses = swingClauses(roll, swings);
  if (clauses.length === 0) return null;
  return (
    <div className={className}>
      {clauses.map((c, i) => <span key={i} className={c.good ? "good" : "bad"}>{i > 0 && " · "}{c.text}</span>)}
    </div>
  );
}

/**
 * A roll's parts of the moment (Roll `mods`, then `vsMods`), each as it is shown: what it added, whether it was on
 * the roller's side (a bonus of theirs, or a lowering of what they had to reach), and whether it made the difference.
 */
function partsOf(roll: Roll, swings: Swing[]) {
  const named = new Set(swings.filter((s) => !s.adv).flatMap((s) => s.names));
  return [
    ...(roll.mods ?? []).map((m) => ({ text: `${signed(m.n)} ${m.name}`, good: m.n > 0, swung: named.has(m.name) })),
    ...(roll.vsMods ?? []).map((m) => ({ text: `vs ${signed(m.n)} ${m.name}`, good: m.n < 0, swung: named.has(m.name) })),
  ];
}

/** Why a roll had advantage or disadvantage, as its badge shows it after the word: " · Dark", or nothing if not known. */
const reasons = (roll: Roll) => (roll.advWhy?.length ? ` · ${roll.advWhy.join(", ")}` : "");

const CANCEL_TIP = "Advantage and disadvantage cancel: one die, no better and no worse";

/** Advantage and disadvantage that cancelled on a roll (Roll `cancelled`), as its badge reads: "cancelled · Exposed / Poisoned", for in green and against in red. */
function Cancelled({ roll }: { roll: Roll }) {
  if (!roll.cancelled) return null;
  return <>cancelled · <span className="for">{roll.cancelled.adv.join(", ")}</span> / <span className="against">{roll.cancelled.dis.join(", ")}</span></>;
}

/** Whether advantage or disadvantage made the difference to a roll, for its badge. */
const advSwung = (swings: Swing[]) => swings.some((s) => s.adv);

/**
 * One die as a chip in its own shape, showing what it rolled. `dropped` strikes it through (the d20 that did not
 * count); the highest and lowest faces of a d20 are tinted, and a damage die that rolled its most is too.
 */
export function Die({ d, n, dropped = false }: { d: number; n: number; dropped?: boolean }) {
  const shape = SHAPES.has(d) ? d : d < 6 ? 4 : d < 8 ? 6 : d < 10 ? 8 : d < 12 ? 10 : d < 20 ? 12 : 20;
  return (
    <span className={`fd d${shape} ${dropped ? "dropped" : n >= d ? "top" : d === 20 && n === 1 ? "low" : ""}`} title={`d${d}: ${n}`}>
      <span>{n}</span>
    </span>
  );
}

/** Damage or healing dice written out: "1d8 <6> + 3 = 9", with what a save or a shield did to it after. */
export function DiceSum({ dice, blocked }: { dice: Rolled; blocked?: number }) {
  return (
    <>
      <span className="fl-nd">{dice.faces.length}d{dice.d}</span>
      {dice.faces.map((n, i) => <Die key={i} d={dice.d} n={n} />)}
      {dice.plus !== 0 && <span>{signed(dice.plus)}</span>}
      <span>= <strong>{dice.total}</strong></span>
      {dice.crit && <span className="fl-mod adv" title="A critical hit rolls twice the dice">crit</span>}
      {dice.halved && <span className="fl-mod half" title="The target saved, and took half">halved</span>}
      {!!blocked && <span className="fl-mod blk" title="Taken by a shield or a guard">({blocked} blocked)</span>}
      {(dice.mods ?? []).map((m, i) => <span key={i} className={`fl-part ${m.n > 0 ? "good" : "bad"}`}>{signed(m.n)} {m.name}</span>)}
    </>
  );
}

/** What of the moment went into damage dice (Rolled `mods`), a chip each, as the roll card shows them under the dice. */
function DiceParts({ dice }: { dice: Rolled }) {
  if (!dice.mods?.length) return null;
  return <div className="fr-parts dmg">{dice.mods.map((m, i) => <span key={i} className={`fr-part ${m.n > 0 ? "good" : "bad"}`}>{signed(m.n)} {m.name}</span>)}</div>;
}

/** A d20 roll written out: the dice, the bonus, the sum, what it had to reach, and how it came out. */
function RollSum({ roll }: { roll: Roll }) {
  const kept = keptIndex(roll);
  const out = rollOutcome(roll);
  const swings = swingsOf(roll);
  const parts = partsOf(roll, swings);
  const why = roll.advWhy?.length ? ` (${roll.advWhy.join(", ")})` : "";
  return (
    <>
      <div className="fl-math">
        {roll.d20.map((n, i) => <Die key={i} d={20} n={n} dropped={i !== kept} />)}
        <span>{signed(roll.bonus)}</span>
        <span>= <strong>{roll.total}</strong></span>
        {roll.kind !== "initiative" && <i>vs {roll.vs}</i>}
        {roll.adv !== 0 && <span className={`fl-mod ${roll.adv > 0 ? "adv" : "dis"} ${advSwung(swings) ? "swung" : ""}`} title={roll.adv > 0 ? `Advantage${why}: two dice, the higher counts` : `Disadvantage${why}: two dice, the lower counts`}>{roll.adv > 0 ? "adv" : "dis"}{reasons(roll)}</span>}
        {roll.cancelled && <span className="fl-mod even" title={CANCEL_TIP}><Cancelled roll={roll} /></span>}
        {roll.kind !== "initiative" && <span className={`fl-tag ${out.tone}`}>{out.word}</span>}
      </div>
      {parts.length > 0 && (
        <div className="fl-parts">
          {parts.map((p, i) => <span key={i} className={`fl-part ${p.good ? "good" : "bad"} ${p.swung ? "swung" : ""}`}>{p.text}</span>)}
        </div>
      )}
      <SwingLine roll={roll} swings={swings} className="fl-swing" />
    </>
  );
}

/** One entry as plain words: the folded log's strip, and anything else that wants a line of text. */
export function logLine(e: LogEntry): string {
  switch (e.k) {
    case "head": return e.text;
    case "turn": return `${e.name}'s turn`;
    case "note": return e.text;
    case "roll": return e.roll.kind === "initiative" ? `${e.who} rolls ${e.roll.total} for initiative` : `${e.who}: ${e.roll.label} ${e.roll.total} vs ${e.roll.vs}, ${rollOutcome(e.roll).word.toLowerCase()}${((t) => (t ? ` (${t})` : ""))(swingText(e.roll, swingsOf(e.roll)))}`;
    case "hit": return e.actor ? `${e.actor} hits ${e.target} with ${e.what} for ${e.amount}${e.crit ? " (critical)" : ""}` : `${e.target} takes ${e.amount} from ${e.what}`;
    case "miss": return `${e.actor} misses ${e.target} with ${e.what}`;
    case "heal": return e.actor && e.actor !== e.target ? `${e.actor} heals ${e.target} for ${e.amount} with ${e.what}` : `${e.target} recovers ${e.amount} from ${e.what}`;
    case "chat": return `${e.who}: ${e.text}`;
  }
}

const Row = memo(function Row({ e, fresh }: { e: LogEntry; fresh: boolean }) {
  const cls = (more: string) => `fl-e ${e.k} ${more} ${fresh ? "fresh" : ""}`;
  switch (e.k) {
    case "head":
      return <div className={cls("")} role="separator"><span>{e.text}</span></div>;
    case "turn":
      return <div className={cls(e.side)}>{e.name}'s turn</div>;
    case "note":
      return (
        <div className={cls(e.tone ?? "")}>
          {e.text}
          {!!e.mods?.length && <div className="fl-parts">{e.mods.map((m, i) => <span key={i} className={`fl-part ${m.n > 0 ? "good" : "bad"}`}>{signed(m.n)} {m.name}</span>)}</div>}
        </div>
      );
    case "roll":
      return (
        <div className={cls(e.side)}>
          <div className="fl-line">
            <span><b>{e.who}</b> <span className="fl-what">· {e.roll.label}</span>{e.target && <> <span className="fl-what">▸</span> <span className="fl-tgt">{e.target}</span></>}</span>
          </div>
          <RollSum roll={e.roll} />
        </div>
      );
    case "hit":
      return (
        <div className={cls(`${e.side} ${e.crit ? "crit" : ""}`)}>
          <div className="fl-line">
            {e.actor
              ? <span><b>{e.actor}</b> {e.crit ? "crits" : "hits"} <span className="fl-tgt">{e.target}</span> <span className="fl-what">with {e.what}</span></span>
              : <span><span className="fl-tgt">{e.target}</span> takes damage <span className="fl-what">from {e.what}</span></span>}
            <strong className="fl-amt" title={`${e.amount} damage`}>{e.amount}</strong>
          </div>
          {e.dice
            ? <div className="fl-math"><DiceSum dice={e.dice} blocked={e.blocked} /></div>
            : !!e.blocked && <div className="fl-math"><span className="fl-mod blk">({e.blocked} blocked)</span></div>}
        </div>
      );
    case "miss":
      return <div className={cls(e.side)}><b>{e.actor}</b> misses <span className="fl-tgt">{e.target}</span> <span className="fl-what">with {e.what}</span></div>;
    case "heal":
      return (
        <div className={cls("hero")}>
          <div className="fl-line">
            {e.actor && e.actor !== e.target
              ? <span><b>{e.actor}</b> heals <span className="fl-tgt">{e.target}</span> <span className="fl-what">with {e.what}</span></span>
              : <span><b>{e.target}</b> recovers <span className="fl-what">· {e.what}</span></span>}
            <strong className="fl-amt heal" title={`${e.amount} healed`}>+{e.amount}</strong>
          </div>
          {e.dice && <div className="fl-math"><DiceSum dice={e.dice} /></div>}
        </div>
      );
    case "chat":
      // Not "chat": that class is the place panels' own.
      return <div className={`fl-e said ${e.mine ? "mine" : ""} ${fresh ? "fresh" : ""}`}><b>{e.who}:</b> {e.text}</div>;
  }
});

// Drawn again only when what it is handed changes: the view it sits in is drawn for every hex the pointer crosses.
export const CombatLog = memo(function CombatLog({ entries, open, onToggle, className, onSay }: CombatLogProps) {
  const body = useRef<HTMLDivElement>(null);
  /** At the newest line: new ones are followed. Off once the player scrolls up to read. */
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  /** The newest entry there was when the log was first drawn (or last opened): later ones light up as they come. */
  const [seen, setSeen] = useState(() => (entries.length ? entries[entries.length - 1].id : -Infinity));
  const last = entries.length ? entries[entries.length - 1] : null;

  useLayoutEffect(() => {
    const el = body.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, entries.length, open]);
  // Opened: start at the newest line again.
  useEffect(() => {
    if (!open) return;
    stuck.current = true;
    setAway(false);
  }, [open]);
  // What has been shown once no longer lights up.
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setSeen(last.id), 950);
    return () => clearTimeout(timer);
  }, [last?.id]);

  const toLatest = () => {
    const el = body.current;
    if (!el) return;
    stuck.current = true;
    setAway(false);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <section className={`fight-ui fight-log ${open ? "open" : "shut"} ${onSay ? "talk" : ""} ${className ?? ""}`} aria-label="Combat log">
      <button type="button" className="fl-head" aria-expanded={open} onClick={onToggle} title={open ? "Fold the log away" : "Open the combat log"}>
        <span className="fl-title">Combat Log</span>
        {open ? <span className="fl-count">{entries.length ? `${entries.length} line${entries.length === 1 ? "" : "s"}` : ""}</span> : <span className="fl-last">{last ? logLine(last) : "Nothing yet"}</span>}
        <span className="fl-chev" aria-hidden />
      </button>
      {open && (
        <div
          ref={body}
          className="fl-body"
          role="log"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            const at = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
            stuck.current = at;
            setAway(!at);
          }}
        >
          {entries.length === 0 && <div className="fl-empty">Nothing has happened yet.</div>}
          {entries.map((e) => <Row key={e.id} e={e} fresh={e.id > seen} />)}
        </div>
      )}
      {open && away && <button type="button" className="fl-jump" onClick={toLatest}>Latest ↓</button>}
      {open && onSay && <div className="fl-say"><ChatInput placeholder="Say something…" onSay={onSay} /></div>}
    </section>
  );
});

// ---------- the roll, large ----------

export interface RollToastProps {
  /** A roll to show: a new one (a new object) plays, or waits its turn behind the one up. Null adds nothing. */
  roll: Roll | null;
  /** Who rolled. */
  who?: string;
  /** The damage or healing dice that followed it, shown under the outcome. */
  dice?: Rolled | null;
  /** How long a card stays before it fades by itself, in milliseconds, when nothing is waiting behind it. */
  hold?: number;
}

/** How long the die tumbles before it lands, in milliseconds (fr-tumble in fight.css). */
const TUMBLE_MS = 700;

/** How much longer the roll card stays when it says what made the difference. */
const SWING_READ_MS = 900;

function BigD20({ n, cls }: { n: number; cls: string }) {
  return (
    <span className={`fr-d20 ${cls}`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <path className="fr-body" d="M50 4 90 27V73L50 96 10 73V27Z" />
        <path className="fr-top" d="M50 4 90 27 50 24 10 27Z" />
        <path className="fr-edge" d="M50 24 76 66H24ZM50 24V4M50 24 10 27M50 24 90 27M76 66 90 27M76 66 90 73M76 66 50 96M24 66 10 27M24 66 10 73M24 66 50 96" />
      </svg>
      <b>{n}</b>
    </span>
  );
}

/**
 * The least a card is up before a roll waiting behind it takes its place (RollToast), in milliseconds: the die lands,
 * the outcome stamps down, and there is a moment to read it; longer with a line on what made the difference.
 */
const minShown = (roll: Roll) => TUMBLE_MS + (swingsOf(roll).length > 0 ? 1400 : 800);
/** How many rolls may wait to be shown. More than that, and the oldest waiting is skipped (it is in the log). */
const QUEUE_MAX = 2;

interface Shown { roll: Roll; who?: string; dice?: Rolled | null }

/**
 * The roll, large, one at a time. A roll that comes while another is up waits its turn rather than cutting it off:
 * the one up stays its least (minShown), then the next plays. With none waiting, each stays its full `hold`.
 */
export function RollToast({ roll, who, dice, hold = 2200 }: RollToastProps) {
  const [s, setS] = useState<{ now: (Shown & { at: number }) | null; queue: Shown[]; n: number }>({ now: null, queue: [], n: 0 });
  const [came, setCame] = useState<Roll | null>(null);
  if (roll !== came) {
    setCame(roll);
    if (roll) {
      const entry = { roll, who, dice };
      setS((p) => (p.now ? { ...p, queue: [...p.queue, entry].slice(-QUEUE_MAX) } : { now: { ...entry, at: performance.now() }, queue: [], n: p.n + 1 }));
    }
  }
  const next = useCallback(() => setS((p) => (p.queue.length > 0 ? { now: { ...p.queue[0], at: performance.now() }, queue: p.queue.slice(1), n: p.n + 1 } : { ...p, now: null })), []);
  // Something is waiting: the one up gives way once it has been up its least.
  const waiting = s.queue.length > 0;
  useEffect(() => {
    if (!s.now || !waiting) return;
    const t = setTimeout(next, Math.max(0, s.now.at + minShown(s.now.roll) - performance.now()));
    return () => clearTimeout(t);
  }, [s.now, waiting, next]);
  if (!s.now) return null;
  return <RollCard key={s.n} roll={s.now.roll} who={s.now.who} dice={s.now.dice} hold={hold} onGone={next} />;
}

/** One roll's card: the die tumbles and lands, then the sum, the outcome and the rest; it fades by itself, then says so (`onGone`). */
function RollCard({ roll, who, dice, hold, onGone }: { roll: Roll; who?: string; dice?: Rolled | null; hold: number; onGone(): void }) {
  /** The faces the dice show while they tumble, then what they rolled. */
  // (Made afresh for each roll, keyed by RollToast: each plays from the start.)
  const [faces, setFaces] = useState<number[]>(roll.d20);
  const [phase, setPhase] = useState<"roll" | "landed" | "out" | "gone">("roll");

  useEffect(() => {
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let spin: ReturnType<typeof setInterval> | undefined;
    const land = () => {
      if (spin) clearInterval(spin);
      setFaces(roll.d20);
      setPhase("landed");
    };
    if (still) land();
    else {
      setPhase("roll");
      setFaces(roll.d20.map(() => 1 + Math.floor(Math.random() * 20)));
      spin = setInterval(() => setFaces(roll.d20.map(() => 1 + Math.floor(Math.random() * 20))), 60);
      timers.push(setTimeout(land, TUMBLE_MS));
    }
    // A roll with something that made the difference stays a little longer: there is a line more to read.
    const stay = hold + (swingsOf(roll).length > 0 ? SWING_READ_MS : 0);
    timers.push(setTimeout(() => setPhase("out"), stay), setTimeout(() => (setPhase("gone"), onGone()), stay + 360));
    return () => {
      if (spin) clearInterval(spin);
      timers.forEach(clearTimeout);
    };
  }, [roll, hold, onGone]);

  if (phase === "gone") return null;
  const out = rollOutcome(roll);
  const kept = keptIndex(roll);
  const botch = roll.kind === "attack" && roll.kept === 1;
  const words: ReactNode = roll.kind === "initiative" ? "Initiative" : out.tone === "crit" ? "Critical hit!" : out.word;
  const swings = swingsOf(roll);
  const parts = partsOf(roll, swings);
  return (
    <div className={`fight-ui fight-roll ${out.tone} ${botch ? "botch" : ""} ${phase === "roll" ? "" : "landed"} ${phase === "out" ? "out" : ""}`} role="status">
      <div className="fr-dice">
        {roll.d20.map((_, i) => <BigD20 key={i} n={faces[i] ?? roll.d20[i]} cls={i === kept ? "kept" : "dropped"} />)}
      </div>
      <div className="fr-text">
        <div className="fr-who">
          {who && <><b>{who}</b> · </>}{roll.label}
          {roll.adv !== 0 && <em className={`${roll.adv > 0 ? "adv" : "dis"} ${advSwung(swings) ? "swung" : ""}`}>{roll.adv > 0 ? "advantage" : "disadvantage"}{reasons(roll)}</em>}
          {roll.cancelled && <em className="even" title={CANCEL_TIP}><Cancelled roll={roll} /></em>}
        </div>
        <div className="fr-line">
          <span className="fr-sum">
            {roll.kept} <i>{signed(roll.bonus)}</i> = <strong>{roll.total}</strong>
            {roll.kind !== "initiative" && <i>vs {roll.vs}</i>}
          </span>
          <span className="fr-out">{words}</span>
        </div>
        {parts.length > 0 && (
          <div className="fr-parts">
            {parts.map((p, i) => <span key={i} className={`fr-part ${p.good ? "good" : "bad"} ${p.swung ? "swung" : ""}`}>{p.text}</span>)}
          </div>
        )}
        <SwingLine roll={roll} swings={swings} className="fr-swing" />
        {dice && (
          <div className="fr-dmg">
            <i>{dice.faces.length}d{dice.d}</i>
            {dice.faces.map((n, i) => <Die key={i} d={dice.d} n={n} />)}
            {dice.plus !== 0 && <span>{signed(dice.plus)}</span>}
            <span>= <strong>{dice.total}</strong></span>
            {dice.halved && <i>halved</i>}
          </div>
        )}
        {dice && <DiceParts dice={dice} />}
      </div>
    </div>
  );
}
