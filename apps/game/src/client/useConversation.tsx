// A conversation with one of the townsfolk, as the pub and the shops have them: the camera swings in close
// (render/TalkStage.ts), their words are typed out in a box along the bottom (Dialogue.tsx) in their voice, and
// you pick a reply. A reply opens their panel (the camera stays close, framing the two of you beside it, and
// shutting the panel brings the replies back), has them say more, lets you ask them anything (where they can be
// asked), or says goodbye. Escape, or walking off, ends it.

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { HexPos } from "@gantt-quest/core";
import { PUB_MAX_TALK, pagesOf, type Conversation, type TalkChoice } from "@gantt-quest/world";
import { sounds } from "./audio/gameSounds";
import { Dialogue } from "./Dialogue";
import { TalkStage } from "./render/TalkStage";
import type { WorldRenderer } from "./render/WorldRenderer";

type Phase = "arriving" | "speaking" | "choosing" | "asking" | "waiting" | "panel";

/** The panels a reply opens (their outer, floating element): the view frames the two of you beside whichever is up. */
const PANELS = ".draggable.pub-bar, .draggable.catch-panel";

export interface ConversationHost {
  world: RefObject<WorldRenderer | null>;
  /** Your hero's unit id, and the hex they stand on. */
  you: string | null;
  at: HexPos | null;
  /** A reply opened one of their panels (TalkChoice.opens). The conversation waits, close, until it is shut. */
  onOpen(what: string): void;
  /** Whether a panel opened from the conversation is still up: once none is, the replies come back. */
  panelOpen: boolean;
  /** Shut whatever panel the conversation opened (back to the replies). */
  closePanels(): void;
  /** Answer a typed question, for a conversation that can be asked (TalkChoice.ask). */
  ask?(text: string): Promise<{ say: string; left: number }>;
  /** How many questions are left today. */
  askLeft?(): Promise<{ left: number }>;
  /** Which of your shoulders to look over at this unit, where the room has something in the way of the other. */
  side?(unit: string): 1 | -1 | undefined;
}

/** Seconds a letter takes, and the pauses after the end of a sentence and after a comma. */
const LETTER_MS = 28;
const STOP_MS = 280;
const COMMA_MS = 120;
const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const typing = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
const onButton = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("button");

export function useConversation(host: ConversationHost): { active: Conversation | null; begin(convo: Conversation): void; close(): void; node: ReactNode } {
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<Phase>("arriving");
  const [asked, setAsked] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const stage = useRef<TalkStage | null>(null);
  const latest = useRef(host);
  latest.current = host;
  /** Where your hero stood as it began: walking off ends it. */
  const from = useRef<HexPos | null>(null);

  const text = pages[page] ?? "";
  const done = shown >= text.length;

  /** Say these words next, a page at a time. */
  const speak = useCallback((words: string[]) => {
    setPages(words);
    setPage(0);
    setShown(0);
    setPhase("speaking");
  }, []);

  const close = useCallback(() => {
    const s = stage.current;
    setConvo(null);
    setAsked(null);
    from.current = null;
    s?.leave();
  }, []);

  const advance = useRef(() => {});
  advance.current = () => {
    if (phase !== "speaking") return;
    if (!done) return setShown(text.length);
    if (page < pages.length - 1) {
      setPage(page + 1);
      setShown(0);
    } else setPhase("choosing");
  };

  const begin = useCallback(
    (c: Conversation) => {
      const r = latest.current.world.current;
      const { you, at } = latest.current;
      if (!r || !you || !at) return;
      const s = r.startMinigame(
        (group) =>
          new TalkStage(r, group, you, c.unit, {
            arrived: () => setPhase((p) => (p === "arriving" ? "speaking" : p)),
            advance: () => advance.current(),
            gone: () => close(),
            left: () => {
              if (stage.current === s) stage.current = null;
            },
          }, latest.current.side?.(c.unit)),
        at,
      );
      stage.current = s;
      from.current = at;
      setConvo(c);
      setPages(c.greeting);
      setPage(0);
      setShown(0);
      setAsked(null);
      setPhase("arriving");
    },
    [close],
  );

  const choose = (ch: TalkChoice) => {
    if (!convo) return;
    if (ch.bye) return close();
    if (ch.opens) {
      panelSeen.current = false;
      setPhase("panel");
      return latest.current.onOpen(ch.opens);
    }
    if (ch.says) {
      setAsked(null);
      return speak(pagesOf(ch.says));
    }
    if (ch.ask) {
      setAsked(null);
      setPhase("asking");
      void latest.current.askLeft?.().then((r) => setLeft(r.left), () => undefined);
    }
  };

  const ask = async (question: string) => {
    const c = convo;
    const answer = latest.current.ask;
    if (!c || !answer) return;
    setAsked(question);
    setPhase("waiting");
    try {
      const { say, left } = await answer(question);
      setLeft(left);
      speak(pagesOf(say));
    } catch (e) {
      const capped = (e as { status?: number }).status === 429;
      if (capped) setLeft(0);
      speak(pagesOf(capped ? c.tired ?? "That's enough talk for today." : `(${c.name} is busy and does not hear you.)`));
    }
  };

  // Their words, a letter at a time, in their voice; a breath at the end of a sentence. All at once, with one
  // blip, for reduced motion.
  useEffect(() => {
    if (!convo || phase !== "speaking" || shown >= text.length) return;
    if (still()) {
      sounds.blip(convo.voice);
      setShown(text.length);
      return;
    }
    const prev = text[shown - 1] ?? "";
    const wait = /[.!?…]/.test(prev) && text[shown] === " " ? STOP_MS : /[,;:]/.test(prev) ? COMMA_MS : LETTER_MS;
    const t = setTimeout(() => {
      const ch = text[shown];
      if (/[a-z0-9]/i.test(ch) && shown % 2 === 0) sounds.blip(convo.voice + (Math.random() - 0.5) * 0.6);
      setShown(shown + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [convo, phase, shown, text]);

  // A panel opened from a reply: once it has been up and is shut again, back to the replies.
  const panelSeen = useRef(false);
  const panelOpen = host.panelOpen;
  useEffect(() => {
    if (phase !== "panel") return;
    if (panelOpen) panelSeen.current = true;
    else if (panelSeen.current) setPhase("choosing");
  }, [phase, panelOpen]);
  // While it is up the camera frames the two of you in what it leaves clear (looked for again as it is moved or resized).
  useEffect(() => {
    if (phase !== "panel") return;
    const r = latest.current.world.current;
    let last: Element | null = null;
    const find = () => {
      // A panel docked along the bottom (a phone's) is framed above; one down the left side has them stand right of it.
      const panel = document.querySelector<HTMLElement>(PANELS);
      const box = panel?.getBoundingClientRect();
      const docked = panel && box && box.width > innerWidth * 0.7 ? panel : null;
      if (docked !== last) r?.setCover(docked);
      last = docked;
      const side = !docked && box && box.width > 0 && box.left < innerWidth / 3 ? Math.min(0.6, box.right / innerWidth) : 0;
      stage.current?.setAside(side / 2);
    };
    find();
    const t = setInterval(find, 250);
    return () => {
      clearInterval(t);
      stage.current?.setAside(0);
    };
  }, [phase]);

  // Their mouth moves while their words are typed.
  const talking = !!convo && phase === "speaking" && !done;
  useEffect(() => {
    stage.current?.setSpeaking(talking);
  }, [talking]);

  // The keys, while it is up: Enter or Space for the next words, a number for a reply, Escape to step back.
  useEffect(() => {
    if (!convo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (phase === "panel") return latest.current.closePanels();
        if (phase === "asking") setPhase("choosing");
        else close();
        e.preventDefault();
        return;
      }
      if (typing(e.target)) return;
      // (A focused reply's own Enter or Space presses it.)
      if ((e.key === "Enter" || e.key === " ") && !onButton(e.target)) {
        advance.current();
        e.preventDefault();
      } else if (phase === "choosing" && /^[1-9]$/.test(e.key)) {
        const ch = convo.choices[Number(e.key) - 1];
        if (ch) choose(ch);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // Walking off (or being moved off) ends it.
  const at = host.at;
  useEffect(() => {
    const was = from.current;
    if (convo && was && at && (was.q !== at.q || was.r !== at.r)) close();
  }, [at, convo, close]);

  // While it is up the room's panels and bar are put away (dialogue.css); all but the one a reply opened, while it is up.
  const look = !convo ? null : phase === "panel" ? "talking-panel" : "talking";
  useEffect(() => {
    if (!look) return;
    document.body.classList.add(look);
    return () => document.body.classList.remove(look);
  }, [look]);

  // Gone with the view: the camera is given back.
  useEffect(
    () => () => {
      const r = latest.current.world.current;
      if (r && stage.current && r.playing === stage.current) r.endMinigame();
    },
    [],
  );

  /** The view frames the two of you in what the box leaves clear. */
  const dock = useCallback((el: HTMLDivElement | null) => latest.current.world.current?.setCover(el), []);

  const node = convo && phase === "panel" ? (
    <button className="talk-back" onClick={() => latest.current.closePanels()}>
      ◀ Back to {convo.name}
    </button>
  ) : convo && phase !== "arriving" && (
    <Dialogue
      dock={dock}
      name={convo.name}
      text={text}
      shown={shown}
      more={page < pages.length - 1}
      thinking={phase === "waiting"}
      asked={asked}
      choices={phase === "choosing" ? convo.choices : null}
      asking={phase === "asking" ? { max: PUB_MAX_TALK, left } : null}
      onAdvance={() => advance.current()}
      onChoose={choose}
      onAsk={(q) => void ask(q)}
      onBack={() => setPhase("choosing")}
    />
  );

  return { active: convo, begin, close, node };
}
