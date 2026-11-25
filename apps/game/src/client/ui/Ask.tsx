// A question put to the player in the game's own frame, in place of the
// browser's confirm() and alert(): `ask` shows it and answers with what they
// chose. `AskHost`, drawn once (App.tsx), is where it shows.
//
// One question at a time: a second asked while one is up waits its turn.

import { useEffect, useRef, useSyncExternalStore } from "react";
import "./ask.css";

interface Question {
  text: string;
  /** The button that says yes (or, with no `no`, the only one). */
  yes: string;
  /** The button that says no. None: it is only something to be told, and its one button closes it. */
  no?: string;
  answer(yes: boolean): void;
}

let queue: Question[] = [];
const heard = new Set<() => void>();
const tell = () => heard.forEach((fn) => fn());

/** Ask the player something: true if they chose `yes`, false if `no` (or closed it). With no `no`, it is only told. */
export function ask(text: string, { yes = "Yes", no }: { yes?: string; no?: string } = {}): Promise<boolean> {
  return new Promise((answer) => {
    queue = [...queue, { text, yes, no, answer }];
    tell();
  });
}

function answer(yes: boolean): void {
  const [first, ...rest] = queue;
  if (!first) return;
  queue = rest;
  tell();
  first.answer(yes);
}

const subscribe = (fn: () => void) => {
  heard.add(fn);
  return () => void heard.delete(fn);
};

/** Where the question shows, over everything else. */
export function AskHost() {
  const q = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!q) return;
    yesRef.current?.focus();
    // Escape says no; the keys pressed while it is up are its own, not the game's hotkeys.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      answer(false);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [q]);
  if (!q) return null;
  return (
    <div className="ask-back" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="panel ask" role={q.no ? "alertdialog" : "dialog"} aria-modal="true" aria-describedby="ask-text">
        <p id="ask-text">{q.text}</p>
        <div className="ask-buttons">
          {q.no && <button onClick={() => answer(false)}>{q.no}</button>}
          <button ref={yesRef} className="primary" onClick={() => answer(true)}>{q.yes}</button>
        </div>
      </div>
    </div>
  );
}
