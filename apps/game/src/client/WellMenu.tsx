// The town well's card, hung over the well in the Harbor while a hero stands at it: fill a watering can, fill a
// water skin (each lowers the bucket into the water and winds it back up), or toss in a coin for luck on the next
// map, with now and then a gem or some XP back out of the well.

import { useEffect, useRef, useState, type RefObject } from "react";
import { CAN_CAPACITY, HARBOR_WELL_AT, LUCK_MAX, WELL_SKINS, WISHES_PER_DAY, WISH_COST } from "@gantt-quest/world";
import { api } from "./api";
import { Icon } from "./items";
import type { WorldRenderer } from "./render/WorldRenderer";
import { GOLD_ICON, ThingIcon } from "./thingIcons";
import { ITEM_ICON } from "./zone/actionIcons";
import { uiZoom } from "./uiScale";
import type { WellView } from "../server/well";
import "./garden.css";

/** How long the bucket takes to go down and come back up (townDressing.ts), and a coin to reach the water. */
const DRAW_MS = 2500;
const COIN_MS = 800;

export function WellMenu({ renderer, onClose, onChanged }: {
  renderer: RefObject<WorldRenderer | null>;
  onClose(): void;
  /** Gold, the pack or XP changed. */
  onChanged(): void;
}) {
  const [view, setView] = useState<WellView | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: "good" | "bad" | "gift" } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const load = () => api.well().then(setView, (e: Error) => setSaid({ text: e.message, tone: "bad" }));
  useEffect(() => {
    void load();
    // The well in the middle of the view, so the bucket going down and a coin going in can be seen.
    renderer.current?.lookAt(HARBOR_WELL_AT);
  }, []);

  // Hung over the well, following the camera.
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const el = wrap.current;
      if (!el) return;
      const at = renderer.current?.screenAbove(HARBOR_WELL_AT, 2.1) ?? null;
      el.style.visibility = at ? "visible" : "hidden";
      if (!at) return;
      // Over the well, but kept wholly on screen: near an edge it slides along it rather than off it.
      const z = uiZoom();
      const card = el.firstElementChild as HTMLElement | null;
      const box = el.offsetParent?.getBoundingClientRect();
      const w = card?.offsetWidth ?? 0, h = card?.offsetHeight ?? 0;
      const vw = (box?.width ?? innerWidth) / z, vh = (box?.height ?? innerHeight) / z;
      const x = Math.min(Math.max(at.x / z, w / 2 + 8), vw - w / 2 - 8);
      const y = Math.min(Math.max(at.y / z, h + 18), vh - 8);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [renderer]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);

  /** Do something at the well, with the bucket or a coin played first, and say how it went once it has. */
  const act = async (fn: () => Promise<{ text: string; tone?: "good" | "gift" }>, play: () => void, wait: number) => {
    setBusy(true);
    setSaid(null);
    try {
      const done = await fn();
      play();
      await new Promise((r) => setTimeout(r, wait));
      setSaid({ text: done.text, tone: done.tone ?? "good" });
      onChanged();
      await load();
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  const draw = () => renderer.current?.wellDraw();

  const can = view?.can;
  const canWhy = can === null ? "No watering can: the market stall sells them" : can !== undefined && can >= CAN_CAPACITY ? "Your watering can is full" : null;
  const skinWhy = view && view.skins >= WELL_SKINS ? `You carry ${WELL_SKINS} full water skins` : null;
  const coinWhy = !view ? null
    : view.tossed >= WISHES_PER_DAY ? "The well has had your coins today"
    : view.luck >= LUCK_MAX ? "You carry all the luck you can"
    : view.gold < WISH_COST ? "Not enough gold" : null;

  return (
    <div className="well-anchor" ref={wrap}>
      <div className="well-card" role="dialog" aria-label="The town well">
        <header>
          <strong>The Town Well</strong>
          <button className="small" onClick={onClose} aria-label="Close">×</button>
        </header>
        <button
          className="well-option"
          disabled={busy || !view || !!canWhy}
          title={canWhy ?? undefined}
          onClick={() => void act(async () => {
            await api.fillCan();
            return { text: "You fill your watering can to the brim." };
          }, draw, DRAW_MS)}
        >
          <Icon name="watering-can" color="#4f9fd6" size={28} />
          <span>
            <b>Fill your watering can</b>
            <small>{can === null ? "You have none: the market stall sells them" : can === undefined ? "…" : `${can} of ${CAN_CAPACITY} waterings in it`}</small>
          </span>
        </button>
        <button
          className="well-option"
          disabled={busy || !view || !!skinWhy}
          title={skinWhy ?? undefined}
          onClick={() => void act(async () => {
            const res = await api.wellSkin();
            return { text: `A water skin, filled and stoppered: ${res.skins} in your pack.` };
          }, draw, DRAW_MS)}
        >
          <Icon name={ITEM_ICON.water.name} color={ITEM_ICON.water.color} size={28} />
          <span>
            <b>Fill a water skin</b>
            <small>{view ? `${view.skins} of ${WELL_SKINS} carried · thrown on a map, it puts out fire` : "…"}</small>
          </span>
        </button>
        <button
          className="well-option coin"
          disabled={busy || !view || !!coinWhy}
          title={coinWhy ?? undefined}
          onClick={() => void act(async () => {
            const res = await api.wellCoin();
            const luck = `Lucky ×${res.luck} on your next map.`;
            setTimeout(() => renderer.current?.wellCoin(res.gift), 0);
            return res.gift === "gem" ? { text: `The well spits a gem back out at you! ${luck}`, tone: "gift" }
              : res.gift === "xp" ? { text: `A glimmer rises from the water: +${res.xp?.granted ?? 0} XP. ${luck}`, tone: "gift" }
              : { text: `The coin sinks out of sight. ${luck}` };
          }, () => {}, COIN_MS + 400)}
        >
          <ThingIcon icon={GOLD_ICON} size={28} />
          <span>
            <b>Toss in a coin · {WISH_COST}g</b>
            <small>Your rolls to hit on the next map are lucky, one a coin. The well sometimes gives back.</small>
          </span>
        </button>
        {view && (
          <div className="well-luck" title="Each lucky roll gives one roll to hit advantage, on the next map you go out to">
            <span>Luck</span>
            <span className="luck-pips">{Array.from({ length: LUCK_MAX }, (_, i) => <i key={i} className={i < view.luck ? "on" : ""} />)}</span>
            <span className="muted">{view.tossed} of {WISHES_PER_DAY} coins today</span>
          </div>
        )}
        {said && <p className={`well-said ${said.tone}`} key={said.text}>{said.text}</p>}
      </div>
    </div>
  );
}
