// The bottom bar: the one fixed piece of HUD every view shares. It is a
// board of the same tarred, lamplit timber as the fight's turn bar and the
// shops' shelves (zone/fight.css, shelf.css), trimmed in dull brass:
//
//                 where you stand .... what to do here
//        o o o          points          o o o o
//   +------------------------------------------------------------+
//   |L| [hand][hand] | [= health =] (Lv 7) [= energy =] | [bag] |I|
//   |R|              | [ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]   |       |*|
//   | |              | [ ][ ][ ][ ][ ][ ][ ][ ][ ][ ]   |       | |
//   | |              | ========= experience =========== |       | |
//   +------------------------------------------------------------+
//
// Left: what is in each hand. In the middle: health, a plaque with the
// hero's level (it opens the logbook) and energy (gathering outings left
// today), the slots under them, and the experience bar along the foot.
// Right: the bag. Small tabs at each end: the logbook and rest (or the emote
// wheel) on the left, the bag's key and the menu on the right. A view may hand
// the bar a turn (`turn`: the plaque is then its clock, pressed to end it) and
// points to show as pips over it (`pips`); none does now, a fight on the
// tiles having a turn bar of its own (zone/TurnBar.tsx). Nothing on the bar
// is labelled: pointing at a thing brings up a card over the bar saying what
// it is (a meter's numbers, an item's card as in the bag, what an ability
// does, a key).
//
// The slots are only there on a map (a zone), which hands them in as `slots`:
// two rows of ten, each something the hero can do in a fight (an ability, a
// common action, a thing from the pack), a button with its key (1 to 9 and 0
// for the top row, Shift with them for the bottom). Drag one onto another to
// swap them; a right-click chooses what goes there; the layout is kept per
// class (zone/hotbar.ts). Anywhere else (the Harbor, a hut, the pub, a shop)
// there is nothing to fight, so the bar is slim: one row, the meters and the
// experience between the hands and the bag.
//
// I (or B) opens and closes the bag and L opens the logbook, unless you are
// typing. The bag's button does the same: press it again to put the bag away.

import { Children, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { dragSource, useDropTarget } from "../dragDrop";
import { ITEM_AP, RARITY_COLOR, loadoutOf, maxHpFor, xpToNext } from "@gantt-quest/world";
import { api, type Me } from "../api";
import { Icon, ItemDetail, toOwned } from "../items";
import { PixelIcon } from "../PixelIcon";
import { LiquidMeter } from "./LiquidMeter";
import { ITEM_ICON } from "../zone/actionIcons";
import { logbookNews } from "../Logbook";
import { BAR_ROW } from "../zone/hotbar";
import "./hud.css";

/** A campfire: rest. */
const FIRE = ["....#.....", "....##....", "...###.#..", "..####.##.", "..#######.", ".###.####.", ".##...###.", "..##.###..", "#..####..#", ".########.", "#........#"];
const HOURGLASS = ["########", ".#....#.", ".######.", "..####..", "...##...", "..#..#..", ".#.##.#.", ".######.", "########"];

/** A row of turn points: lit for those left, dark for those spent. */
export interface HudPips {
  label: string;
  now: number;
  max: number;
  kind: "ap" | "move" | "course";
  /** Said in the tooltip in place of "now of max left". */
  title?: string;
}

/** One of the nine slots, when the view fills them itself: something the hero can do now, by button or number key. */
export interface HudSlot {
  id: string;
  /** Its picture in the well (a name and accent colour from the item art); `flat` draws it as a flat glyph, not a little model. */
  icon: { name: string; color: string; flat?: boolean };
  name: string;
  /** What it costs and reaches, for the tooltip; and more about it. */
  line?: string;
  more?: string;
  /** How many are left of something that runs out. */
  count?: number;
  /** Turns until it can be used again. */
  wait?: number;
  /** Picked: waiting for its target. */
  picked?: boolean;
  /** Cannot be used right now: too few AP left, on cooldown, none to throw. */
  spent?: boolean;
  run?(): void;
}

/** The meter on the right, across from health. Energy unless a view says otherwise. */
export interface HudMeter {
  /** What it counts, and (in `note`) a few words more, for its tooltip. */
  name: string;
  note?: string;
  now: number;
  max: number;
  kind: "focus" | "stamina";
}

interface Props {
  me: Me;
  /** One short line on where the hero stands, over the bar. */
  place?: ReactNode;
  /** The button for what can be done here. */
  children?: ReactNode;
  /** Hit points right now; omitted anywhere but on a map, where the hero is whole. `shield`: points of shield (Bolstered), shown after the HP. */
  hp?: { now: number; max: number; shield?: number };
  /** What the right-hand meter counts here. Left out, it is the hero's energy, read by the bar itself. */
  meter?: HudMeter;
  pips?: HudPips[];
  /** Small extras beside the points: "connecting…" while a place's connection is down, the keys held on a map. */
  chips?: ReactNode;
  /** The slots, on a map: two rows of ten, null for an empty one. Left out, the bar is slim, with no slots. */
  slots?: (HudSlot | null)[];
  /** The player dragged slot `from` onto slot `to`. */
  onSlotMove?(from: number, to: number): void;
  /** The player asked to choose what goes in a slot (a right-click, or a click on an empty one). */
  onSlotMenu?(index: number): void;
  /**
   * On a map, either hand can hold a lit torch (in the main hand it is swung as a weapon): rounds of light left on
   * the one held (null with none) and which hand it is in, how many are carried, `light` to light one into a
   * hand, and `stow` to put the one held out and back in the pack (each absent when it cannot be done now; `why`
   * says why).
   */
  torch?: { rounds: number | null; hand: "main" | "off"; carried: number; light?(hand: "main" | "off"): void; stow?(): void; why?: string };
  /** The turn: seconds left on it (null with no clock), and ending it when it is yours. */
  turn?: { seconds: number | null; onEnd?(): void; waitingFor?: string };
  /** Resting, where it can be done. */
  rest?: { run(): void; hint: string; disabled?: boolean };
  /** The emote wheel's button (EmoteWheel), in the lower tab off the left end: only where there is no resting (on a map, in a fight). */
  emote?: ReactNode;
  onBag?(): void;
  /** Why the bag cannot be opened right now. */
  bagBlocked?: string;
  onBook?(): void;
  /** The game menu's cog (an OptionsMenu). */
  menu: ReactNode;
}

const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");

/** A tooltip's words: what the thing is, a line about it, more if there is more, and the key that works it. */
function Tip({ name, line, more, keys }: { name: string; line?: string; more?: string; keys?: string }) {
  return (
    <div className="hud-tip-text">
      <strong>{name}{keys && <kbd>{keys}</kbd>}</strong>
      {line && <span>{line}</span>}
      {more && <span className="muted">{more}</span>}
    </div>
  );
}

export function HudBar({ me, place, children, hp, meter: given, pips = [], chips, slots, onSlotMove, onSlotMenu, torch, turn, rest, emote, onBag, bagBlocked, onBook, menu }: Props) {
  const c = me.character;
  // The pack is read out of its stored form (each row's JSON) when it changes, not every time the bar is drawn.
  const items = useMemo(() => me.inventory.map(toOwned), [me.inventory]);
  const worn = items.filter((i) => i.equipped);
  const weapon = worn.find((i) => i.slot === "main_hand");
  const offhand = worn.find((i) => i.slot === "off_hand");

  /** What the pointer is over on the bar, and where along it (in the board's own pixels), for the card that explains it. */
  const [tip, setTip] = useState<{ x: number; node: ReactNode } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const hover = (node: ReactNode) => ({
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      const el = board.current;
      if (!el) return;
      const at = el.getBoundingClientRect();
      const thing = e.currentTarget.getBoundingClientRect();
      // The view may be zoomed (the UI scale): measured on the screen, placed in the board's own pixels.
      const zoom = at.width / (el.offsetWidth || at.width);
      setTip({ x: (thing.left + thing.width / 2 - at.left) / zoom, node });
    },
    onPointerLeave: () => setTip(null),
    onPointerDown: () => setTip(null),
  });

  // Energy (gathering outings left today) is always on the right. A view that keeps its own count (the Harbor, a
  // hut) hands it in, fresh after each outing or rest; anywhere else the bar reads it once, on the way in.
  const [energy, setEnergy] = useState<{ left: number; max: number } | null>(null);
  const heroId = me.character ? me.player.id : null;
  useEffect(() => {
    if (given || !heroId) return;
    let live = true;
    api.energy().then((e) => live && setEnergy(e)).catch(() => {});
    return () => {
      live = false;
    };
  }, [!!given, heroId]);
  const meter: HudMeter | undefined = given ?? (energy ? { name: "Energy", note: "gathering outings left today", now: energy.left, max: energy.max, kind: "stamina" } : undefined);

  // The newest slots, for the key handler, which is not rebound each time they change.
  const slotsNow = useRef(slots);
  slotsNow.current = slots;

  // How much of the bottom of the screen the bar takes (its board and the pips over it, not the "here" strip), as
  // --hud-h on the page: whatever a view floats over the bottom (a minigame's controls) sits clear above it.
  // --hud-all-h is the same with the "here" strip counted in: what must clear that as well (the talk).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const shown = [...el.children].filter((k) => k.getBoundingClientRect().height > 0);
      const tops = shown.filter((k) => !k.classList.contains("hud-here")).map((k) => k.getBoundingClientRect().top);
      if (tops.length === 0) return;
      const all = shown.map((k) => k.getBoundingClientRect().top);
      document.documentElement.style.setProperty("--hud-h", `${Math.max(0, Math.round(innerHeight - Math.min(...tops)))}px`);
      document.documentElement.style.setProperty("--hud-all-h", `${Math.max(0, Math.round(innerHeight - Math.min(...all)))}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      removeEventListener("resize", measure);
      document.documentElement.style.removeProperty("--hud-h");
      document.documentElement.style.removeProperty("--hud-all-h");
    };
  }, [c === null, !!slots]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ((k === "b" || k === "i") && onBag && !bagBlocked) onBag();
      if (k === "l" && onBook) onBook();
      // A map's slots answer to their numbers, 1 to 9 and then 0: the top row plain, the bottom row with Shift.
      const digit = /^Digit([0-9])$/.exec(e.code)?.[1];
      const col = digit === undefined ? -1 : (Number(digit) + 9) % 10;
      const slot = col >= 0 && col < BAR_ROW ? slotsNow.current?.[col + (e.shiftKey ? BAR_ROW : 0)] : undefined;
      if (slot?.run && !slot.spent) slot.run();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onBag, onBook, bagBlocked]);

  // Dragging one slot of the bar onto another swaps them; the torch dragged onto a hand lights one there.
  // What the slots hold is only known further down, so the targets read it from here when something is dropped.
  const rack = useRef<{ shown: (HudSlot | null)[]; move(from: number, to: number): void; light?: (hand: "main" | "off") => void }>({ shown: [], move: () => {} });
  const slotDrop = useDropTarget(
    (thing, el) => thing.kind === "slot" && Number(el.dataset.rack) !== thing.index,
    (thing, el) => thing.kind === "slot" && rack.current.move(thing.index, Number(el.dataset.rack)),
  );
  const handDrop = useDropTarget(
    (thing) => thing.kind === "slot" && rack.current.shown[thing.index]?.id === "it:torch" && !!rack.current.light,
    (thing, el) => rack.current.light?.(el.dataset.hand === "off" ? "off" : "main"),
  );
  /** A slot as something to drag: pressing it also hides its tip. */
  const slotDrag = (i: number) => {
    const d = dragSource({ kind: "slot", index: i }, { onLift: () => setTip(null) });
    return { ...d, onPointerDown: (e: ReactPointerEvent<HTMLElement>) => (setTip(null), d.onPointerDown?.(e)) };
  };
  if (!c) return <div className="hud slim" ref={root}><div className="hud-rack"><span className="hud-caps">{children}{menu}</span></div></div>;

  /**
   * A hand's slot: what it holds, with its card. On a map, a lit torch there (a click puts it away, and what was
   * in the hand is taken up again); or, carrying torches, the bar's torch dropped on it lights one into it. A
   * plain click never does: it put the weapon away unasked, and in a fight left it out of reach till the next turn.
   */
  const handSlot = (hand: "main" | "off") => {
    const worn = hand === "main" ? weapon : offhand;
    const slot = hand === "main" ? "main_hand" : "off_hand";
    if (torch && torch.rounds !== null && torch.hand === hand) {
      const line = hand === "main" ? `${torch.rounds} rounds of light left. Swung as a weapon: it may set whoever it hits Burning. Your weapon is put away while you hold it.` : `${torch.rounds} rounds of light left.${offhand ? " Your shield is set aside while you hold it." : ""}`;
      const back = worn ? `take up your ${worn.name} again` : "free the hand";
      const away = torch.stow ? `Click to put it out, stow it in your pack and ${back}. ${ITEM_AP.stow} AP in a fight.` : `${torch.why ?? "You cannot put it away now."} Putting it away takes ${ITEM_AP.stow} AP in a fight.`;
      return (
        <button
          key={slot}
          className={`hud-slot hand lit ${torch.stow ? "" : "spent"}`}
          aria-label={`Put away the lit torch in your ${hand} hand`}
          aria-disabled={!torch.stow}
          onClick={() => torch.stow?.()}
          {...hover(<Tip name="Lit torch" line={line} more={`${away} It burns down only while a fight goes on. Throw it from the bar to leave it burning on the ground.`} />)}
        >
          <Icon name={ITEM_ICON.torch.name} color={ITEM_ICON.torch.color} size={34} />
          <span className="hud-count">{torch.rounds}</span>
        </button>
      );
    }
    const card = worn ? <ItemDetail item={worn} equipped classId={c.class_id} level={c.level} /> : hand === "main" ? <Tip name="Nothing in hand" line="Bare fists: all you can do in a fight is punch." /> : <Tip name="Off hand" line="Empty." />;
    if (torch && torch.rounds === null && torch.carried > 0) {
      // What the hand holds, as anywhere else; and the bar's torch dragged here lights one into it.
      const what = hand === "main" ? "swing it as a weapon (your weapon put away; it may set whoever it hits Burning)" : `hold it up${offhand ? " (your shield set aside)" : ""}`;
      const hint = torch.light ? `Drag the torch here from the bar to light one and ${what}. ${ITEM_AP.light} AP in a fight.` : (torch.why ?? "You cannot light one now.");
      return (
        <span key={slot} className="hud-slot hand" data-hand={hand} {...handDrop} {...hover(<>{card}<Tip name="A torch" line={hint} more={`${torch.carried} carried.`} /></>)}>
          {worn && <Icon name={worn.icon} color={RARITY_COLOR[worn.rarity]} size={40} />}
        </span>
      );
    }
    return (
      <span key={slot} className="hud-slot hand" {...hover(card)}>
        {worn && <Icon name={worn.icon} color={RARITY_COLOR[worn.rarity]} size={40} />}
      </span>
    );
  };

  const shown = slots ?? [];
  rack.current = { shown, move: (from, to) => onSlotMove?.(from, to), light: torch?.light };

  const bonus = loadoutOf(worn).bonus;
  const stats = { str: c.str + (bonus.str ?? 0), int_stat: c.int_stat + (bonus.int_stat ?? 0), vit: c.vit + (bonus.vit ?? 0), agi: c.agi + (bonus.agi ?? 0), dex: c.dex + (bonus.dex ?? 0) };
  const maxHp = hp?.max ?? maxHpFor(stats, c.level);
  const nowHp = hp?.now ?? maxHp;
  const next = xpToNext(c.level);
  const news = logbookNews(c);
  const pipRow = (p: HudPips) => (
    <span key={p.label} className={`hud-pips ${p.kind}`} title={p.title ?? `${p.label}: ${p.now} of ${p.max} left`}>
      {Array.from({ length: Math.max(p.max, p.now) }, (_, i) => <i key={i} className={i < p.now ? "on" : ""} />)}
    </span>
  );

  /** One of a map's slots: what the hero can do, a button with its key; any of them can be dropped on and asked to hold something else. */
  const slotButton = (s: HudSlot | null, i: number) => {
    const lower = i >= BAR_ROW;
    const digit = ((i % BAR_ROW) + 1) % 10;
    const keys = `${lower ? "Shift " : ""}${digit}`;
    const arrange = {
      "data-rack": i,
      ...slotDrop,
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        onSlotMenu?.(i);
      },
    };
    if (!s) {
      return <button key={`empty${i}`} className="hud-slot act empty" aria-label={`Empty slot ${keys}`} onClick={() => onSlotMenu?.(i)} {...arrange} {...hover(<Tip name="Empty slot" line={onSlotMenu ? "Click to choose what goes here." : "Drag a slot here to move it."} more={onSlotMenu ? "Drag a slot onto another to swap them; right-click one to change it." : undefined} keys={keys} />)} />;
    }
    return (
      <button
        key={s.id}
        className={`hud-slot act ${s.picked ? "picked" : ""} ${s.spent ? "spent" : ""} ${s.wait ? "cooling" : ""}`}
        aria-label={s.name}
        aria-pressed={!!s.picked}
        aria-disabled={!s.run || !!s.spent}
        onClick={() => !s.spent && s.run?.()}
        {...arrange}
        {...hover(<Tip name={s.name} line={s.line} more={s.more} keys={keys} />)}
        {...slotDrag(i)}
      >
        <Icon name={s.icon.name} color={s.icon.color} size={30} flat={s.icon.flat} />
        {s.wait ? <span className="hud-wait" aria-label={`${s.wait} turn${s.wait === 1 ? "" : "s"} to wait`}>{s.wait}</span> : s.count !== undefined && <span className="hud-count">{s.count}</span>}
        <span className="hud-key">{lower ? "⇧" : ""}{digit}</span>
      </button>
    );
  };

  return (
    <div className={`hud ${slots ? "full" : "slim"}`} ref={root} role="toolbar" aria-label="Your hero">
      {(place || Children.toArray(children).length > 0) && (
        <div className="hud-here">
          {place && <span className="hud-place">{place}</span>}
          {children}
        </div>
      )}

      <div className="hud-points">
        <span className="hud-points-side">{pips.map(pipRow)}</span>
        <span className="hud-points-side end">{chips}</span>
      </div>

      <div className="hud-rack" ref={board} onPointerLeave={() => setTip(null)}>
        {/* The tabs off the left end: the logbook, and rest (or, on a map, the emote wheel). */}
        <span className="hud-tabs">
          <button className={`hud-tab ${news ? "news" : ""}`} aria-label="Logbook" disabled={!onBook} onClick={onBook} {...hover(<Tip name="Logbook" line={news ? "Something to spend or pick" : "Your hero, stats and skills"} keys="L" />)}>L</button>
          {rest && (
            <button className="hud-tab" aria-label="Rest" disabled={rest.disabled} onClick={rest.run} {...hover(<Tip name="Rest" line={rest.hint} />)}>
              <PixelIcon rows={FIRE} size={11} />
            </button>
          )}
          {!rest && emote && (
            <span className="hud-tab emote" {...hover(<Tip name="Emotes" line="Wave, cheer, bow, dab, floss, dance, do the running man, breakdance or sit down. It costs nothing and takes no turn." keys="G" />)}>
              {emote}
            </span>
          )}
        </span>

        {/* Weapon and shield, each with the card it has in the bag. On a map either hand can take a lit torch instead. */}
        <span className="hud-hands">
          {handSlot("main")}
          {handSlot("off")}
        </span>

        <span className="hud-core">
          {/* Health, the plaque, and energy. Their numbers are in their tooltips. */}
          <span className="hud-gauges">
            <span className="hud-meter" {...hover(<Tip name="Health" line={`${nowHp} of ${maxHp} hit points${hp?.shield ? `, and a shield of ${hp.shield}` : ""}`} />)}>
              <LiquidMeter kind="hp" now={nowHp} max={maxHp} shield={hp?.shield} w={60} h={4} />
            </span>
            {turn ? (
              <button
                className={`hud-plaque turn ${turn.onEnd ? "mine" : ""} ${turn.seconds !== null && turn.seconds <= 15 ? "low" : ""}`}
                aria-label={turn.onEnd ? "End turn" : "Waiting"}
                disabled={!turn.onEnd}
                onClick={turn.onEnd}
                {...hover(<Tip name={turn.onEnd ? "End your turn" : `Waiting for ${turn.waitingFor ?? "the others"}`} line={turn.seconds !== null ? `${turn.seconds} seconds left on the turn` : undefined} />)}
              >
                <PixelIcon rows={HOURGLASS} size={12} />
                {turn.seconds !== null ? <span>{turn.seconds}</span> : <span>{turn.onEnd ? "End" : "…"}</span>}
              </button>
            ) : (
              <button className={`hud-plaque ${news ? "news" : ""}`} aria-label="Logbook" disabled={!onBook} onClick={onBook} {...hover(<Tip name={`${c.name}, level ${c.level}`} line={news ? "Something to spend or pick in the logbook" : "Open the logbook"} keys="L" />)}>
                <small>Lv</small>
                <span>{c.level}</span>
              </button>
            )}
            {meter ? (
              <span className="hud-meter" {...hover(<Tip name={meter.name} line={`${meter.now} of ${meter.max}${meter.note ? ` · ${meter.note}` : ""}`} />)}>
                <LiquidMeter kind={meter.kind} now={meter.now} max={meter.max} w={60} h={4} />
              </span>
            ) : (
              <span className="hud-meter none" aria-hidden />
            )}
          </span>

          {/* On a map: what the hero can do, two rows of ten. */}
          {slots && <span className="hud-slots" style={{ "--cols": BAR_ROW } as CSSProperties}>{shown.slice(0, BAR_ROW * 2).map(slotButton)}</span>}

          <span className="hud-xp" {...hover(<Tip name="Experience" line={`${c.xp} of ${next} to level ${c.level + 1}`} />)}>
            <i style={{ width: `${(100 * c.xp) / next}%` }} />
          </span>
        </span>

        {/* The bag. */}
        <button
          className="hud-slot bag"
          aria-label="Sea bag"
          disabled={!onBag || !!bagBlocked}
          onClick={onBag}
          {...hover(<Tip name="Sea bag" line={bagBlocked ?? `${c.gold} gold${me.carry ? ` · ${me.carry.carried} of ${me.carry.limit} squares filled` : ""}`} keys="I" />)}
        >
          {/* The sea bag itself, as a thing: drawn in the round like everything that goes in it. */}
          <Icon name="sea-bag" color="#e0b12e" size={40} />
        </button>

        {/* The tabs off the right end: the bag's key and the menu. */}
        <span className="hud-tabs">
          <button className="hud-tab" aria-label="Sea bag" disabled={!onBag || !!bagBlocked} onClick={onBag} {...hover(<Tip name="Sea bag" line={bagBlocked} keys="I" />)}>I</button>
          <span className="hud-tab cog" {...hover(<Tip name="Menu" line="Settings, your account and the way out" keys="Esc" />)}>{menu}</span>
        </span>

        {/* What the pointer is over, explained: a card over the bar, above that thing. */}
        {tip && <div className="hud-tip panel" style={{ left: `clamp(150px, ${tip.x}px, calc(100% - 150px))` }} role="tooltip">{tip.node}</div>}
      </div>
    </div>
  );
}

/** For views (or moments) with no bottom bar: the cog and a few chips, tucked into the top-right corner. */
export function HudCorner({ children, menu }: { children?: ReactNode; menu: ReactNode }) {
  return <div className="hud-corner">{children}{menu}</div>;
}
