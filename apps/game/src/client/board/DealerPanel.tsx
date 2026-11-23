// Hollis Crane's panel, opened from a word with him by the pillar in the pub: trading materials at his board's
// prices (packages/world/src/dealer.ts), and his supply contracts. The server keeps what is traded and held
// (apps/game/src/server/dealer.ts).

import { useCallback, useEffect, useState } from "react";
import { DEALER_BUY_DAILY, DEALER_KINDS, DEALER_SELL_DAILY, CONTRACTS_PER_DAY, PUB_DEALER, dueIn, type DealerKind } from "@gantt-quest/world";
import { api, type DealerView } from "../api";
import { DragPanel } from "../DragPanel";
import { RewardChips } from "../hutDrops";
import { label } from "../labels";
import { regularFace } from "../RegularPanel";
import { GOLD_ICON, ThingIcon, resourceIcon } from "../thingIcons";
import "./board.css";

export type DealerTab = "trade" | "contracts";

interface Said {
  text: string;
  tone: "good" | "bad" | "muted";
}

export function DealerPanel({ tab: firstTab, refresh, onClose }: { tab: DealerTab; refresh(): Promise<unknown>; onClose(): void }) {
  const [tab, setTab] = useState<DealerTab>(firstTab);
  useEffect(() => setTab(firstTab), [firstTab]);
  const [view, setView] = useState<DealerView | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.dealer().then(setView, (e: Error) => setSaid({ text: e.message, tone: "bad" })), []);
  useEffect(() => {
    void load();
  }, [load]);
  // A contract that ran out of time is settled when next looked at: say so.
  useEffect(() => {
    if (view?.settled?.outcome === "lapsed") setSaid({ text: `Your contract ran out of time. He paid ${view.settled.paid} gold for what you had brought.`, tone: "muted" });
  }, [view?.settled]);

  /** Do something with him: the answer is said, and his board and your gold read again. */
  const act = async (run: () => Promise<{ view: DealerView; text: string }>) => {
    setBusy(true);
    try {
      const { view: next, text } = await run();
      setView(next);
      setSaid({ text, tone: "good" });
      await refresh();
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  const trade = (side: "sell" | "buy", kind: DealerKind, qty: number) =>
    act(async () => {
      const r = await api.dealerTrade(side, kind, qty);
      const what = `${qty} ${label("resource", kind).toLowerCase()}`;
      return { view: r.view, text: side === "sell" ? `Sold ${what} for ${r.gold} gold.` : `Bought ${what} for ${r.gold} gold.` };
    });
  const contract = (action: "take" | "deliver" | "drop", offer?: string) =>
    act(async () => {
      const r = await api.dealerContract(action, offer);
      const d = r.done;
      const text = action === "take" ? "Contract taken. Bring it in as you gather; he keeps count."
        : action === "drop" ? (d.paid ? `Dropped. He paid ${d.paid} gold for what you had brought.` : "Dropped.")
        : d.paid !== undefined ? `Filled! ${d.paid} gold${d.xp?.granted ? ` and ${d.xp.granted} XP` : ""}${d.early ? ", with something extra for being quick about it" : ""}.`
        : "Handed in. He has marked it off.";
      return { view: r.view, text };
    });

  const now = Date.now();
  return (
    <DragPanel id="pub.dealer" title="Hollis Crane" className="story panel pub-bar dealer-panel" role="dialog" aria-label={`${PUB_DEALER.name}, ${PUB_DEALER.trade}`}>
      <div className="regular-head">
        <img className="regular-face" src={regularFace(PUB_DEALER.look)} alt="" />
        <div className="grow">
          <h3>{PUB_DEALER.name} <span className="muted">· {PUB_DEALER.trade}</span></h3>
          <p className="salesman-says">“{PUB_DEALER.line}”</p>
        </div>
        <button className="small" onClick={onClose}>Close</button>
      </div>
      <div className="dealer-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "trade"} className={tab === "trade" ? "primary" : ""} onClick={() => setTab("trade")}>Trade</button>
        <button role="tab" aria-selected={tab === "contracts"} className={tab === "contracts" ? "primary" : ""} onClick={() => setTab("contracts")}>
          Contracts{view?.contract ? " ·1" : ""}
        </button>
        {view && <span className="dealer-gold"><ThingIcon icon={GOLD_ICON} size={18} /> {view.gold}g</span>}
      </div>
      {said && <p className={`dealer-said ${said.tone}`}>{said.text}</p>}
      {!view ? <p className="muted">He finds the right page of his ledger…</p>
        : tab === "trade" ? (
          <div className="dealer-body">
            <p className="muted">His prices change {dueIn(view.board.endsAt - now)}. He buys up to {DEALER_BUY_DAILY} and sells up to {DEALER_SELL_DAILY} of each a day.</p>
            <table className="dealer-board">
              <thead>
                <tr><th>Material</th><th>You have</th><th>He pays</th><th>He asks</th></tr>
              </thead>
              <tbody>
                {DEALER_KINDS.map((k) => {
                  const have = view.have[k] ?? 0;
                  const t = view.traded[k];
                  const canSell = Math.min(have, DEALER_BUY_DAILY - t.bought);
                  const canBuy = Math.min(DEALER_SELL_DAILY - t.sold, Math.floor(view.gold / view.board.sells[k]));
                  const wanted = view.board.wanted.includes(k);
                  return (
                    <tr key={k} className={wanted ? "wanted" : view.board.glut === k ? "glut" : ""}>
                      <th scope="row">
                        <ThingIcon icon={resourceIcon(k)} size={20} /> {label("resource", k)}
                        {wanted && <span className="dealer-tag" title="He is after this: he pays more for it">wanted</span>}
                        {view.board.glut === k && <span className="dealer-tag glut" title="He has too much of this: he sells it cheap">cheap</span>}
                      </th>
                      <td>{have}</td>
                      <td>
                        <span className="gold-text">{view.board.buys[k]}g</span>
                        <span className="dealer-btns">
                          <button className="small" disabled={busy || canSell < 1} onClick={() => void trade("sell", k, 1)}>Sell 1</button>
                          {canSell > 1 && <button className="small" disabled={busy} onClick={() => void trade("sell", k, canSell)}>Sell {canSell}</button>}
                        </span>
                      </td>
                      <td>
                        <span className="gold-text">{view.board.sells[k]}g</span>
                        <span className="dealer-btns">
                          <button className="small" disabled={busy || canBuy < 1} onClick={() => void trade("buy", k, 1)}>Buy 1</button>
                          {canBuy >= 5 && <button className="small" disabled={busy} onClick={() => void trade("buy", k, 5)}>Buy 5</button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dealer-body">
            {view.contract ? (
              <section className="dealer-held">
                <h3>Your contract</h3>
                <p>For {view.contract.offer.for}. Due {dueIn(view.contract.dueAt - now)}; pays <span className="gold-text">{view.contract.offer.gold}g</span> and XP, more XP if filled within a day.</p>
                <ul className="dealer-progress">
                  {(Object.keys(view.contract.offer.wants) as DealerKind[]).map((k) => {
                    const want = view.contract!.offer.wants[k]!;
                    const got = view.contract!.delivered[k] ?? 0;
                    return (
                      <li key={k}>
                        <ThingIcon icon={resourceIcon(k)} size={20} /> {label("resource", k)}
                        <span className="dealer-bar"><span style={{ width: `${Math.round((got / want) * 100)}%` }} /></span>
                        {got} / {want} <span className="muted">(you carry {view.have[k] ?? 0})</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="row">
                  <button className="primary" disabled={busy || !(Object.keys(view.contract.owed) as DealerKind[]).some((k) => (view.have[k] ?? 0) > 0)} onClick={() => void contract("deliver")}>Hand in what I carry</button>
                  <span className="grow" />
                  <button disabled={busy} onClick={() => confirm("Give up this contract? He pays for what you have brought, at his buying price.") && void contract("drop")}>Give it up</button>
                </p>
              </section>
            ) : (
              <p className="muted">Take one at a time, {CONTRACTS_PER_DAY} a day. Bring the goods in as you gather them; he pays for what you have brought if one runs out of time.</p>
            )}
            <h3>On his slate today</h3>
            <ul className="dealer-offers">
              {view.offers.map((o) => (
                <li key={o.id} className={o.taken ? "taken" : ""}>
                  <div className="grow">
                    <div>For {o.for}, within {o.days} days:</div>
                    <RewardChips resources={o.wants} />
                  </div>
                  <div className="dealer-pay">
                    <span className="gold-text">{o.gold}g</span> + XP
                    <button className="small primary" disabled={busy || o.taken || !!view.contract || view.takenToday >= CONTRACTS_PER_DAY} onClick={() => void contract("take", o.id)}>
                      {o.taken ? "Taken" : "Take it"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
    </DragPanel>
  );
}
