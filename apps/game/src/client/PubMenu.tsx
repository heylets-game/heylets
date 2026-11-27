// The pub's menu board, at the bar: each meal with what it does for whoever eats it (pub.ts MealPerk), what today's
// meal is still doing for you, and the button to eat. A hero eats one meal a day.

import { useState } from "react";
import { PUB_MENU, dueIn, fedBy, mealEndsAt, mealPerkText, mealStats, statBonusText, type MealPerk } from "@gantt-quest/world";
import { api, type Me } from "./api";
import { blurb, label } from "./labels";
import { ThingIcon, pubIcon } from "./thingIcons";

/** A perk's line on the board: stat points read as a boost, outings as something given back. */
function PerkLine({ perk }: { perk: MealPerk }) {
  return <li className={perk.kind === "stats" ? "boost" : "back"}>{mealPerkText(perk)}</li>;
}

/** `day` is the UTC day the board is for (the pub keeps it, ticking over at midnight), so a meal eaten yesterday stops showing. */
export function PubMenu({ me, refresh }: { me: Me; refresh(): Promise<unknown>; day: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the last meal ordered here did, said once it is eaten. */
  const [ate, setAte] = useState<{ id: string; outings: number } | null>(null);
  const c = me.character;
  const gold = c?.gold ?? 0;
  const now = Date.now();
  // The pub passes a new `day` at midnight, and this is worked out again: yesterday's meal no longer counts.
  const fed = c ? fedBy(c, now) : undefined;
  const wearsOff = dueIn(mealEndsAt(now) - now);

  const order = async (itemId: string) => {
    setBusy(true);
    setError(null);
    setAte(null);
    try {
      const res = await api.pubOrder(itemId);
      setAte({ id: itemId, outings: res.outings ?? (res.rested ? 1 : 0) });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>The board</h3>
      <p className="muted">One meal a day. What it gives you lasts until the day turns, {wearsOff}.</p>
      <ul className="pub-menu">
        {PUB_MENU.map((item) => {
          const eaten = fed?.id === item.id;
          const why = fed ? "You have eaten today. Come back tomorrow." : gold < item.price ? "You cannot afford it" : "";
          return (
            <li key={item.id} className={eaten ? "eaten" : ""}>
              <ThingIcon icon={pubIcon(item.id)} size={36} />
              <div className="grow">
                <strong>{label("pub", item.id)}</strong>
                <div className="muted">{blurb("pub", item.id)}</div>
                <ul className="pub-perks">
                  {item.perks.map((p, i) => <PerkLine key={i} perk={p} />)}
                </ul>
              </div>
              <button className="small primary" disabled={busy || !!fed || gold < item.price} title={why} onClick={() => void order(item.id)}>
                {eaten ? "Eaten" : `${item.price}g`}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="bad">{error}</p>}
      {ate && (
        <p className="good">
          {ate.outings > 0
            ? `That set you up: ${ate.outings === 1 ? "one gathering outing is" : `${ate.outings} gathering outings are`} yours again today.`
            : "You eat. No outings come back: you have not used any today."}
        </p>
      )}
      {fed && <p className="pub-fed">Well fed on {label("pub", fed.id)}: {statBonusText(mealStats(fed))} until the day turns, {wearsOff}.</p>}
    </>
  );
}
