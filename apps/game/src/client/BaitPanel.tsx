// The fishmonger's counter, laid out on his shelves (ShopShelf.tsx): worms and shrimp by the tin and the pot, glow
// lures one at a time, rods, and boats. Opened from a word with him at the shack. What each bait does, and what it and
// the boats cost, is in packages/world/src/fishing.ts; the rods are in packages/world/src/fishfight.ts.

import { useEffect, useState } from "react";
import { BAITS, BAIT_IDS, BAIT_SALE, BOAT_IDS, BOAT_SALE, FISHMONGER, FURNISHINGS, HOLE_NAMES, RODS, ROD_IDS, baitBuyProblem, boatBuyProblem, bestRod, rodBuyProblem, type BaitCounts, type BaitId, type BoatId, type RodId, type Vessel } from "@gantt-quest/world";
import { api } from "./api";
import { regularFace } from "./RegularPanel";
import { ShopShelf, type Said, type ShelfWare } from "./ShopShelf";
import { GOLD_ICON, ThingIcon, furnishingIcon } from "./thingIcons";
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

/** What is handed over, for a boat. */
const BOUGHT_BOAT: Record<BoatId, string> = {
  float_barrel: "A barrel, caulked and floating.",
  rowboat: "A rowboat, oars and all.",
};

const BAIT_GLOW: Record<BaitId, string> = { worms: "#d98a7a", shrimp: "#f0a37a", glow_lure: "#9ff0d8" };
const ROD_WOOD: Record<RodId, string> = { cane: "#d8bf7a", greenheart: "#6f8f42", split_cane: "#c07a32" };

export function BaitPanel({ gold, onClose, onGold, onBoat }: {
  /** The player's gold as last read, until the counter says otherwise. */
  gold: number;
  onClose(): void;
  /** Told when buying changes the player's gold. */
  onGold?(): void;
  /** Told when a boat is bought, so the Harbor can put the hero in it. */
  onBoat?(): void;
}) {
  const [bait, setBait] = useState<BaitCounts | null>(null);
  const [rods, setRods] = useState<RodId[]>([]);
  const [vessel, setVessel] = useState<Vessel | null>(null);
  const [purse, setPurse] = useState(gold);
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.bait().then((r) => {
      setBait(r.bait);
      setRods(r.rods);
      setVessel(r.vessel);
      setPurse(r.gold);
    }, (e: Error) => setSaid({ text: e.message, tone: "bad" }));
  }, []);

  const buy = async (kind: BaitId | RodId | BoatId, what: "bait" | "rod" | "boat" = "bait"): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      const r = what === "rod" ? await api.buyRod(kind as RodId) : what === "boat" ? await api.buyBoat(kind as BoatId) : await api.buyBait(kind as BaitId);
      setBait(r.bait);
      setRods(r.rods);
      setVessel(r.vessel);
      setPurse(r.gold);
      setSaid({
        text: what === "rod" ? `${RODS[kind as RodId].name}, rigged and ready. “Look after it, and it'll look after you.”`
          : what === "boat" ? `${BOUGHT_BOAT[kind as BoatId]} “She's tied up at the pier. Walk out onto the water and she's under you.”`
          : `${BOUGHT[kind as BaitId]} “Don't waste it.”`,
        tone: "good",
      });
      onGold?.();
      if (what === "boat") onBoat?.();
      return true;
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const price = (g: number) => <span className="keeper-price"><ThingIcon icon={GOLD_ICON} size={16} /><strong>{g}g</strong></span>;

  const baits: ShelfWare[] = BAIT_IDS.map((kind) => {
    const sale = BAIT_SALE[kind];
    const have = bait?.[kind] ?? 0;
    const problem = baitBuyProblem(kind, have, purse);
    return {
      key: `bait:${kind}`,
      name: BAITS[kind].name,
      color: BAIT_GLOW[kind],
      art: <BaitArt kind={kind} />,
      tag: price(sale.price),
      corner: <span className="ss-ribbon">{sale.per > 1 ? `× ${sale.per}` : "× 1"}</span>,
      facts: [`You have ${have} of ${sale.max}`, sale.lot],
      brief: `${BAITS[kind].blurb} ${FOR[kind]}`,
      problem,
      act: { label: `Buy · ${sale.price}g`, title: problem ?? `Buy ${sale.lot} for ${sale.price} gold`, disabled: busy || !!problem, run: () => buy(kind) },
    };
  });
  const rodWares: ShelfWare[] = ROD_IDS.map((kind) => {
    const rod = RODS[kind];
    const inHand = bestRod(rods) === kind;
    const owned = kind === "cane" || rods.includes(kind);
    const problem = owned ? null : rodBuyProblem(kind, rods, purse);
    return {
      key: `rod:${kind}`,
      name: rod.name,
      color: ROD_WOOD[kind],
      art: <RodArt wood={ROD_WOOD[kind]} />,
      tag: owned ? (inHand ? "In hand" : "Put away") : price(rod.price),
      facts: [inHand ? "The one you fish with" : owned ? "Yours, put away" : "A step up"],
      brief: rod.blurb,
      stamp: owned ? (inHand ? "In hand" : "Yours") : undefined,
      owned,
      problem,
      act: owned ? undefined : { label: `Buy · ${rod.price}g`, title: problem ?? `Buy for ${rod.price} gold`, disabled: busy || !!problem, run: () => buy(kind, "rod") },
    };
  });
  const boats: ShelfWare[] = BOAT_IDS.map((kind) => {
    const def = FURNISHINGS[kind];
    const sale = BOAT_SALE[kind];
    const owned = vessel === sale.vessel;
    const problem = boatBuyProblem(kind, vessel, purse);
    return {
      key: `boat:${kind}`,
      name: def.name,
      color: "#8fc6d8",
      art: <ThingIcon icon={furnishingIcon(kind)} size={68} />,
      tag: owned ? "At the pier" : price(sale.price),
      facts: [owned ? "Yours, at the pier" : "Tied up at the pier"],
      brief: def.blurb,
      stamp: owned ? "At the pier" : undefined,
      owned,
      problem: owned ? null : problem,
      act: owned ? undefined : { label: `Buy · ${sale.price}g`, title: problem ?? `Buy for ${sale.price} gold`, disabled: busy || !!problem, run: () => buy(kind, "boat") },
    };
  });

  return (
    <ShopShelf
      id="harbor.bait"
      title={`${FISHMONGER.short}'s counter`}
      className="bait-panel"
      keeper={{ name: FISHMONGER.name, trade: FISHMONGER.trade, face: regularFace(FISHMONGER.look) }}
      says="Bait doesn't make fish. It makes the right fish bite. Put it on before you cast."
      said={said}
      onDone={onClose}
      doneLabel="Close"
      purse={<span className="cost"><ThingIcon icon={GOLD_ICON} size={18} /> {purse}g</span>}
      loading={!bait && !said ? "He rummages under the counter…" : null}
      shelves={bait ? [
        { id: "bait", title: "Bait", sub: "Put it on before you cast", wares: baits },
        { id: "rods", title: "Rods", sub: "A good rod bends before your line does", wares: rodWares },
        { id: "boats", title: "Boats", sub: "Same as you'd build yourself, if you'd rather pay than saw", wares: boats },
      ] : []}
    />
  );
}

/** A tin of worms, a pot of shrimp, or a glow lure, drawn for the shelf. */
function BaitArt({ kind }: { kind: BaitId }) {
  if (kind === "worms") return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <path d="M22 26c-2-8 4-14 8-10s-4 8 0 12" fill="none" stroke="#7a3a34" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M22 26c-2-8 4-14 8-10s-4 8 0 12" fill="none" stroke="#e08c80" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M38 27c3-9 11-8 10-2s-7 3-6 8" fill="none" stroke="#7a3a34" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M38 27c3-9 11-8 10-2s-7 3-6 8" fill="none" stroke="#d97a70" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="12" y="28" width="40" height="28" rx="3" fill="#8b9aa6" stroke="#2a2e33" strokeWidth="2" />
      <rect x="12" y="36" width="40" height="12" fill="#b8423a" />
      <text x="32" y="45.5" textAnchor="middle" fontSize="8" fontFamily="Georgia, serif" fill="#f6e2c8">WORMS</text>
      <ellipse cx="32" cy="28" rx="20" ry="5" fill="#c6d0d6" stroke="#2a2e33" strokeWidth="2" />
      <ellipse cx="32" cy="28" rx="15" ry="3" fill="#3a2418" />
      <path d="M26 28c2-6 6-6 7-1" fill="none" stroke="#e08c80" strokeWidth="3" strokeLinecap="round" />
      <path d="M15 52h34" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2" />
    </svg>
  );
  if (kind === "shrimp") return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <path d="M20 28c-1-9 8-14 14-10 4 3 2 8-2 9" fill="none" stroke="#7a3412" strokeWidth="6" strokeLinecap="round" />
      <path d="M20 28c-1-9 8-14 14-10 4 3 2 8-2 9" fill="none" stroke="#f4a070" strokeWidth="4" strokeLinecap="round" />
      <path d="M36 26c3-8 13-7 13 0" fill="none" stroke="#7a3412" strokeWidth="6" strokeLinecap="round" />
      <path d="M36 26c3-8 13-7 13 0" fill="none" stroke="#ffb486" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 14l-6-7M33 14l2-8" stroke="#f4a070" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 30h36l-4 22c-1 4-4 5-8 5H26c-4 0-7-1-8-5z" fill="#b5653a" stroke="#3a1c10" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 26h40v6H12z" fill="#cd7a48" stroke="#3a1c10" strokeWidth="2" />
      <path d="M20 40h24M21 46h22" stroke="#8a4424" strokeWidth="2" />
      <path d="M17 34l2 14" stroke="#fff" strokeOpacity="0.2" strokeWidth="2" />
    </svg>
  );
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id="lure-glow">
          <stop offset="0" stopColor="#d8fff2" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#9ff0d8" stopOpacity="0.4" />
          <stop offset="1" stopColor="#9ff0d8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="24" fill="url(#lure-glow)" />
      <path d="M32 6v8" stroke="#c9b28a" strokeWidth="1.5" />
      <circle cx="32" cy="15" r="2.5" fill="none" stroke="#c0c6cc" strokeWidth="1.5" />
      <path d="M32 18c9 4 11 16 6 24-4 6-10 6-13 1-4-8-2-20 7-25z" fill="#6fe0c0" stroke="#1d4a40" strokeWidth="2" />
      <path d="M31 22c5 3 6 10 4 15" fill="none" stroke="#e8fff6" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      <circle cx="36" cy="27" r="3" fill="#fff" stroke="#1d4a40" strokeWidth="1" />
      <circle cx="36.6" cy="27.4" r="1.4" fill="#111" />
      <path d="M31 46v6c0 4 6 4 6 0M31 52c0 4-6 4-6 0" fill="none" stroke="#c0c6cc" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A rod, cork handle and reel, its line run down to a hook: in the wood it is made of. */
function RodArt({ wood }: { wood: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <path d="M58 6C60 20 58 36 54 44" fill="none" stroke="#d8d2c4" strokeWidth="1" strokeDasharray="2 2" />
      <path d="M52 47c0 3 4 3 4 0" fill="none" stroke="#c0c6cc" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 56L58 6" stroke="#1a0c08" strokeWidth="5" strokeLinecap="round" />
      <path d="M10 56L58 6" stroke={wood} strokeWidth="3" strokeLinecap="round" />
      <path d="M8 58l12-12" stroke="#3a2414" strokeWidth="7" strokeLinecap="round" />
      <path d="M8 58l12-12" stroke="#c99a62" strokeWidth="5" strokeLinecap="round" />
      <path d="M11 52l2 2M14 49l2 2" stroke="#8a6238" strokeWidth="1.2" />
      <circle cx="24" cy="46" r="6" fill="#5a6066" stroke="#1a1c1e" strokeWidth="2" />
      <circle cx="24" cy="46" r="2.2" fill="#c0c6cc" />
      <path d="M28 46h5" stroke="#1a1c1e" strokeWidth="2" strokeLinecap="round" />
      <path d="M33 33l2 2M43 23l2 2M51 15l1.6 1.6" stroke="#e0d090" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
