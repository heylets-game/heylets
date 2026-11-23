// The fishmonger's bait counter: worms and shrimp by the tin and the pot, and glow lures one at a time. Opened from a
// word with him at the shack. What each does, and what it costs, is in packages/world/src/fishing.ts.

import { useEffect, useState } from "react";
import { BAITS, BAIT_IDS, BAIT_SALE, FISHMONGER, HOLE_NAMES, baitBuyProblem, type BaitCounts, type BaitId } from "@gantt-quest/world";
import { api } from "./api";
import { DragPanel } from "./DragPanel";
import "./fishing.css";

/** What each bait is for, in a few words. */
const FOR: Record<BaitId, string> = {
  worms: `Best at ${HOLE_NAMES.shoal.toLowerCase()}. One a cast.`,
  shrimp: `Best at ${HOLE_NAMES.deep.toLowerCase()}. One a cast.`,
  glow_lure: "Best with night feeders, after dark. Lasts until a fish takes the line.",
};

/** What is handed over the counter. */
const BOUGHT: Record<BaitId, string> = {
  worms: "Ten worms in a tin.",
  shrimp: "Ten shrimp in a pot.",
  glow_lure: "One glow lure, wrapped in newspaper.",
};

export function BaitPanel({ gold, onClose, onGold }: {
  /** The player's gold as last read, until the counter says otherwise. */
  gold: number;
  onClose(): void;
  /** Told when buying changes the player's gold. */
  onGold?(): void;
}) {
  const [bait, setBait] = useState<BaitCounts | null>(null);
  const [purse, setPurse] = useState(gold);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.bait().then((r) => {
      setBait(r.bait);
      setPurse(r.gold);
    }, (e: Error) => setError(e.message));
  }, []);

  const buy = async (kind: BaitId) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.buyBait(kind);
      setBait(r.bait);
      setPurse(r.gold);
      setNote(`${BOUGHT[kind]} "Don't waste it."`);
      onGold?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <DragPanel id="harbor.bait" title={`${FISHMONGER.short}'s bait`} compact className="panel catch-panel bait-panel" role="dialog" aria-label={`${FISHMONGER.short}'s bait`}>
        <header className="gather-head">
          <h2>{FISHMONGER.short}'s bait</h2>
          <span className="spacer" />
          <span className="gold">{purse} gold</span>
          <button className="small" onClick={onClose}>Close</button>
        </header>
        <p className="muted">"Bait doesn't make fish. It makes the right fish bite. Put it on before you cast."</p>
        {!bait && !error && <p className="muted">He rummages under the counter…</p>}
        {error && <p className="bad">{error}</p>}
        {note && <p className="good">{note}</p>}
        {bait && (
          <ul className="catch-list">
            {BAIT_IDS.map((kind) => {
              const sale = BAIT_SALE[kind];
              const have = bait[kind] ?? 0;
              const problem = baitBuyProblem(kind, have, purse);
              return (
                <li key={kind} className="catch-row bait-row">
                  <span className={`bait-swatch ${kind}`} aria-hidden />
                  <span className="grow">
                    <strong>{BAITS[kind].name}</strong> <small className="muted">· you have {have} of {sale.max}</small>
                    <small className="muted bait-blurb">{BAITS[kind].blurb} {FOR[kind]}</small>
                  </span>
                  <button className="small" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void buy(kind)}>
                    Buy {sale.lot} · {sale.price}g
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DragPanel>
    </div>
  );
}
