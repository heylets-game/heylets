// The pub's menu in D1: ordering a meal.

import { gatherDay, mealOutings, pubItem } from "@gantt-quest/world";

// ---------- the pub ----------

/**
 * Eat a meal off the pub's menu: one a day. The price comes from the menu, never the caller. Gold is taken and the
 * meal marked eaten in one statement, so a second meal the same day costs nothing and does nothing; the outings it
 * gives back (pub.ts MealPerk) are given in the next, which only writes if the first one did. The meal's stat
 * points are not written anywhere: heroInitFor adds them to the hero while the day lasts. `outings` is how many came
 * back (none if none had been used today).
 */
export async function orderAtPub(db: D1Database, playerId: string, itemId: string): Promise<string | { outings: number }> {
  const item = pubItem(itemId);
  if (!item) return "That is not on the menu.";
  const today = gatherDay(Date.now());
  const back = mealOutings(item);
  const [before, paid] = await db.batch([
    // How many of today's outings were used before the meal, read in the same batch as the meal is eaten.
    db.prepare("SELECT used FROM gathering WHERE player_id = ?1 AND day = ?2").bind(playerId, today),
    db
      .prepare("UPDATE characters SET gold = gold - ?1, meal = ?3, meal_day = ?4 WHERE player_id = ?2 AND status = 'active' AND gold >= ?1 AND (meal_day IS NULL OR meal_day <> ?4)")
      .bind(item.price, playerId, item.id, today),
    db
      .prepare("UPDATE gathering SET used = MAX(0, used - ?3) WHERE player_id = ?1 AND changes() > 0 AND day = ?2 AND used > 0")
      .bind(playerId, today, back),
  ]);
  if (paid.meta.changes === 0) {
    const c = await db.prepare("SELECT meal_day FROM characters WHERE player_id = ?").bind(playerId).first<{ meal_day: string | null }>();
    return c?.meal_day === today ? "You have eaten today. Old Tam will feed you again tomorrow." : "You cannot afford that.";
  }
  const used = (before.results[0] as { used: number } | undefined)?.used ?? 0;
  return { outings: Math.min(back, Math.max(0, used)) };
}
