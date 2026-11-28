// Dealing with the chartmaker (the lapidary, in the code), standing in front
// of her in her shop (KeeperView): everything to do with charters (lodestones,
// in the code) and gems. She draws up a blank one from fur and wood, works the
// ones you carry at her bench (fuse, attune, temper, reroll, shown as bind,
// annotate, seal, redraw: atlas/StoneBench.tsx), and buys gems for gold.
//
// It stands on the same shelves as the smith's and the apothecary's
// (ShopShelf.tsx): her face and her last word at the top with what you hold,
// the gems she buys on a shelf, and her bench on the back wall under it.
// Unlike theirs there is no stock and nothing to haggle over, and nothing to
// ask the server for on the way in: what you carry is in `me`.
//
// What can be done is worked out here only to grey out buttons; the server
// checks every cut, piece of work and sale again.

import { useState } from "react";
import { GEM_PRICE, KEEPER_PLACES, stoneName, type Lodestone } from "@gantt-quest/world";
import { api, type Me } from "../api";
import { StoneBench } from "../atlas/StoneBench";
import { RewardChips } from "../hutDrops";
import { regularFace } from "../RegularPanel";
import { ShopShelf, type Said, type ShelfWare } from "../ShopShelf";
import { GOLD_ICON, ThingIcon, resourceIcon } from "../thingIcons";
import "./works.css";

/** What she says, out loud over her head, to each thing she does for you. */
const SAYS = {
  cut: "Blank and true. It will open a place, and no more.",
  fuse: "Three into one. Look what it kept of each.",
  attune: "The ink has taken. Mind where you carry that.",
  temper: "Sealed, and sterner for it. So is wherever it takes you.",
  reroll: "Not what it was. That is all I promise.",
  gem: "A fair stone. Done.",
  gems: "Good colour, the lot. I will take them.",
} as const;

export function LapidaryKeeperPanel({ me, refresh, onSay, onDone }: {
  me: Me;
  /** Fetch the hero again (gold, the pack, the lodestones in it). */
  refresh(): Promise<unknown>;
  /** The keeper says something out loud, over her head. */
  onSay(text: string): void;
  /** Step back from the keeper, which puts the panel away. */
  onDone(): void;
}) {
  const { keeper, title } = KEEPER_PLACES.lapidary;
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState(false);
  const gold = me.character?.gold ?? 0;
  const held = me.materials ?? {};
  const gems = held.gem ?? 0;

  const made = (stone: Lodestone, how: keyof typeof SAYS) => {
    onSay(SAYS[how]);
    setSaid({ text: `“${SAYS[how]}” ${how === "cut" ? "A blank charter" : stoneName(stone)} goes into your pack.`, tone: "good" });
  };
  const sell = async (qty: number): Promise<boolean> => {
    setBusy(true);
    setSaid(null);
    try {
      const res = await api.sellGems(qty);
      await refresh();
      const line = qty === 1 ? SAYS.gem : SAYS.gems;
      onSay(line);
      setSaid({ text: `“${line}” ${qty === 1 ? "A gem" : `${qty} gems`} for ${res.gold}g.`, tone: "good" });
      return true;
    } catch (e) {
      setSaid({ text: (e as Error).message, tone: "bad" });
      void refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const gemIcon = resourceIcon("gem");
  const gemWare: ShelfWare = {
    key: "gem",
    name: "Gems",
    color: gemIcon.color,
    art: <ThingIcon icon={gemIcon} size={68} />,
    full: true,
    tag: <>Pays <ThingIcon icon={GOLD_ICON} size={16} />{GEM_PRICE}g</>,
    corner: <span className="ss-ribbon">You carry {gems}</span>,
    facts: [`You carry ${gems}`, `${GEM_PRICE}g each`],
    brief: "Sealing a charter takes gems, and so does annotating one with a boon. Sell what you will not spend.",
    problem: gems < 1 ? "You carry no gems." : null,
    act: { label: `Sell 1 · ${GEM_PRICE}g`, disabled: busy || gems < 1, run: () => sell(1) },
    more: gems > 1 ? <button className="small" disabled={busy} onClick={() => void sell(gems)}>Sell all {gems} · {GEM_PRICE * gems}g</button> : undefined,
  };

  return (
    <ShopShelf
      id="keeper.lapidary"
      title={title}
      className="keeper-lapidary"
      keeper={{ name: keeper.name, trade: keeper.trade, face: regularFace(keeper.look) }}
      says={keeper.line}
      said={said}
      onDone={onDone}
      purse={<RewardChips zeros gold={gold} resources={{ gem: gems, fur: held.fur ?? 0, wood: held.wood ?? 0 }} />}
      shelves={[
        { id: "gems", title: "Gems she buys", sub: `${GEM_PRICE}g each · sealing and annotating take them too`, wares: [gemWare] },
        { id: "bench", title: "At her bench", sub: "Charters drawn up blank, or worked · out of your pack", wares: [], body: <StoneBench me={me} refresh={refresh} onMade={made} /> },
      ]}
      notes={<p>Gems turn up in the quarry's seams and geodes, in a pearl oyster on the line, and now and then on what you beat out on the maps.</p>}
    />
  );
}
