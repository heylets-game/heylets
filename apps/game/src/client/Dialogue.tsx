// The box a conversation's words are typed out in (useConversation.tsx runs the conversation): a plate with the
// speaker's name, their words a letter at a time, and under them your replies, or a line to type a question in.
// It sits along the bottom of the screen, and the view frames the two of you in what it leaves clear.

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
import type { TalkChoice } from "@gantt-quest/world";
import { uiZoom } from "./uiScale";
import "./dialogue.css";

export interface DialogueProps {
  dock: Ref<HTMLDivElement>;
  name: string;
  /** The page of their words being typed, and how much of it shows so far. */
  text: string;
  shown: number;
  /** More of their words to come after this page. */
  more: boolean;
  /** Waiting on their answer to a question. */
  thinking: boolean;
  /** Your question, while it is answered. */
  asked: string | null;
  /** Your replies, once they have had their say. */
  choices: TalkChoice[] | null;
  /** Typing a question: how long it may be, and how many are left today (null until known). */
  asking: { max: number; left: number | null } | null;
  onAdvance(): void;
  onChoose(choice: TalkChoice): void;
  onAsk(text: string): void;
  onBack(): void;
}

export function Dialogue(p: DialogueProps) {
  const done = p.shown >= p.text.length;
  const kb = useKeyboardInset(!!p.asking);
  const choices = useRef<HTMLDivElement>(null);
  // The first reply has the keyboard as the replies come up, so the arrow keys and Enter work at once.
  useEffect(() => {
    if (p.choices) choices.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [p.choices]);

  return (
    // A tap anywhere on the box but a reply or the line you type on goes on to the next words.
    <div className="talk-dock" ref={p.dock} style={kb ? { paddingBottom: kb + 10 } : undefined} onClick={(e) => !(e.target as HTMLElement).closest("button, input, form") && p.onAdvance()}>
      <div className="talk-plate">{p.name}</div>
      <div className="talk-box">
        {p.asked && <p className="talk-asked">“{p.asked}”</p>}
        {p.thinking ? (
          <p className="talk-words talk-thinking" aria-live="polite">…</p>
        ) : (
          <p className="talk-words" aria-live="polite">
            {p.text.slice(0, p.shown)}
            {/* The rest is there but unseen, so the box does not grow line by line as it is typed. */}
            <span className="talk-rest" aria-hidden>{p.text.slice(p.shown)}</span>
          </p>
        )}
        {done && !p.thinking && !p.choices && !p.asking && <span className="talk-next" aria-hidden>{p.more ? "▼" : "▶"}</span>}
      </div>
      {p.choices && (
        <div className="talk-choices" ref={choices} onKeyDown={(e) => moveFocus(e, choices.current)}>
          {p.choices.map((c, i) => (
            <button key={c.id} className={`talk-choice${c.bye ? " bye" : ""}`} onClick={() => p.onChoose(c)}>
              <span className="talk-key">{i + 1}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {p.asking && <AskLine {...p.asking} onAsk={p.onAsk} onBack={p.onBack} />}
    </div>
  );
}

function AskLine({ max, left, onAsk, onBack }: { max: number; left: number | null; onAsk(text: string): void; onBack(): void }) {
  const [text, setText] = useState("");
  const none = left === 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const said = text.replace(/\s+/g, " ").trim();
    if (said && !none) onAsk(said);
  };
  return (
    <form className="talk-ask" onSubmit={submit}>
      <input
        autoFocus
        value={text}
        maxLength={max}
        placeholder={none ? "No more questions today" : "Ask anything…"}
        disabled={none}
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onBack();
          }
        }}
        // iOS pushes the page up to make room for its keyboard; the box makes its own room instead.
        onFocus={() => requestAnimationFrame(() => window.scrollTo(0, 0))}
      />
      <button type="submit" className="primary" disabled={!text.trim() || none}>Say</button>
      <button type="button" onClick={onBack}>Back</button>
      {left !== null && <span className="talk-left">{left} left today</span>}
    </form>
  );
}

/** Arrow keys move between the replies, as on a pad. */
function moveFocus(e: KeyboardEvent, box: HTMLDivElement | null) {
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!step || !box) return;
  const all = [...box.querySelectorAll<HTMLButtonElement>("button")];
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  all[(at + step + all.length) % all.length]?.focus();
  e.preventDefault();
}

/**
 * How much of the bottom of the screen a phone's keyboard covers while `on`, in the view's own pixels (the UI is
 * zoomed): the box is raised by it. The visual viewport is the only measure of it that iOS gives.
 */
function useKeyboardInset(on: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) {
      setInset(0);
      return;
    }
    const measure = () => setInset(Math.max(0, Math.round((window.innerHeight - vv.height - vv.offsetTop) / uiZoom())));
    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
    };
  }, [on]);
  return inset;
}
