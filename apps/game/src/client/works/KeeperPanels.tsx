// Dealing with the smith or the apothecary, standing in front of them in
// their shop (KeeperView): what they sell from their own stock for gold, and
// what they do with what you bring, laid out on their shelves (ShopShelf.tsx).
// (The galley's cook has a panel too, but nothing to sell.) The hotbar is put
// away meanwhile; "Step away" walks you back from the keeper and brings it back.
//
// Anything with a gold price can be haggled over, once a day: pick how much
// to ask off, and the server rolls for whether the keeper agrees.
//
// What can be done is worked out here only to grey out buttons; the server
// checks every purchase, flask, step and haggle again.

import { useMemo, useState } from "react";
import { FLASK_RECIPES, HAGGLE_ASKS, KEEPER_PLACES, RARITY_COLOR, SHELF_DAILY, SLOT_LABEL, SMITHY_MAX_STEPS, THROWABLES, THROWABLE_KINDS, flaskProblem, haggledPrice, smithyProblem, smithyWork, upgradedName, workKey, type Deal, type HaggleAsk, type ItemDef, type KeeperShop, type Resources, type Throwable } from "@gantt-quest/world";
import { api, type ApothecaryView, type HaggleResult, type KeeperWare, type Me, type SmithyView } from "../api";
import { CostChips, RewardChips } from "../hutDrops";
import { Icon, ItemDetail, VerdictTag, bonusSummary, compare, powerLabel, toOwned } from "../items";
import { ShopShelf, type Said, type ShelfWare } from "../ShopShelf";
import { itemName, label } from "../labels";
import { regularFace } from "../RegularPanel";
import { GOLD_ICON, ThingIcon } from "../thingIcons";
import { ITEM_ICON } from "../zone/actionIcons";
import "./works.css";

/** "3 herbs, 1 bone", with the resources' own (possibly renamed) labels. */
const amountsText = (gold: number, r: Resources) =>
  [gold > 0 ? `${gold} gold` : "", ...Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${n} ${label("resource", k).toLowerCase()}`)].filter(Boolean).join(", ");

export type { Said } from "../ShopShelf";

/** A gold price, with the list price struck through beside it once it has been talked down. */
function Price({ list, price }: { list: number; price: number }) {
  return (
    <span className="keeper-price">
      <ThingIcon icon={GOLD_ICON} size={16} />
      {price < list && <s className="muted">{list}g</s>}
      <strong>{price}g</strong>
    </span>
  );
}

/** What came of haggling over something, as a small tag on its row. */
function DealTag({ deal }: { deal: Deal | null }) {
  if (!deal) return null;
  return deal.pct > 0 ? <span className="tag good" title="Talked down today. The price holds until the day turns.">{deal.pct}% off today</span> : <span className="tag" title="You asked, and the answer was no. Try again tomorrow.">Price holds today</span>;
}

/** The three things to ask for, each with what it takes off and the chance of it. Shown under the row being haggled over. */
function HaggleAsks({ list, chances, busy, onAsk, onCancel }: { list: number; chances: Record<HaggleAsk, number>; busy: boolean; onAsk(ask: HaggleAsk): void; onCancel(): void }) {
  return (
    <div className="keeper-asks" role="group" aria-label="Haggle">
      <span className="muted small-note">One try today. The more you ask, the less likely it lands.</span>
      <div className="keeper-ask-row">
        {HAGGLE_ASKS.map((a) => (
          <button key={a.id} className="small" disabled={busy} onClick={() => onAsk(a.id)} title={`${a.pct}% off: ${list}g down to ${haggledPrice(list, a.pct)}g. About a ${chances[a.id]}% chance.`}>
            {a.label}
            <span className="keeper-ask-odds">−{a.pct}% · {chances[a.id]}% chance</span>
          </button>
        ))}
        <button className="small" disabled={busy} onClick={onCancel}>Never mind</button>
      </div>
    </div>
  );
}

/** Everything the two panels share: what is busy, which row is being haggled over, and the last word. */
function useDealing(shop: KeeperShop, reload: () => Promise<unknown>, refresh: () => Promise<unknown>, onSay: (text: string) => void) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  /** The key of the row whose asks are showing. */
  const [haggling, setHaggling] = useState<string | null>(null);

  /** Run one request; on failure say why, and read the shop again in case it has changed. */
  /** Resolves true when it went through. */
  const run = async (work: () => Promise<Said | void>): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      const done = await work();
      if (done) setSaid(done);
      return true;
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
      void reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const haggle = (key: string, ask: HaggleAsk) =>
    run(async () => {
      const res: HaggleResult = await api.haggle(shop, key, ask);
      setHaggling(null);
      onSay(res.line);
      await reload();
      return { text: `“${res.line}” ${res.won ? `${res.list}g comes down to ${res.price}g, for today.` : "The price holds, for today."}`, tone: res.won ? "good" : "plain" };
    });

  return { busy, said, haggling, setHaggling, run, haggle, refresh };
}

/** The Haggle button for a row, or nothing if it has been tried today or cannot be. */
function HaggleButton({ entry, deal, list, open, busy, disabled, onOpen }: { entry: string; deal: Deal | null; list: number; open: boolean; busy: boolean; disabled?: boolean; onOpen(key: string | null): void }) {
  if (deal || list <= 0) return null;
  return (
    <button className={`small keeper-haggle ${open ? "selected" : ""}`} disabled={busy || disabled} aria-expanded={open} title="Ask for something off the price. One try today." onClick={() => onOpen(open ? null : entry)}>
      Haggle
    </button>
  );
}

// ---------- the apothecary ----------

/** The Haggle button and, while it is open, the asks; or what came of haggling today. For the counter. */
function Haggling({ entry, deal, list, chances, d, disabled }: { entry: string; deal: Deal | null; list: number; chances: Record<HaggleAsk, number>; d: ReturnType<typeof useDealing>; disabled?: boolean }) {
  const open = d.haggling === entry;
  return (
    <>
      <DealTag deal={deal} />
      <HaggleButton entry={entry} deal={deal} list={list} open={open} busy={d.busy} disabled={disabled} onOpen={d.setHaggling} />
      {open && <HaggleAsks list={list} chances={chances} busy={d.busy} onAsk={(ask) => void d.haggle(entry, ask)} onCancel={() => d.setHaggling(null)} />}
    </>
  );
}

/** "−20%" for a price talked down today. */
const sealOf = (deal: Deal | null) => (deal && deal.pct > 0 ? `−${deal.pct}%` : undefined);

export function ApothecaryKeeperPanel({ view, setView, reload, refresh, onSay, onDone }: {
  view: ApothecaryView;
  setView(view: ApothecaryView): void;
  /** Fetch the shop again. */
  reload(): Promise<unknown>;
  /** Fetch the hero again (gold, the pack). */
  refresh(): Promise<unknown>;
  /** The keeper says something out loud, over his head. */
  onSay(text: string): void;
  /** Step back from the keeper, which puts the panel away. */
  onDone(): void;
}) {
  const d = useDealing("apothecary", reload, refresh, onSay);
  const { keeper, title } = KEEPER_PLACES.apothecary;

  const buy = (ware: KeeperWare) =>
    d.run(async () => {
      const res = await api.buyFromApothecary(ware.key);
      setView(res);
      void refresh();
      return { text: `${res.got} goes into your pack, for ${ware.price}g.`, tone: "good" };
    });
  const brewFlask = (kind: Throwable) =>
    d.run(async () => {
      const res = await api.brewFlask(kind);
      setView(res);
      void refresh();
      return { text: `${THROWABLES[kind].name}: one more in your pack, ${res.carried[kind] ?? 1} in all.${res.xp?.text ? ` ${res.xp.text}` : ""}`, tone: "good" };
    });

  const shelf: ShelfWare[] = view.wares.flatMap((w) => {
    if (w.goods.kind !== "flask") return [];
    const kind = w.goods.flask;
    const def = THROWABLES[kind];
    const icon = ITEM_ICON[kind];
    return [{
      key: w.key,
      name: `${def.name}${w.goods.qty > 1 ? ` × ${w.goods.qty}` : ""}`,
      color: icon.color,
      art: <Icon name={icon.name} color={icon.color} size={68} />,
      tag: <Price list={w.list} price={w.price} />,
      seal: sealOf(w.deal),
      facts: [`You carry ${view.carried[kind] ?? 0}`, w.left > 0 ? `${w.left} left today` : "None left today"],
      brief: def.blurb,
      stamp: w.left <= 0 ? "Sold out" : undefined,
      problem: w.problem,
      act: { label: `Buy · ${w.price}g`, title: w.problem ?? `Buy for ${w.price} gold`, disabled: d.busy || !!w.problem, run: () => buy(w) },
      more: <Haggling entry={w.key} deal={w.deal} list={w.list} chances={view.chances} d={d} disabled={w.left <= 0} />,
    }];
  });
  const brews: ShelfWare[] = THROWABLE_KINDS.map((kind) => {
    const def = THROWABLES[kind];
    const icon = ITEM_ICON[kind];
    const problem = flaskProblem(kind, view);
    return {
      key: `brew:${kind}`,
      name: def.name,
      color: icon.color,
      art: <Icon name={icon.name} color={icon.color} size={68} />,
      tag: <CostChips cost={FLASK_RECIPES[kind]} have={view.resources} />,
      facts: [`You carry ${view.carried[kind] ?? 0}`, "No charge but the makings"],
      brief: def.blurb,
      problem,
      act: { label: "Brew one", title: problem ?? `Brew one more ${def.name.toLowerCase()}`, disabled: d.busy || !!problem, run: () => brewFlask(kind) },
    };
  });

  return (
    <ShopShelf
      id="keeper.apothecary"
      title={title}
      className="keeper-apothecary"
      keeper={{ name: keeper.name, trade: keeper.trade, face: regularFace(keeper.look) }}
      says={keeper.line}
      said={d.said}
      onDone={onDone}
      purse={<RewardChips zeros gold={view.gold} resources={{ herbs: view.resources.herbs ?? 0, mushrooms: view.resources.mushrooms ?? 0, bone: view.resources.bone ?? 0, wood: view.resources.wood ?? 0, copper: view.resources.copper ?? 0, fur: view.resources.fur ?? 0, slime: view.resources.slime ?? 0 }} />}
      shelves={[
        { id: "shelf", title: "On the shelf", sub: `Ready-made, for gold · ${SHELF_DAILY} of each a day`, wares: shelf },
        { id: "brew", title: "Brewed from what you bring", sub: "For your pack · no charge but the makings", wares: brews },
      ]}
    />
  );
}

// ---------- the smithy ----------

export function SmithyKeeperPanel({ me, view, setView, reload, refresh, onSay, onDone }: {
  me: Me;
  view: SmithyView;
  setView(view: SmithyView): void;
  reload(): Promise<unknown>;
  refresh(): Promise<unknown>;
  onSay(text: string): void;
  onDone(): void;
}) {
  const c = me.character!;
  const d = useDealing("smithy", reload, refresh, onSay);
  const { keeper, title } = KEEPER_PLACES.smithy;
  const worn = useMemo(() => new Map(me.inventory.map(toOwned).filter((i) => i.equipped).map((i) => [i.slot, i])), [me.inventory]);

  const buy = (ware: KeeperWare) =>
    d.run(async () => {
      const res = await api.buyFromSmith(ware.key);
      setView(res);
      void refresh();
      return { text: `${res.got} is in your pack, for ${ware.price}g.`, tone: "good" };
    });
  const work = (id: number) =>
    d.run(async () => {
      const res = await api.smith(id);
      setView(res);
      // Gold and power changed on the character sheet too.
      void refresh();
      return { text: `The smith hands it back: ${res.worked}.${res.xp?.text ? ` ${res.xp.text}` : ""}`, tone: "good" };
    });

  const rack: ShelfWare[] = view.wares.flatMap((w) => {
    if (w.goods.kind !== "item") return [];
    const item = w.goods.item;
    const color = RARITY_COLOR[item.rarity];
    const current = worn.get(item.slot) ?? null;
    return [{
      key: w.key,
      name: itemName(item),
      color,
      art: <Icon name={item.icon} color={color} size={68} />,
      tag: <Price list={w.list} price={w.price} />,
      seal: sealOf(w.deal),
      corner: <VerdictTag verdict={compare(item, current).verdict} />,
      facts: [item.rarity, item.levelReq > 1 ? `Level ${item.levelReq}` : "", w.left > 0 ? `${w.left} left today` : ""].filter(Boolean),
      brief: gearBrief(item),
      detail: <ItemDetail item={item} current={current} classId={c.class_id} level={c.level} />,
      stamp: w.left <= 0 ? "Sold" : undefined,
      problem: w.problem,
      act: { label: `Buy · ${w.price}g`, title: w.problem ?? `Buy for ${w.price} gold`, disabled: d.busy || !!w.problem, run: () => buy(w) },
      more: <Haggling entry={w.key} deal={w.deal} list={w.list} chances={view.chances} d={d} disabled={w.left <= 0} />,
    }];
  });
  const anvil: ShelfWare[] = view.items.map((item) => {
    const color = RARITY_COLOR[item.rarity];
    const problem = smithyProblem(item, view);
    const verb = smithyWork(item) === "sharpen" ? "Sharpen" : "Reinforce";
    const key = workKey(item.id);
    return {
      key,
      name: upgradedName(item.name, item.upgrades),
      color,
      art: <Icon name={item.icon} color={color} size={68} />,
      tag: item.cost
        ? <><CostChips cost={item.cost.resources} have={view.resources} gold={item.cost.gold} haveGold={view.gold} />{item.cost.gold < item.listGold && <s>{item.listGold}g</s>}</>
        : "Finest",
      seal: item.cost ? sealOf(item.deal) : undefined,
      corner: item.equipped ? <span className="ss-ribbon">Worn</span> : undefined,
      facts: [`Power ${item.power}`, item.cost ? `${verb}, step ${item.upgrades + 1} of ${SMITHY_MAX_STEPS}` : `+${SMITHY_MAX_STEPS}, the most there is`],
      brief: item.cost ? `${verb}ing adds 1 power, worn or in your pack.` : "As good as the smith can make it.",
      stamp: item.cost ? undefined : "Finest",
      owned: !item.cost,
      problem: item.cost ? problem : null,
      act: item.cost ? { label: `${verb} +1`, title: problem ?? `${verb} for ${amountsText(item.cost.gold, item.cost.resources)}`, disabled: d.busy || !!problem, run: () => work(item.id) } : undefined,
      more: item.cost ? <Haggling entry={key} deal={item.deal} list={item.listGold} chances={view.chances} d={d} /> : undefined,
    };
  });

  return (
    <ShopShelf
      id="keeper.smithy"
      title={title}
      className="keeper-smithy"
      keeper={{ name: keeper.name, trade: keeper.trade, face: regularFace(keeper.look) }}
      says={keeper.line}
      said={d.said}
      onDone={onDone}
      purse={<RewardChips zeros gold={view.gold} resources={{ iron: view.resources.iron ?? 0, copper: view.resources.copper ?? 0 }} />}
      shelves={[
        { id: "rack", title: "On the rack", sub: "Today's work, for gold · made for your class and level", wares: rack },
        { id: "anvil", title: "Work on your gear", sub: `+1 power a step, up to +${SMITHY_MAX_STEPS} · worn or in your pack`, wares: anvil, empty: "You have no weapons or armour with you." },
      ]}
    />
  );
}

/** A piece of gear in a few words: "Main hand · +4 power · +1 Strength". */
function gearBrief(item: ItemDef): string {
  return [SLOT_LABEL[item.slot], item.power > 0 ? `+${item.power} ${powerLabel(item).toLowerCase()}` : "", bonusSummary(item)].filter(Boolean).join(" · ");
}

// ---------- the galley ----------

/** The cook has nothing to sell and makes nothing: his shelf says so, and lets you step away. */
export function GalleyKeeperPanel({ onDone }: { onDone(): void }) {
  const { keeper, title } = KEEPER_PLACES.galley;
  return (
    <ShopShelf
      id="keeper.galley"
      title={title}
      className="keeper-galley"
      keeper={{ name: keeper.name, trade: keeper.trade, face: regularFace(keeper.look) }}
      says={keeper.line}
      said={null}
      onDone={onDone}
      purse={null}
      shelves={[{ id: "galley", title: "The galley", wares: [], empty: "The cook has nothing to sell and nothing to cook for you." }]}
    />
  );
}
