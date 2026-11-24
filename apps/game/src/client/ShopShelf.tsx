// A shopkeeper's wares on their shelves, as the shops lay them out beside a conversation (the apothecary, the smith,
// the traveling salesman, Bram's counter, Nell's furnishings). A cabinet of the fight bar's dark timber: the keeper's
// name carved over the top with their face and their last word, what you hold under it, then a shelf for each kind of
// thing they sell. Every thing stands on its plank in a pool of lamplight, with a paper tag hung under it that says
// what it is and what it costs.
//
// Pointing at a thing lifts it and brings up a card beside the cabinet with all there is to know about it. Clicking
// (or tapping) it puts it on the counter at the cabinet's foot, where it is bought, and haggled over where the keeper
// allows. A purchase rings the coins and the thing hops on its shelf.
//
// The panel is a DragPanel with `pub-bar`, so a conversation frames the two of you beside it (useConversation).
// What can be bought is worked out by each shop: this only lays it out and greys out what it is told to.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { sounds } from "./audio/gameSounds";
import { DragPanel } from "./DragPanel";
import { uiZoom } from "./uiScale";
import "./shelf.css";

/** One thing on a shelf. */
export interface ShelfWare {
  key: string;
  name: string;
  /** Its rarity's colour or its own: the glow it stands in, the band on its tag and its name on the card. */
  color?: string;
  /** Its picture, about 64px. */
  art: ReactNode;
  /** The picture fills its own square (a gem, not a little flask in the middle of one): shown at its size, not enlarged. */
  full?: boolean;
  /** On the tag under its name: the price, or what it takes. */
  tag: ReactNode;
  /** A ribbon on its corner: "Better", "L3". */
  corner?: ReactNode;
  /** A seal on the tag's corner: "−20%". */
  seal?: string;
  /** A few words on what it is, for the counter (and the card, without `detail`). */
  brief?: ReactNode;
  /** The card's whole body, in place of the brief: a piece of gear's full detail. */
  detail?: ReactNode;
  /** Short facts beside its name: "You carry 1", "3 left today". */
  facts?: string[];
  /** Stamped across it when it cannot be had: "Sold out", "Yours". */
  stamp?: string;
  /** The stamp says it is already yours (in green, the thing still lit), not that it is gone. */
  owned?: boolean;
  /** Why it cannot be bought now (said in red on the card and the counter). */
  problem?: string | null;
  /** The counter's button. `run` resolves true when it went through, and the thing hops. */
  act?: { label: string; title?: string; disabled?: boolean; run(): Promise<boolean> };
  /** More at the counter, under the button: haggling. */
  more?: ReactNode;
}

export interface Shelf {
  id: string;
  title: string;
  sub?: string;
  wares: ShelfWare[];
  /** Said on the shelf when there is nothing on it. */
  empty?: string;
  /** Something of the keeper's own in place of a row of wares (the Lapidary's bench). */
  body?: ReactNode;
}

export interface ShelfKeeper {
  name: string;
  trade: string;
  /** Their face, as an image URL (regularFace). */
  face?: string;
}

export interface Said {
  text: string;
  tone: "good" | "bad" | "plain";
}

/** How wide a place on a shelf is, at the least. */
const SLOT_MIN = 108;
/** How wide the card beside the cabinet is (shelf.css). */
const CARD_W = 280;

export function ShopShelf({ id, title, keeper, says, said, purse, shelves, notes, loading, onDone, doneLabel = "Step away", className = "" }: {
  /** The DragPanel's id: where it was left is remembered by it. */
  id: string;
  /** The panel's title, shown when it is folded. */
  title: string;
  keeper: ShelfKeeper;
  /** What they say when nothing has happened yet. */
  says: string;
  /** What they said about the last thing done, or what went wrong. */
  said: Said | null;
  /** What you hold, under their name (nothing to hold, nothing shown but the way back). */
  purse: ReactNode;
  shelves: Shelf[];
  /** Small print at the foot of the cabinet. */
  notes?: ReactNode;
  /** Said in place of the shelves until they are known. */
  loading?: string | null;
  onDone(): void;
  doneLabel?: string;
  className?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; top: number; left: boolean } | null>(null);
  /** The shelf scrolled to from the tabs along the top. */
  const [at, setAt] = useState<string | null>(null);
  /** The thing just bought, while it hops. */
  const [hop, setHop] = useState<{ key: string; n: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cabinet = useRef<HTMLDivElement>(null);
  const cols = useColumns(cabinet);

  const all = shelves.flatMap((s) => s.wares);
  const pickedWare = all.find((w) => w.key === picked) ?? null;
  const hoverWare = hover ? all.find((w) => w.key === hover.key) ?? null : null;
  // Gone from the shelf (sold off a day's table, say): off the counter too.
  useEffect(() => {
    if (picked && !pickedWare) setPicked(null);
  }, [picked, pickedWare]);

  /** The card goes beside the cabinet, level with the thing pointed at; to its left if there is no room on its right. */
  const point = (key: string, el: HTMLElement) => {
    const panel = root.current?.closest<HTMLElement>(".draggable");
    if (!panel) return;
    const z = uiZoom();
    const p = panel.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const left = p.right + (CARD_W + 24) * z > innerWidth;
    // (Kept from running off the bottom of the cabinet.)
    setHover({ key, top: Math.max(0, Math.min((b.top - p.top) / z - 6, p.height / z - 240)), left });
  };

  const act = async (w: ShelfWare) => {
    if (!w.act) return;
    const ok = await w.act.run();
    if (!ok) return;
    sounds.table("coins");
    setHop((h) => ({ key: w.key, n: (h?.n ?? 0) + 1 }));
  };
  useEffect(() => {
    if (!hop) return;
    const t = setTimeout(() => setHop(null), 1200);
    return () => clearTimeout(t);
  }, [hop]);

  let order = 0;
  return (
    <DragPanel id={id} title={title} className={`story panel pub-bar shop-shelf ${className}`}>
      <div className="shelf-root" ref={root} onPointerLeave={() => setHover(null)}>
        <header className="shelf-crown">
          {keeper.face && <span className="shelf-face"><img src={keeper.face} alt="" /></span>}
          <div className="shelf-who">
            <h3 className="shelf-name">{keeper.name}</h3>
            <span className="shelf-trade">{keeper.trade}</span>
            <p className={`shelf-says ${said?.tone ?? ""}`} role="status" key={said?.text ?? "says"}>{said ? said.text : `“${says}”`}</p>
          </div>
        </header>
        <div className="shelf-purse">
          <span className="shelf-hold">{purse}</span>
          <button className="small shelf-away" onClick={onDone} title="Put the shop away">{doneLabel}</button>
        </div>

        {/* Many shelves: a tab for each along the top, to go straight to it. */}
        {!loading && shelves.length > 3 && (
          <nav className="shelf-jump" aria-label="Shelves">
            {shelves.map((s) => (
              <button
                key={s.id}
                className={`small ${at === s.id ? "selected" : ""}`}
                onClick={() => {
                  setAt(s.id);
                  const el = cabinet.current?.querySelector<HTMLElement>(`[data-shelf="${s.id}"]`);
                  if (el && cabinet.current) cabinet.current.scrollTo({ top: el.offsetTop - 4, behavior: "smooth" });
                }}
              >
                {s.title}
              </button>
            ))}
          </nav>
        )}

        <div className="shelf-cabinet" ref={cabinet} tabIndex={-1} onScroll={() => setHover(null)} style={{ "--cols": cols } as CSSProperties}>
          {loading && <p className="shelf-loading">{loading}</p>}
          {!loading && shelves.map((s) => (
            <section key={s.id} className="shelf" data-shelf={s.id}>
              <h4 className="shelf-sign">
                <span>{s.title}</span>
                {s.sub && <small>{s.sub}</small>}
              </h4>
              {s.body ? <div className="shelf-body">{s.body}</div> : s.wares.length === 0 ? <p className="shelf-bare">{s.empty ?? "Nothing on this shelf today."}</p> : (
                <ul className="shelf-row">
                  {s.wares.map((w) => (
                    <Slot
                      key={w.key}
                      ware={w}
                      order={order++}
                      picked={picked === w.key}
                      hop={hop?.key === w.key ? hop.n : 0}
                      onPick={() => setPicked(picked === w.key ? null : w.key)}
                      onPoint={(el) => point(w.key, el)}
                      onLeave={() => setHover(null)}
                    />
                  ))}
                  {/* The rest of the last plank, so every shelf runs the cabinet's width. */}
                  {Array.from({ length: (cols - (s.wares.length % cols)) % cols }, (_, i) => <li key={`gap${i}`} className="shelf-slot gap" aria-hidden><span className="ss-plank" /></li>)}
                </ul>
              )}
            </section>
          ))}
          {notes && <div className="shelf-notes">{notes}</div>}
        </div>

        {/* (Nothing on any shelf, as with the galley's cook: no counter either.) */}
        {(all.length > 0 || loading) && <Counter ware={pickedWare} hop={!!pickedWare && hop?.key === pickedWare.key} onAct={act} />}

        {hoverWare && hover && (
          <aside className={`shelf-card ${hover.left ? "left" : ""}`} style={{ top: hover.top, "--c": hoverWare.color ?? "#e3b757" } as CSSProperties} aria-hidden>
            {hoverWare.detail ?? (
              <>
                <h4 className="sc-name">{hoverWare.name}</h4>
                {hoverWare.facts && hoverWare.facts.length > 0 && <p className="sc-facts">{hoverWare.facts.join(" · ")}</p>}
                {hoverWare.brief && <p className="sc-brief">{hoverWare.brief}</p>}
              </>
            )}
            <div className="sc-foot">
              <span className="sc-tag">{hoverWare.stamp ?? hoverWare.tag}</span>
              {hoverWare.problem && !hoverWare.stamp && <span className="sc-problem">{hoverWare.problem}</span>}
              {!hoverWare.stamp && hoverWare.act && <span className="sc-hint">Click to put it on the counter</span>}
            </div>
          </aside>
        )}
      </div>
    </DragPanel>
  );
}

function Slot({ ware: w, order, picked, hop, onPick, onPoint, onLeave }: { ware: ShelfWare; order: number; picked: boolean; hop: number; onPick(): void; onPoint(el: HTMLElement): void; onLeave(): void }) {
  return (
    <li className={`shelf-slot ${w.stamp ? (w.owned ? "out owned" : "out") : ""} ${picked ? "picked" : ""} ${w.problem && !w.stamp ? "short" : ""} ${hop ? "hopping" : ""}`} style={{ "--c": w.color ?? "#e3b757", "--i": order } as CSSProperties} data-ware={w.key}>
      <button
        className="ss-thing"
        aria-pressed={picked}
        aria-label={`${w.name}${w.stamp ? `, ${w.stamp.toLowerCase()}` : ""}`}
        onClick={onPick}
        onPointerEnter={(e) => e.pointerType === "mouse" && onPoint(e.currentTarget)}
        onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && onPoint(e.currentTarget)}
        onBlur={onLeave}
      >
        <span className="ss-stage">
          <span className="ss-glow" aria-hidden />
          <span className={`ss-art ${w.full ? "full" : ""}`} key={hop || undefined}>{w.art}</span>
          {hop > 0 && <span className="ss-burst" key={`b${hop}`} aria-hidden><i /><i /><i /><i /><i /><i /></span>}
          {w.corner && <span className="ss-corner">{w.corner}</span>}
          {w.stamp && <span className="ss-stamp">{w.stamp}</span>}
        </span>
        <span className="ss-plank" aria-hidden />
        <span className="ss-hang">
          <span className="ss-tag">
            {/* (Two lines' room whatever the name, so every tag is the same height.) */}
            <span className="ss-tag-name"><span>{w.name}</span></span>
            <span className="ss-tag-price">{w.tag}</span>
          </span>
          {w.seal && <span className="ss-seal">{w.seal}</span>}
        </span>
      </button>
    </li>
  );
}

/** The thing picked off the shelf, at the cabinet's foot: what it is, what it costs, and the button to have it. */
function Counter({ ware: w, hop, onAct }: { ware: ShelfWare | null; hop: boolean; onAct(w: ShelfWare): void }) {
  if (!w) return <div className="shelf-counter idle"><span>Pick something off the shelf to look it over.</span></div>;
  return (
    <div className={`shelf-counter ${hop ? "hop" : ""} ${w.owned ? "owned" : ""}`} key={w.key} style={{ "--c": w.color ?? "#e3b757" } as CSSProperties}>
      <span className="sc-art" aria-hidden>{w.art}</span>
      <div className="sc-body">
        <h4 className="sc-name">{w.name}</h4>
        {w.facts && w.facts.length > 0 && <p className="sc-facts">{w.facts.join(" · ")}</p>}
        {w.brief && <p className="sc-brief">{w.brief}</p>}
        {w.problem && !w.stamp && <p className="sc-problem">{w.problem}</p>}
      </div>
      <div className="sc-buy">
        {w.stamp ? <span className="sc-out">{w.stamp}</span> : <span className="sc-price">{w.tag}</span>}
        {w.act && !w.stamp && (
          <button className="primary sc-act" disabled={w.act.disabled} title={w.act.title} onClick={() => onAct(w)}>{w.act.label}</button>
        )}
      </div>
      {w.more && <div className="sc-more">{w.more}</div>}
    </div>
  );
}

/** How many things a shelf holds across: as many as fit at SLOT_MIN, read again as the cabinet changes width. */
function useColumns(ref: RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 24;
      if (w > 0) setCols(Math.max(2, Math.min(6, Math.floor(w / SLOT_MIN))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}
