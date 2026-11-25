// What the townsfolk have heard about a crew, for their talk among themselves (packages/world/src/banter.ts says how
// it is said): whose garden is coming on, who set out for where on the atlas lately, who carries a weapon worth a
// remark, the crew's newest record catches, and the newest lines on the notice board. Only heroes of the crew are
// named, and only to the crew.

import { FISH, atlasNodeById, formatWeight, type Gossip } from "@gantt-quest/world";
import { RELEASES } from "../releases";

/** How far back a trip or a catch is still talked about. */
export const GOSSIP_RECENT_MS = 3 * 86_400_000;
/** The most of each kind of gossip there is at once. */
export const GOSSIP_EACH = 3;
/** The longest a line from the notice board may be to be read out in a bubble. */
const NEWS_MAX = 80;

/** A notice-board line as it would be read out: "Fishing: a perfect catch pays a little more." */
export function newsLine(area: string | null, text: string): string {
  const said = `${area ? `${area}: ` : ""}${text.trim()}`;
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/** What there is to say about a crew now. Never throws: a failed read leaves that kind out. */
export async function crewGossip(db: D1Database, crewId: string, now = Date.now()): Promise<Gossip[]> {
  const since = now - GOSSIP_RECENT_MS;
  const read = <T>(sql: string, ...binds: unknown[]) =>
    db
      .prepare(sql)
      .bind(...binds)
      .all<T>()
      .then((r) => r.results, () => [] as T[]);
  const member = "SELECT m.player_id FROM crew_members m JOIN characters c ON c.player_id = m.player_id AND c.status = 'active' WHERE m.crew_id = ?1";
  const [names, gardens, trips, weapons, catches] = await Promise.all([
    read<{ id: string; name: string }>(`SELECT m.player_id AS id, c.name FROM crew_members m JOIN characters c ON c.player_id = m.player_id AND c.status = 'active' WHERE m.crew_id = ?1`, crewId),
    // Each member's garden here: its beds, what most of them grow, and how many are ready.
    read<{ player_id: string; beds: number; mushrooms: number; ready: number }>(
      `SELECT player_id, COUNT(*) AS beds, SUM(crop = 'mushrooms') AS mushrooms, SUM(ready_at <= ?2) AS ready
       FROM garden_beds WHERE crew_id = ?1 AND player_id IN (${member}) GROUP BY player_id ORDER BY ready DESC, beds DESC LIMIT ${GOSSIP_EACH}`,
      crewId,
      now,
    ),
    // The landfalls set out for lately, and by whom.
    read<{ opened_by: string; node: string; status: string }>(
      `SELECT opened_by, node, status FROM atlas_nodes WHERE crew_id = ?1 AND opened_by IS NOT NULL AND opened_at > ?2 ORDER BY opened_at DESC LIMIT ${GOSSIP_EACH}`,
      crewId,
      since,
    ),
    // The best weapon in a member's hand, if it is more than common.
    read<{ player_id: string; name: string }>(
      `SELECT player_id, name FROM inventory WHERE player_id IN (${member}) AND slot = 'main_hand' AND equipped = 1 AND rarity != 'common' ORDER BY power DESC LIMIT ${GOSSIP_EACH}`,
      crewId,
    ),
    // The crew's newest records at the bar.
    read<{ player_id: string; species: string; grams: number }>(
      `SELECT player_id, species, grams FROM fish_records WHERE crew_id = ?1 AND caught_at > ?2 ORDER BY caught_at DESC LIMIT ${GOSSIP_EACH}`,
      crewId,
      since,
    ),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const out: Gossip[] = [];
  for (const g of gardens) {
    const who = nameOf.get(g.player_id);
    if (who) out.push({ kind: "garden", who, crop: g.mushrooms * 2 > g.beds ? "mushrooms" : "herbs", beds: g.beds, ready: g.ready > 0 });
  }
  for (const t of trips) {
    const who = nameOf.get(t.opened_by);
    const place = atlasNodeById(crewId, t.node)?.name;
    if (who && place) out.push({ kind: "voyage", who, place, cleared: t.status === "cleared" });
  }
  for (const w of weapons) {
    const who = nameOf.get(w.player_id);
    if (who) out.push({ kind: "gear", who, item: w.name });
  }
  for (const f of catches) {
    const who = nameOf.get(f.player_id);
    const fish = FISH[f.species]?.name;
    if (who && fish) out.push({ kind: "fish", who, fish: fish.toLowerCase(), weight: formatWeight(f.grams) });
  }
  const news = RELEASES.find((r) => !r.unreleased && r.notes.length > 0);
  for (const n of (news?.notes ?? []).map((n) => newsLine(n.area, n.text)).filter((t) => t.length <= NEWS_MAX).slice(0, GOSSIP_EACH)) {
    out.push({ kind: "news", text: n });
  }
  return out;
}
