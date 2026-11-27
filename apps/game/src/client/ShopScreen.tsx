// The market stall in the Harbor, laid out on its shelves (ShopShelf.tsx): a small stock of gear that changes each
// day, made for your class and level and compared against what you are wearing so an upgrade is obvious; seeds and a
// watering can for the herb garden; plain pieces for a hut, always in stock at the catalogue's price; and what the
// stall buys back, foraged herbs and mushrooms and the gear in your pack.
//
// Nobody keeps the stall, so it opens in the middle of the Harbor rather than beside someone, over a dimmed view.

import { useEffect, useMemo, useState } from "react";
import { BONEMEAL_PER_BONE, CAN_CAPACITY, CAN_PRICE, CARRY_FORMULA, GROW_MS, RARITY_COLOR, RESOURCE_KINDS, SEED_PRICE, SLOT_LABEL, STALL_BUYS, STALL_FURNITURE, carryProblem, equipProblem, perkLine, sellPrice, type ItemDef, type Resources } from "@gantt-quest/world";
import { api, type Me, type Shop } from "./api";
import { Icon, ItemDetail, VerdictTag, bonusSummary, compare, powerLabel, toOwned } from "./items";
import { blurb, itemName, label } from "./labels";
import { ShopShelf, type Said, type Shelf, type ShelfWare } from "./ShopShelf";
import { GOLD_ICON, ThingIcon, furnishingIcon, resourceIcon } from "./thingIcons";

const price = (g: number) => <span className="keeper-price"><ThingIcon icon={GOLD_ICON} size={16} /><strong>{g}g</strong></span>;
const pays = (g: number) => <>Pays <ThingIcon icon={GOLD_ICON} size={16} />{g}g</>;
const gearBrief = (item: ItemDef) => [SLOT_LABEL[item.slot], item.power > 0 ? `+${item.power} ${powerLabel(item).toLowerCase()}` : "", bonusSummary(item), perkLine(item) ? `✦ ${perkLine(item)!.name}` : ""].filter(Boolean).join(" · ");

export function ShopScreen({ me, refresh, onClose }: { me: Me; refresh(): Promise<unknown>; onClose(): void }) {
  const c = me.character!;
  const [shop, setShop] = useState<Shop | null>(null);
  /** The player's materials, for the seeds they hold and the foraged goods the stall will buy. */
  const [stock, setStock] = useState<Resources>({});
  /** The player's watering can: how much is in it (null: none yet). Undefined until read. */
  const [can, setCan] = useState<number | null | undefined>(undefined);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    Promise.all([
      api.can().then((r) => setCan(r.water), () => undefined),
      api.shop().then(setShop, (e: Error) => setSaid({ text: e.message, tone: "bad" })),
      api.hut().then((h) => setStock(h.resources), () => undefined),
    ]);
  useEffect(() => {
    void load();
  }, []);

  /** Do one thing at the stall; say what came of it, and read the stall and the hero again. Resolves true when it went through. */
  const act = async (fn: () => Promise<unknown>, text: string): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      await fn();
      setSaid({ text, tone: "good" });
      await Promise.all([refresh(), load()]);
      return true;
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => me.inventory.map(toOwned), [me.inventory]);
  const worn = useMemo(() => new Map(items.filter((i) => i.equipped).map((i) => [i.slot, i])), [items]);
  const sellable = items.filter((i) => !i.equipped);
  /** Why a purchase would not fit in the pack, or null. */
  const full = me.carry ? carryProblem(me.carry, 1) : null;
  const hours = shop ? Math.max(0, Math.ceil((shop.refreshAt - Date.now()) / 3_600_000)) : 0;
  const short = (g: number) => (c.gold < g ? `That costs ${g} gold, and you have ${c.gold}.` : null);

  const gear: ShelfWare[] = (shop?.entries ?? []).map((e) => {
    const color = RARITY_COLOR[e.item.rarity];
    const current = worn.get(e.item.slot) ?? null;
    const problem = e.bought ? null : short(e.price) ?? full ?? equipProblem(e.item, c.class_id, c.level);
    const cannot = !e.bought && (c.gold < e.price || !!full);
    return {
      key: `buy:${e.index}`,
      name: itemName(e.item),
      color,
      art: <Icon name={e.item.icon} color={color} size={68} />,
      tag: price(e.price),
      corner: <VerdictTag verdict={compare(e.item, current).verdict} />,
      facts: [e.item.rarity, e.item.levelReq > 1 ? `Level ${e.item.levelReq}` : ""].filter(Boolean),
      brief: gearBrief(e.item),
      detail: <ItemDetail item={e.item} current={current} classId={c.class_id} level={c.level} />,
      stamp: e.bought ? "Sold" : undefined,
      problem,
      act: { label: `Buy · ${e.price}g`, disabled: busy || e.bought || cannot, title: problem ?? `Buy for ${e.price} gold`, run: () => act(() => api.buy(e.index), `${itemName(e.item)} is in your pack, for ${e.price}g.`) },
    };
  });

  const seeds = stock.seeds ?? 0;
  const garden: ShelfWare[] = [
    {
      key: "seeds",
      name: label("resource", "seeds"),
      color: resourceIcon("seeds").color,
      art: <ThingIcon icon={resourceIcon("seeds")} size={68} />,
      tag: price(SEED_PRICE),
      corner: <span className="ss-ribbon">You have {seeds}</span>,
      facts: [`You have ${seeds}`, "A packet a bed"],
      brief: `A packet plants one bed of your hut's garden with herbs, ready to pick in ${GROW_MS / 3_600_000} hours: two or three herbs a bed. Bonemeal makes it grow faster: grind it from bones at the garden, ${BONEMEAL_PER_BONE} scoops a bone.`,
      problem: short(SEED_PRICE),
      act: { label: `Buy 1 · ${SEED_PRICE}g`, disabled: busy || c.gold < SEED_PRICE, run: () => act(() => api.buySeeds(1), "A packet of herb seeds, bought.") },
      more: [5, 10].map((n) => (
        <button key={n} className="small" disabled={busy || c.gold < n * SEED_PRICE} onClick={() => void act(() => api.buySeeds(n), `${n} packets of herb seeds, bought.`)}>
          Buy {n} · {n * SEED_PRICE}g
        </button>
      )),
    },
    {
      key: "can",
      name: "Watering can",
      color: "#4f9fd6",
      art: <Icon name="watering-can" color="#4f9fd6" size={68} />,
      tag: can != null ? `${can} of ${CAN_CAPACITY}` : price(CAN_PRICE),
      facts: [can != null ? `${can} of ${CAN_CAPACITY} waterings in it` : `Holds ${CAN_CAPACITY} waterings`],
      brief: "Water a bed of your garden from it for one more herb or mushroom. Fill it at the well on the green.",
      stamp: can != null ? "Yours" : undefined,
      owned: can != null,
      problem: can === null ? short(CAN_PRICE) : null,
      act: can === null ? { label: `Buy · ${CAN_PRICE}g`, disabled: busy || c.gold < CAN_PRICE, run: () => act(() => api.buyCan(), "A watering can, bought. Fill it at the well on the green.") } : undefined,
    },
  ];

  const furniture: ShelfWare[] = STALL_FURNITURE.map((def) => {
    const icon = furnishingIcon(def.id);
    const name = label("furnishing", def.id);
    return {
      key: `furn:${def.id}`,
      name,
      color: icon.color,
      art: <ThingIcon icon={icon} size={68} />,
      tag: price(def.price!),
      facts: ["Goes to your hut's storage"],
      brief: blurb("furnishing", def.id),
      problem: short(def.price!),
      act: { label: `Buy · ${def.price}g`, disabled: busy || c.gold < def.price!, run: () => act(() => api.buyFurniture(def.id), `${name} is in your hut's storage.`) },
    };
  });

  const forage: ShelfWare[] = RESOURCE_KINDS.filter((k) => STALL_BUYS[k] !== undefined).map((k) => {
    const have = stock[k] ?? 0;
    const each = STALL_BUYS[k]!;
    const icon = resourceIcon(k);
    const name = label("resource", k);
    return {
      key: `forage:${k}`,
      name,
      color: icon.color,
      art: <ThingIcon icon={icon} size={68} />,
      tag: pays(each),
      corner: <span className="ss-ribbon">You have {have}</span>,
      facts: [`You have ${have}`, `${each}g each`],
      brief: `The stall buys ${name.toLowerCase()} by the piece.`,
      problem: have < 1 ? `You have no ${name.toLowerCase()}.` : null,
      act: { label: `Sell 1 · ${each}g`, disabled: busy || have < 1, run: () => act(() => api.sellMaterial(k, 1), `One ${name.toLowerCase()} sold, for ${each}g.`) },
      more: have > 1 ? <button className="small" disabled={busy} onClick={() => void act(() => api.sellMaterial(k, have), `${have} ${name.toLowerCase()} sold, for ${each * have}g.`)}>Sell all {have} · {each * have}g</button> : undefined,
    };
  });

  const yours: ShelfWare[] = sellable.map((item) => {
    const color = RARITY_COLOR[item.rarity];
    const gets = sellPrice(item);
    return {
      key: `sell:${item.id}`,
      name: itemName(item),
      color,
      art: <Icon name={item.icon} color={color} size={68} />,
      tag: pays(gets),
      facts: [item.rarity, "From your pack"],
      brief: gearBrief(item),
      detail: <ItemDetail item={item} current={worn.get(item.slot) ?? null} classId={c.class_id} level={c.level} />,
      act: { label: `Sell · ${gets}g`, disabled: busy, run: () => act(() => api.sell(item.id), `${itemName(item)} sold, for ${gets}g.`) },
    };
  });

  const shelves: Shelf[] = [
    { id: "gear", title: "Today's gear", sub: `Made for your class and level${me.carry ? ` · you carry ${me.carry.carried} of ${me.carry.limit}` : ""}`, wares: gear, empty: "Sold out until the new stock comes in." },
    { id: "garden", title: "For the garden", sub: "Seeds and a can for your hut's herb beds", wares: garden },
    { id: "furniture", title: "For your hut", sub: "Plain pieces, always in stock · to your hut's storage", wares: furniture },
    { id: "forage", title: "It buys herbs", sub: "Foraged herbs and mushrooms, by the piece", wares: forage },
    { id: "sell", title: "It buys gear", sub: "From your pack · take worn gear off first", wares: yours, empty: "Nothing to sell. Worn gear has to be taken off first." },
  ];

  return (
    <div className="overlay shelf-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <ShopShelf
        id="shop"
        title="Market stall"
        className="centred market-stall"
        keeper={{ name: "The market stall", trade: "gear, and things for your hut" }}
        says={`New stock in about ${hours} hour${hours === 1 ? "" : "s"}.`}
        said={said ?? (full ? { text: `${full} (Pack size: ${CARRY_FORMULA}.)`, tone: "bad" } : null)}
        onDone={onClose}
        doneLabel="Close"
        purse={<span className="cost"><ThingIcon icon={GOLD_ICON} size={18} /> {c.gold}g</span>}
        loading={!shop && !said ? "Laying out the wares…" : null}
        shelves={shelves}
        notes={(stock.gem ?? 0) > 0 && <p>The stall does not buy gems: take yours to the Chartmaker's.</p>}
      />
    </div>
  );
}
