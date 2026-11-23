// The fishmonger's counter: worms and shrimp by the tin and the pot, glow lures one at a time, and rods. Opened from a
// word with him at the shack. What each bait does, and what it costs, is in packages/world/src/fishing.ts; the rods
// are in packages/world/src/fishfight.ts.

import { useEffect, useState } from "react";
import { BAITS, BAIT_IDS, BAIT_SALE, FISHMONGER, HOLE_NAMES, RODS, ROD_IDS, baitBuyProblem, bestRod, rodBuyProblem, type BaitCounts, type BaitId, type RodId } from "@gantt-quest/world";
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
  const [rods, setRods] = useState<RodId[]>([]);
  const [purse, setPurse] = useState(gold);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.bait().then((r) => {
      setBait(r.bait);
      setRods(r.rods);
      setPurse(r.gold);
    }, (e: Error) => setError(e.message));
  }, []);

  const buy = async (kind: BaitId | RodId, rod = false) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = rod ? await api.buyRod(kind as RodId) : await api.buyBait(kind as BaitId);
      setBait(r.bait);
      setRods(r.rods);
      setPurse(r.gold);
      setNote(rod ? `${RODS[kind as RodId].name}, rigged and ready. "Look after it, and it'll look after you."` : `${BOUGHT[kind as BaitId]} "Don't waste it."`);
      onGold?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <DragPanel id="harbor.bait" title={`${FISHMONGER.short}'s bait and rods`} compact className="panel catch-panel bait-panel" role="dialog" aria-label={`${FISHMONGER.short}'s bait and rods`}>
        <header className="gather-head">
          <h2>{FISHMONGER.short}'s bait and rods</h2>
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
        {bait && (
          <>
            <h3 className="bait-head">Rods</h3>
            <p className="muted">"A good rod bends before your line does. Gives you a moment to let go."</p>
            <ul className="catch-list">
              {ROD_IDS.map((kind) => {
                const rod = RODS[kind];
                const inHand = bestRod(rods) === kind;
                const owned = kind === "cane" || rods.includes(kind);
                const problem = owned ? null : rodBuyProblem(kind, rods, purse);
                return (
                  <li key={kind} className="catch-row bait-row">
                    <span className={`bait-swatch rod ${kind}`} aria-hidden />
                    <span className="grow">
                      <strong>{rod.name}</strong>
                      {inHand && <small className="muted"> · the one you fish with</small>}
                      <small className="muted bait-blurb">{rod.blurb}</small>
                    </span>
                    {owned ? (
                      <small className="muted">{inHand ? "In hand" : "Put away"}</small>
                    ) : (
                      <button className="small" disabled={busy || !!problem} title={problem ?? undefined} onClick={() => void buy(kind, true)}>
                        Buy · {rod.price}g
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DragPanel>
    </div>
  );
}
