// Trading with the traveling salesman in the pub's corner, laid out on their shelves (ShopShelf.tsx). The stock and
// its prices come from the server; one of each entry per player per visit.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FURNISHINGS, RARITY_COLOR, SLOT_LABEL, dueIn, perkLine, resourcesText, salesGoodsName, salesman, type SalesEntry } from "@gantt-quest/world";
import { api, type Me, type SalesmanView } from "./api";
import { Icon, ItemDetail, VerdictTag, bonusSummary, compare, powerLabel, toOwned } from "./items";
import { regularFace } from "./RegularPanel";
import { ShopShelf, type Said, type Shelf, type ShelfWare } from "./ShopShelf";
import { GOLD_ICON, GoodsIcon, ThingIcon } from "./thingIcons";
import { blurb, itemName, label } from "./labels";

/** What the buyer is told once something changes hands. */
function gotText(entry: SalesEntry): string {
  const g = entry.goods;
  if (g.kind === "item") return `${itemName(g.item)} is in your pack.`;
  if (g.kind === "blueprint") return `You know how to build a ${label("furnishing", g.defId)} now. Craft it in your hut.`;
  if (g.kind === "furnishing") return `${label("furnishing", g.defId)} is in your hut's storage.`;
  return `${g.gold} gold for ${resourcesText(entry.materials)}.`;
}

/** The colour each kind of thing glows in, where it has no rarity. */
const GLOW = { blueprint: "#7fb4e0", furnishing: "#e3b757", gold: "#ffd23f" } as const;

export function SalesmanPanel({ me, refresh, onClose }: { me: Me; refresh(): Promise<unknown>; onClose(): void }) {
  const c = me.character!;
  const [view, setView] = useState<SalesmanView | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.salesman().then(setView, (e: Error) => setSaid({ text: e.message, tone: "bad" })), []);
  useEffect(() => {
    void load();
  }, [load, c.gold]);

  const worn = useMemo(() => new Map(me.inventory.map(toOwned).filter((i) => i.equipped).map((i) => [i.slot, i])), [me.inventory]);
  const here = view?.here;
  const who = here ? salesman(here.salesmanId) : undefined;

  const buy = async (entry: SalesEntry): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      const { got } = await api.buyFromSalesman(entry.index);
      setSaid({ text: gotText(got), tone: "good" });
      await Promise.all([refresh(), load()]);
      return true;
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
      void load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const entries = here?.entries ?? [];
  const toWare = (e: (typeof entries)[number]): ShelfWare => {
    const g = e.goods;
    const selling = g.kind === "gold";
    const base = {
      key: String(e.index),
      tag: selling ? <>Pays <ThingIcon icon={GOLD_ICON} size={16} />{g.gold}g</> : <span className="keeper-price"><ThingIcon icon={GOLD_ICON} size={16} /><strong>{e.price}g</strong></span>,
      stamp: e.bought ? (selling ? "Sold" : "Bought") : undefined,
      owned: e.bought,
      problem: e.bought ? null : e.problem,
      act: { label: selling ? `Sell · ${g.gold}g` : `Buy · ${e.price}g`, title: e.problem ?? "", disabled: busy || e.bought || !!e.problem, run: () => buy(e) },
    };
    if (g.kind === "item") {
      const color = RARITY_COLOR[g.item.rarity];
      const current = worn.get(g.item.slot) ?? null;
      return {
        ...base,
        name: itemName(g.item),
        color,
        art: <Icon name={g.item.icon} color={color} size={68} />,
        corner: <VerdictTag verdict={compare(g.item, current).verdict} />,
        facts: [g.item.rarity, g.item.levelReq > 1 ? `Level ${g.item.levelReq}` : ""].filter(Boolean),
        brief: [SLOT_LABEL[g.item.slot], g.item.power > 0 ? `+${g.item.power} ${powerLabel(g.item).toLowerCase()}` : "", bonusSummary(g.item), perkLine(g.item) ? `✦ ${perkLine(g.item)!.name}` : ""].filter(Boolean).join(" · "),
        detail: <ItemDetail item={g.item} current={current} classId={c.class_id} level={c.level} />,
      };
    }
    return {
      ...base,
      name: selling ? resourcesText(e.materials) : salesGoodsName(g),
      color: GLOW[g.kind],
      art: <GoodsIcon goods={g} materials={e.materials} size={68} />,
      corner: g.kind === "blueprint" ? <span className="ss-ribbon">Plans</span> : g.kind === "furnishing" ? <span className="ss-ribbon">Rare</span> : undefined,
      facts: [g.kind === "blueprint" ? "A blueprint" : g.kind === "furnishing" ? "For your hut" : "Bought off you"],
      brief: g.kind === "blueprint" ? `Build it from ${resourcesText(FURNISHINGS[g.defId]?.recipe ?? {})}. ${blurb("furnishing", g.defId)}`
        : g.kind === "furnishing" ? `${blurb("furnishing", g.defId)} Not sold at the stall.`
        : `${Math.round((g.gold / ((e.materials.herbs ?? 0) + (e.materials.mushrooms ?? 0))) * 10) / 10}g a piece; the stall pays 3.`,
    };
  };

  // Theirs first, then what they buy off you.
  const shelves: Shelf[] = [
    { id: "wares", title: "Their wares", sub: "One of each, per person, this visit", wares: entries.filter((e) => e.goods.kind !== "gold").map(toWare) },
    { id: "buys", title: "What they buy", sub: "Better than the stall pays", wares: entries.filter((e) => e.goods.kind === "gold").map(toWare) },
  ].filter((s) => s.wares.length > 0);

  return (
    <ShopShelf
      id="pub.salesman"
      title="Traveling salesman"
      className="salesman"
      keeper={who ? { name: who.name, trade: who.trade, face: regularFace(who.look) } : { name: "The far corner", trade: "the traveling salesman" }}
      says={who?.greeting ?? "The corner is empty. The visitor has packed up and gone."}
      said={said}
      onDone={onClose}
      doneLabel="Close"
      purse={<span className="cost"><ThingIcon icon={GOLD_ICON} size={18} /> {c.gold}g</span>}
      loading={!view && !said ? "Laying out the wares…" : view && !here ? "The corner is empty. The visitor has packed up and gone." : null}
      shelves={shelves}
      notes={here && <p>Packing up {dueIn(here.endsAt - Date.now())}.</p>}
    />
  );
}
