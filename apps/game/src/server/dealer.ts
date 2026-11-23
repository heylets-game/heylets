// Hollis Crane, the pub's dealer in materials, in D1 (packages/world/src/dealer.ts has the rules): trading with him
// at his board's prices, within his daily limits, and his supply contracts.
//
// Every change is one batch whose first statement decides whether it goes through (the day's count still under the
// limit, the gold or the materials still there, the contract still as it was read), with the rest guarded on it, so
// two requests at once never both get through.

import {
  CONTRACTS_PER_DAY,
  CONTRACT_EARLY_XP,
  DEALER_BUY_DAILY,
  DEALER_KINDS,
  DEALER_SELL_DAILY,
  addedSlots,
  carryProblem,
  contractDue,
  contractOffers,
  contractPayout,
  dealerBoard,
  deliverable,
  filled,
  gatherDay,
  isDealerKind,
  lapsedPayout,
  stillOwed,
  tradeProblem,
  type ContractOffer,
  type DealerBoard,
  type DealerKind,
} from "@gantt-quest/world";
import { carryState, crewFor, getCharacter } from "./db";
import { prepareXp, xpOutcome, type XpResult } from "./harbor-xp";

type Counts = Partial<Record<DealerKind, number>>;

/** A contract a player holds, as they see it. */
export interface HeldContractView {
  offer: ContractOffer;
  takenAt: number;
  dueAt: number;
  delivered: Counts;
  owed: Counts;
}

/** What his panel shows: the board, what you have traded today and carry, the day's contracts and the one you hold. */
export interface DealerView {
  board: DealerBoard;
  traded: Record<DealerKind, { bought: number; sold: number }>;
  have: Counts;
  gold: number;
  offers: (ContractOffer & { taken: boolean })[];
  /** Contracts taken today, against CONTRACTS_PER_DAY. */
  takenToday: number;
  contract: HeldContractView | null;
  /** How the last contract ended, if it ended since it was last looked at (a lapse is settled when next seen). */
  settled?: { outcome: "filled" | "lapsed" | "dropped"; paid: number };
}

interface ContractRow {
  offer_id: string;
  offer_json: string;
  taken_at: number;
  due_at: number;
  delivered_json: string;
}

const token = () => crypto.randomUUID();
const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** His board is shared by a crew; a crewless player has their own. */
async function boardFor(db: D1Database, playerId: string, at: number): Promise<DealerBoard> {
  const crew = await crewFor(db, playerId);
  return dealerBoard(crew?.id ?? playerId, at);
}

async function haveOf(db: D1Database, playerId: string): Promise<Counts> {
  const rows = await db.prepare("SELECT kind, qty FROM resources WHERE player_id = ?").bind(playerId).all<{ kind: string; qty: number }>();
  const out: Counts = {};
  for (const r of rows.results) if (isDealerKind(r.kind) && r.qty > 0) out[r.kind] = r.qty;
  return out;
}

async function openContract(db: D1Database, playerId: string): Promise<ContractRow | null> {
  return db.prepare("SELECT offer_id, offer_json, taken_at, due_at, delivered_json FROM dealer_contracts WHERE player_id = ? AND done_at IS NULL").bind(playerId).first<ContractRow>();
}

/**
 * End the open contract without filling it (lapsed past its time, or dropped), paying for what was delivered at his
 * buying price. Returns what it paid, or null if there was nothing to end (or it was ended meanwhile).
 */
async function endContract(db: D1Database, playerId: string, row: ContractRow, outcome: "lapsed" | "dropped", at: number): Promise<number | null> {
  const paid = lapsedPayout({ delivered: parse<Counts>(row.delivered_json, {}) });
  const claim = token();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE dealer_contracts SET done_at = ?3, outcome = ?4, paid = ?5, claim = ?6
         WHERE player_id = ?1 AND offer_id = ?2 AND done_at IS NULL AND delivered_json = ?7`,
      )
      .bind(playerId, row.offer_id, at, outcome, paid, claim, row.delivered_json),
    db.prepare("UPDATE characters SET gold = gold + ?2 WHERE player_id = ?1 AND changes() > 0").bind(playerId, paid),
  ]);
  return results[0].meta.changes > 0 ? paid : null;
}

/** A contract past its time is settled when next looked at. */
async function settleLapsed(db: D1Database, playerId: string, at: number): Promise<{ outcome: "lapsed"; paid: number } | null> {
  const row = await openContract(db, playerId);
  if (!row || row.due_at > at) return null;
  const paid = await endContract(db, playerId, row, "lapsed", row.due_at);
  return paid === null ? null : { outcome: "lapsed", paid };
}

export async function dealerView(db: D1Database, playerId: string): Promise<DealerView> {
  const now = Date.now();
  const day = gatherDay(now);
  const settled = await settleLapsed(db, playerId, now);
  const [board, have, c, tradedRows, taken, row] = await Promise.all([
    boardFor(db, playerId, now),
    haveOf(db, playerId),
    getCharacter(db, playerId),
    db.prepare("SELECT kind, bought, sold FROM dealer_trades WHERE player_id = ? AND day = ?").bind(playerId, day).all<{ kind: string; bought: number; sold: number }>(),
    db.prepare("SELECT offer_id FROM dealer_contracts WHERE player_id = ? AND day = ?").bind(playerId, day).all<{ offer_id: string }>(),
    openContract(db, playerId),
  ]);
  const traded = Object.fromEntries(DEALER_KINDS.map((k) => [k, { bought: 0, sold: 0 }])) as DealerView["traded"];
  for (const r of tradedRows.results) if (isDealerKind(r.kind)) traded[r.kind] = { bought: r.bought, sold: r.sold };
  const takenIds = new Set(taken.results.map((r) => r.offer_id));
  const offers = contractOffers(playerId, day).map((o) => ({ ...o, taken: takenIds.has(o.id) }));
  let contract: HeldContractView | null = null;
  if (row) {
    const offer = parse<ContractOffer>(row.offer_json, null as unknown as ContractOffer);
    const delivered = parse<Counts>(row.delivered_json, {});
    contract = { offer, takenAt: row.taken_at, dueAt: row.due_at, delivered, owed: stillOwed({ offer, delivered }) };
  }
  return { board, traded, have, gold: c?.gold ?? 0, offers, takenToday: takenIds.size, contract, ...(settled ? { settled } : {}) };
}

// ---------- trading ----------

/** Count a trade against today's limit for a material, if it still fits, and clear earlier days' counts. */
function countTrade(db: D1Database, playerId: string, day: string, kind: DealerKind, side: "bought" | "sold", qty: number, cap: number, also: string) {
  return db
    .prepare(
      `INSERT INTO dealer_trades (player_id, day, kind, bought, sold)
       SELECT ?1, ?2, ?3, ?4, ?5 WHERE ?6 <= ?7 AND (${also})
       ON CONFLICT(player_id, day, kind) DO UPDATE SET ${side} = ${side} + ?6 WHERE ${side} + ?6 <= ?7`,
    )
    .bind(playerId, day, kind, side === "bought" ? qty : 0, side === "sold" ? qty : 0, qty, cap);
}

/** Sell `qty` of a material to him at his price now. Returns the gold paid, or why not. */
export async function sellToDealer(db: D1Database, playerId: string, kindIn: unknown, qtyIn: unknown): Promise<string | { gold: number; price: number }> {
  if (!isDealerKind(kindIn)) return "He does not deal in that.";
  const kind = kindIn;
  const qty = Number(qtyIn);
  const now = Date.now();
  const day = gatherDay(now);
  const [c, board, done] = await Promise.all([
    getCharacter(db, playerId),
    boardFor(db, playerId, now),
    db.prepare("SELECT bought FROM dealer_trades WHERE player_id = ? AND day = ? AND kind = ?").bind(playerId, day, kind).first<{ bought: number }>(),
  ]);
  if (c?.status !== "active") return "Create a character first.";
  const problem = tradeProblem("sell", qty, done?.bought ?? 0);
  if (problem) return problem;
  const price = board.buys[kind];
  const gold = price * qty;
  const results = await db.batch([
    countTrade(db, playerId, day, kind, "bought", qty, DEALER_BUY_DAILY, `EXISTS (SELECT 1 FROM resources WHERE player_id = ?1 AND kind = ?3 AND qty >= ?6)`),
    db.prepare("UPDATE resources SET qty = qty - ?3 WHERE player_id = ?1 AND kind = ?2 AND qty >= ?3 AND changes() > 0").bind(playerId, kind, qty),
    db.prepare("UPDATE characters SET gold = gold + ?2 WHERE player_id = ?1 AND changes() > 0").bind(playerId, gold),
    db.prepare("DELETE FROM dealer_trades WHERE player_id = ?1 AND day < ?2").bind(playerId, day),
  ]);
  if (results[0].meta.changes === 0) return "You do not have that many, or he has taken all he will of it today.";
  return { gold, price };
}

/** Buy `qty` of a material from him at his price now. Returns the gold spent, or why not. */
export async function buyFromDealer(db: D1Database, playerId: string, kindIn: unknown, qtyIn: unknown): Promise<string | { gold: number; price: number }> {
  if (!isDealerKind(kindIn)) return "He does not deal in that.";
  const kind = kindIn;
  const qty = Number(qtyIn);
  const now = Date.now();
  const day = gatherDay(now);
  const [c, board, done, carry, have] = await Promise.all([
    getCharacter(db, playerId),
    boardFor(db, playerId, now),
    db.prepare("SELECT sold FROM dealer_trades WHERE player_id = ? AND day = ? AND kind = ?").bind(playerId, day, kind).first<{ sold: number }>(),
    carryState(db, playerId),
    haveOf(db, playerId),
  ]);
  if (c?.status !== "active" || !carry) return "Create a character first.";
  const problem = tradeProblem("buy", qty, done?.sold ?? 0) ?? carryProblem(carry, addedSlots(have[kind] ?? 0, qty));
  if (problem) return problem;
  const price = board.sells[kind];
  const gold = price * qty;
  if (c.gold < gold) return "Not enough gold.";
  const results = await db.batch([
    countTrade(db, playerId, day, kind, "sold", qty, DEALER_SELL_DAILY, `EXISTS (SELECT 1 FROM characters WHERE player_id = ?1 AND gold >= ${gold})`),
    db.prepare("UPDATE characters SET gold = gold - ?2 WHERE player_id = ?1 AND gold >= ?2 AND changes() > 0").bind(playerId, gold),
    db
      .prepare("INSERT INTO resources (player_id, kind, qty) SELECT ?1, ?2, ?3 WHERE changes() > 0 ON CONFLICT(player_id, kind) DO UPDATE SET qty = qty + ?3")
      .bind(playerId, kind, qty),
    db.prepare("DELETE FROM dealer_trades WHERE player_id = ?1 AND day < ?2").bind(playerId, day),
  ]);
  if (results[0].meta.changes === 0) return "Not enough gold, or he has sold you all he will of it today.";
  return { gold, price };
}

// ---------- contracts ----------

/** Take one of today's contracts. */
export async function takeContract(db: D1Database, playerId: string, offerId: unknown): Promise<string | HeldContractView> {
  const now = Date.now();
  const day = gatherDay(now);
  const c = await getCharacter(db, playerId);
  if (c?.status !== "active") return "Create a character first.";
  await settleLapsed(db, playerId, now);
  const offer = contractOffers(playerId, day).find((o) => o.id === offerId);
  if (!offer) return "That contract is not on his slate today.";
  const dueAt = contractDue(offer, now);
  const res = await db
    .prepare(
      `INSERT INTO dealer_contracts (player_id, offer_id, day, offer_json, taken_at, due_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE NOT EXISTS (SELECT 1 FROM dealer_contracts WHERE player_id = ?1 AND done_at IS NULL)
         AND (SELECT COUNT(*) FROM dealer_contracts WHERE player_id = ?1 AND day = ?3) < ?7
       ON CONFLICT(player_id, offer_id) DO NOTHING`,
    )
    .bind(playerId, offer.id, day, JSON.stringify(offer), now, dueAt, CONTRACTS_PER_DAY)
    .run()
    .catch(() => null);
  if (!res || res.meta.changes === 0) {
    if (await openContract(db, playerId)) return "Finish or drop the contract you hold first.";
    return `You have taken that one already, or ${CONTRACTS_PER_DAY} contracts today.`;
  }
  return { offer, takenAt: now, dueAt, delivered: {}, owed: stillOwed({ offer, delivered: {} }) };
}

/**
 * Hand in what you carry toward the contract you hold. Filled, it pays its gold and XP (more XP within a day of
 * taking it).
 */
export async function deliverContract(db: D1Database, playerId: string): Promise<string | { contract: HeldContractView | null; gave: Counts; paid?: number; early?: boolean; xp?: XpResult }> {
  const now = Date.now();
  const lapsed = await settleLapsed(db, playerId, now);
  if (lapsed) return `That contract ran out of time. He paid ${lapsed.paid} gold for what you had brought.`;
  const [row, have] = await Promise.all([openContract(db, playerId), haveOf(db, playerId)]);
  if (!row) return "You hold no contract.";
  const offer = parse<ContractOffer>(row.offer_json, null as unknown as ContractOffer);
  const delivered = parse<Counts>(row.delivered_json, {});
  const gave = deliverable({ offer, delivered }, have);
  const kinds = Object.keys(gave) as DealerKind[];
  if (kinds.length === 0) return "You carry nothing he is still owed.";
  const next: Counts = { ...delivered };
  for (const k of kinds) next[k] = (next[k] ?? 0) + gave[k]!;
  const done = filled({ offer, delivered: next });
  const pay = done ? contractPayout({ offer, takenAt: row.taken_at }, now) : null;
  const claim = token();
  // Delivered only if the contract is as it was read and every material is still there.
  const enough = kinds.map((k) => `(SELECT COALESCE(SUM(qty), 0) FROM resources WHERE player_id = ?1 AND kind = '${k}') >= ${gave[k]}`).join(" AND ");
  const claimed = `EXISTS (SELECT 1 FROM dealer_contracts WHERE player_id = ?1 AND claim = '${claim}')`;
  const xp = pay ? await prepareXp(db, playerId, pay.xp, pay.early ? { bonus: CONTRACT_EARLY_XP, bonusFor: "filling it early" } : {}) : null;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE dealer_contracts SET delivered_json = ?3, claim = ?4${done ? ", done_at = ?5, outcome = 'filled', paid = ?6" : ""}
         WHERE player_id = ?1 AND offer_id = ?2 AND done_at IS NULL AND delivered_json = ?7 AND due_at > ?5 AND ${enough}`,
      )
      .bind(playerId, row.offer_id, JSON.stringify(next), claim, now, pay?.gold ?? 0, row.delivered_json),
    ...kinds.map((k) => db.prepare(`UPDATE resources SET qty = qty - ?3 WHERE player_id = ?1 AND kind = ?2 AND ${claimed}`).bind(playerId, k, gave[k])),
    ...(pay ? [db.prepare(`UPDATE characters SET gold = gold + ?2 WHERE player_id = ?1 AND ${claimed}`).bind(playerId, pay.gold)] : []),
    ...(xp?.statements(claimed) ?? []),
  ]);
  if (results[0].meta.changes === 0) return "Something changed just then. Try again.";
  const contract = done ? null : { offer, takenAt: row.taken_at, dueAt: row.due_at, delivered: next, owed: stillOwed({ offer, delivered: next }) };
  return { contract, gave, ...(pay ? { paid: pay.gold, early: pay.early, ...(xp ? { xp: xpOutcome(xp, results) } : {}) } : {}) };
}

/** Give up the contract you hold: he pays for what you delivered at his buying price. */
export async function dropContract(db: D1Database, playerId: string): Promise<string | { paid: number }> {
  const now = Date.now();
  const row = await openContract(db, playerId);
  if (!row) return "You hold no contract.";
  const paid = await endContract(db, playerId, row, row.due_at <= now ? "lapsed" : "dropped", Math.min(now, row.due_at));
  return paid === null ? "Something changed just then. Try again." : { paid };
}
