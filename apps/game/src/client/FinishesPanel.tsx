// Nell's catalogue, opened from a word with her at her stall beside the market stall: wallpaper, floors and roof
// colours for your hut, each bought once and yours for good. What you own is put up at home, from Decorate.

import { useEffect, useState } from "react";
import { DECORATOR, finishesOf, type FinishKind } from "@gantt-quest/world";
import { api } from "./api";
import { DragPanel } from "./DragPanel";
import { FinishSwatch } from "./FinishSwatch";
import "./finishes.css";
import { regularFace } from "./RegularPanel";
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

export function FinishesPanel({ onClose, refresh }: { onClose(): void; refresh(): unknown }) {
  const [view, setView] = useState<View | null>(null);
  const [tab, setTab] = useState<FinishKind>("wall");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const load = () => api.finishes().then(setView, (e: Error) => setNote({ text: e.message, ok: false }));
  useEffect(() => void load(), []);

  const buy = async (id: string, name: string) => {
    setBusy(true);
    setNote(null);
    try {
      await api.buyFinish(id);
      setNote({ text: view?.hut ? `${name} is yours. Put it up at home: Decorate, then Walls, floor and roof.` : `${name} is yours, for when you have a hut to put it in.`, ok: true });
      await load();
      void refresh();
    } catch (e) {
      setNote({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DragPanel id="harbor.finishes" title="Home furnishings" className="story panel pub-bar finishes-panel">
      <div className="regular-head">
        <img className="regular-face" src={regularFace(DECORATOR.look)} alt="" />
        <div>
          <h3>{DECORATOR.name} <span className="muted">· {DECORATOR.trade}</span></h3>
          <p className="salesman-says">“Buy it once and it's yours for good. I put out different patterns every day, so look again tomorrow.”</p>
        </div>
      </div>
      <div className="finish-tabs" role="tablist">
        {FINISH_TABS.map((t) => (
          <button key={t.kind} role="tab" aria-selected={tab === t.kind} className={`small ${tab === t.kind ? "selected" : ""}`} onClick={() => setTab(t.kind)}>{t.label}</button>
        ))}
        <span className="spacer" />
        {view && <span className="finish-gold"><ThingIcon icon={GOLD_ICON} size={18} />{view.gold}g</span>}
      </div>
      {!view ? <p className="muted">Unrolling the samples…</p> : (
        <ul className={`finish-grid ${tab}`}>
          {finishesOf(tab).filter((f) => view.stock.includes(f.id)).map((f) => {
            const owned = view.owned.includes(f.id);
            const wearing = view.finish[tab] === f.id;
            const short = !owned && view.gold < f.price;
            return (
              <li key={f.id} className={`finish-card ${owned ? "owned" : ""}`} title={f.blurb}>
                <FinishSwatch kind={tab} id={f.id} />
                <strong>{f.name}</strong>
                <span className="muted small-note">{f.blurb}</span>
                {owned
                  ? <span className="tag good">{wearing ? "On your hut" : "Yours"}</span>
                  : <button className="small primary" disabled={busy || short} title={short ? `${f.price} gold, and you have ${view.gold}` : `Buy for ${f.price} gold, yours for good`} onClick={() => void buy(f.id, f.name)}>Buy {f.price}g</button>}
              </li>
            );
          })}
        </ul>
      )}
      {view && tab !== "roof" && <p className="muted small-note">Today's patterns: {view.stock.filter((id) => id.startsWith(`${tab}_`)).length} of {finishesOf(tab).length}. New ones {untilRestock(view.restock)}.</p>}
      {note && <p className={note.ok ? "good" : "bad"}>{note.text}</p>}
      {view && !view.hut && <p className="muted small-note">You have no hut standing yet. What you buy keeps until you do.</p>}
      <div className="row"><span className="spacer" /><button onClick={onClose}>Done</button></div>
    </DragPanel>
  );
}
