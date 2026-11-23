// A hut's walls, floor and roof, chosen in edit mode from the finishes its owner has bought from Nell (beside the
// market stall). Any of them, as often as they like: the room is papered and laid again for everyone inside at once,
// and a new roof is seen from the Harbor.

import { useEffect, useState } from "react";
import { finishById, type FinishKind, type HutFinish } from "@gantt-quest/world";
import { api } from "./api";
import { DragPanel } from "./DragPanel";
import { FINISH_TABS } from "./FinishesPanel";
import { FinishSwatch } from "./FinishSwatch";
import "./finishes.css";

export function FinishPicker({ finish }: { finish: HutFinish }) {
  const [owned, setOwned] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.finishes().then((v) => setOwned(v.owned), (e: Error) => setError(e.message));
  }, []);

  const choose = async (kind: FinishKind, id: string | null) => {
    if (finish[kind] === id) return;
    setBusy(true);
    setError(null);
    try {
      await api.setFinish(kind, id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DragPanel id="hut.finish" title="Walls, floor and roof" foldOnPhone startFolded className="panel hut-finish">
      {!owned ? <p className="muted">{error ?? "Looking through your samples…"}</p> : <>
        {FINISH_TABS.map(({ kind, label }) => {
          const mine = owned.filter((id) => finishById(id)?.kind === kind);
          return (
            <div key={kind} className="finish-row">
              <h4>{label}</h4>
              <ul className="finish-choices">
                {[null, ...mine].map((id) => {
                  const on = finish[kind] === id;
                  const name = id ? finishById(id)!.name : kind === "roof" ? "As it came" : "Plain";
                  return (
                    <li key={id ?? "plain"}>
                      <button className={on ? "selected" : ""} aria-pressed={on} disabled={busy} title={id ? finishById(id)!.blurb : "The way huts come"} onClick={() => void choose(kind, id)}>
                        <FinishSwatch kind={kind} id={id} size={0.6} />
                        <span>{name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {owned.length === 0 && <p className="muted small-note">Nell sells wallpaper, floors and roof colours at her stall beside the market stall. What you buy shows up here.</p>}
        {owned.length > 0 && <p className="muted small-note">More at Nell's stall, beside the market stall.</p>}
        {error && <p className="bad">{error}</p>}
      </>}
    </DragPanel>
  );
}
