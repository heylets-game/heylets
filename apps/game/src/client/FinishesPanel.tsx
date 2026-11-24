// Nell's catalogue, opened from a word with her at her stall beside the market stall: wallpaper, floors and roof
// colours for your hut on her shelves (ShopShelf.tsx), each bought once and yours for good. What you own is put up at
// home, from Decorate.

import { useEffect, useState } from "react";
import { DECORATOR, finishesOf, type FinishKind } from "@gantt-quest/world";
import { api } from "./api";
import { FinishSwatch } from "./FinishSwatch";
import "./finishes.css";
import { regularFace } from "./RegularPanel";
import { ShopShelf, type Said, type Shelf, type ShelfWare } from "./ShopShelf";
import { GOLD_ICON, ThingIcon } from "./thingIcons";

type View = Awaited<ReturnType<typeof api.finishes>>;

/** When her table next changes, in words: "in 5 hours", "in 20 minutes". */
function untilRestock(at: number): string {
  const min = Math.max(1, Math.round((at - Date.now()) / 60_000));
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return `in ${h} hour${h === 1 ? "" : "s"}`;
}

export const FINISH_TABS: { kind: FinishKind; label: string }[] = [
  { kind: "wall", label: "Wallpaper" },
  { kind: "floor", label: "Floors" },
  { kind: "roof", label: "Roofs" },
];

/** The swatch's size on a shelf: a length of wallpaper stands tall, a square of floor and a little house sit square. */
const SHELF_SIZE: Record<FinishKind, number> = { wall: 0.82, floor: 0.9, roof: 1.2 };

export function FinishesPanel({ onClose, refresh }: { onClose(): void; refresh(): unknown }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const load = () => api.finishes().then(setView, (e: Error) => setSaid({ text: e.message, tone: "bad" }));
  useEffect(() => void load(), []);

  const buy = async (id: string, name: string): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      await api.buyFinish(id);
      setSaid({ text: view?.hut ? `${name} is yours. Put it up at home: Decorate, then Walls, floor and roof.` : `${name} is yours, for when you have a hut to put it in.`, tone: "good" });
      await load();
      void refresh();
      return true;
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const shelves: Shelf[] = !view ? [] : FINISH_TABS.map(({ kind, label }) => {
    const today = finishesOf(kind).filter((f) => view.stock.includes(f.id));
    return {
      id: kind,
      title: label,
      sub: kind === "roof" ? "Every colour, every day" : `Today's patterns: ${today.length} of ${finishesOf(kind).length}`,
      wares: today.map((f): ShelfWare => {
        const owned = view.owned.includes(f.id);
        const wearing = view.finish[kind] === f.id;
        const short = !owned && view.gold < f.price;
        return {
          key: f.id,
          name: f.name,
          color: "#e3c88a",
          art: <FinishSwatch kind={kind} id={f.id} size={SHELF_SIZE[kind]} />,
          tag: <span className="keeper-price"><ThingIcon icon={GOLD_ICON} size={16} /><strong>{f.price}g</strong></span>,
          facts: [label.replace(/s$/, ""), owned ? (wearing ? "On your hut" : "Yours for good") : "Yours for good, once bought"],
          brief: f.blurb,
          stamp: owned ? (wearing ? "On your hut" : "Yours") : undefined,
          owned,
          problem: short ? `${f.price} gold, and you have ${view.gold}.` : null,
          act: owned ? undefined : { label: `Buy · ${f.price}g`, title: short ? `${f.price} gold, and you have ${view.gold}` : `Buy for ${f.price} gold, yours for good`, disabled: busy || short, run: () => buy(f.id, f.name) },
        };
      }),
      empty: "Nothing of this out today.",
    };
  });

  return (
    <ShopShelf
      id="harbor.finishes"
      title="Home furnishings"
      className="finishes-shelf"
      keeper={{ name: DECORATOR.name, trade: DECORATOR.trade, face: regularFace(DECORATOR.look) }}
      says="Buy it once and it's yours for good. I put out different patterns every day, so look again tomorrow."
      said={said}
      onDone={onClose}
      doneLabel="Close"
      purse={view && <span className="cost"><ThingIcon icon={GOLD_ICON} size={18} /> {view.gold}g</span>}
      loading={!view && !said ? "Unrolling the samples…" : null}
      shelves={shelves}
      notes={view && (
        <>
          <p>New patterns {untilRestock(view.restock)}.</p>
          {!view.hut && <p>You have no hut standing yet. What you buy keeps until you do.</p>}
        </>
      )}
    />
  );
}
