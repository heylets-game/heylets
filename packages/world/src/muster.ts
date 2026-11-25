// A muster: one of the crew is setting out for a place on the atlas, and
// the rest who are in town are asked whether they are coming.
//
// Whoever sets out calls it. Everyone else in the crew's Harbor is shown
// where to and how long is left, and says "ready" or "not this time". The
// map is made when the caller says "start anyway", when everyone asked has
// answered, or when the time runs out, whichever comes first; it is made for
// as many as are ready, and only they are taken to it. Nobody has to go:
// one who said no, or said nothing, stays in town, and can still walk
// through the waygate to the map later.
//
// Anyone may ready up, even past the most a map takes. If it would set out with
// too many, it does not: the caller chooses who stays behind instead (a hero at
// a time, so a party can come one short), with the heroes who readied last
// picked to begin with. If they do not choose in time, that pick goes.
//
// This file is the rules of it, with no clock and no network of its own: the
// crew's Harbor room (apps/game/src/server/harbor-room.ts) keeps the muster,
// its timer, and makes the map.

import { MAX_PARTY } from "./zone/zone";

/** How long a muster waits for answers. */
export const MUSTER_MS = 60_000;
/** How long the caller has to choose who stays behind, when too many are ready. */
export const MUSTER_CHOOSE_MS = 30_000;
/** How long a muster that has started (or fallen through) is still told to those who ask: long enough for everyone to hear how it ended. */
export const MUSTER_LINGER_MS = 20_000;

/** One of the heroes a member brings with them: their party. */
export interface MusterHero {
  id: string;
  name: string;
}

export interface MusterMember {
  id: string;
  name: string;
  /** How many heroes they bring: themselves and their party. One, when not said. `party`, where it is said, counts instead. */
  heroes?: number;
  /** The rest of their party, who come with them. */
  party?: MusterHero[];
}

export interface Muster {
  id: string;
  /** Who called it: the one setting out. They are ready from the first. */
  by: MusterMember;
  /** Where to: the atlas node, and what to call it. */
  node: string;
  place: string;
  /** What kind of place it is, and the level of what is there, for the prompt. */
  site?: string;
  level?: number;
  /** When it starts whether or not everyone has answered (ms since the epoch). */
  deadline: number;
  /** Who was in town when it was called, besides the caller: the ones it waits for. */
  asked: MusterMember[];
  /** Who is coming, the caller first; and who has said they are not. */
  ready: MusterMember[];
  declined: string[];
  /**
   * More are ready than a map takes, so the caller is choosing who stays behind (until `deadline`, which was put back
   * when the choosing began).
   */
  choosing?: true;
  /** The heroes staying behind (ids): while choosing, the pick so far; once it has started, who did not go. */
  left?: string[];
  /** Once it has started: the map's code, and when. */
  code?: string;
  /** If it fell through (called off, or the map could not be made): why. */
  failed?: string;
  endedAt?: number;
}

/** What someone can say to a muster. "start" (with who stays behind, while choosing) and "cancel" are the caller's alone. */
export type MusterAnswer = "ready" | "no" | "start" | "cancel";
export const MUSTER_ANSWERS: readonly MusterAnswer[] = ["ready", "no", "start", "cancel"];

/** The most heroes a muster takes: as many as a map takes (zone.ts MAX_PARTY), parties and all. */
export const MUSTER_PARTY = MAX_PARTY;

/** How many heroes are ready: everyone ready, with their parties. */
export const musterHeroes = (m: Pick<Muster, "ready">): number => m.ready.reduce((sum, r) => sum + heroesOf(r), 0);
const heroesOf = (m: MusterMember): number => (m.party ? 1 + m.party.length : Math.max(1, m.heroes ?? 1));

/** Every hero ready to go, each with whose they are (the member who brings them), in the order they readied. */
export function musterReadyHeroes(m: Pick<Muster, "ready">): { id: string; name: string; with: string }[] {
  return m.ready.flatMap((r) => [{ id: r.id, name: r.name, with: r.id }, ...(r.party ?? []).map((h) => ({ ...h, with: r.id }))]);
}

/**
 * How many heroes go, with `left` staying behind. A member left behind takes their party with them: it comes onto the
 * map with them or not at all. Where only a count is known for a member (no `party`), it is that count or none.
 */
export function musterGoing(m: Pick<Muster, "ready">, left: readonly string[] = []): number {
  return m.ready.reduce((sum, r) => (left.includes(r.id) ? sum : sum + (r.party ? 1 + r.party.filter((h) => !left.includes(h.id)).length : heroesOf(r))), 0);
}

/** Whether more are ready than a map takes. */
export const musterOver = (m: Pick<Muster, "ready">): boolean => musterHeroes(m) > MUSTER_PARTY;

/**
 * Who stays behind unless the caller says otherwise: heroes off the end of the ready list until the rest fit, those
 * who readied last first, and each member's party before the member. Never the caller.
 */
export function musterLeftPick(m: Pick<Muster, "ready" | "by">): string[] {
  const left: string[] = [];
  for (const r of [...m.ready].reverse()) {
    for (const id of [...(r.party ?? []).map((h) => h.id).reverse(), ...(r.id === m.by.id ? [] : [r.id])]) {
      if (musterGoing(m, left) <= MUSTER_PARTY) return left;
      left.push(id);
    }
  }
  return left;
}

/** Who stays behind as the caller asked: only heroes who are ready, and never the caller. Null if the rest would not fit. */
export function musterLeftAsked(m: Pick<Muster, "ready" | "by">, asked: unknown): string[] | null {
  const ids = new Set(musterReadyHeroes(m).map((h) => h.id));
  const left = Array.isArray(asked) ? [...new Set(asked.filter((id): id is string => typeof id === "string" && ids.has(id) && id !== m.by.id))] : [];
  return musterGoing(m, left) <= MUSTER_PARTY ? left : null;
}

export function callMuster(id: string, by: MusterMember, to: { node: string; place: string; site?: string; level?: number }, asked: MusterMember[], now: number): Muster {
  return {
    id,
    by,
    node: to.node,
    place: to.place,
    ...(to.site ? { site: to.site } : {}),
    ...(to.level !== undefined ? { level: to.level } : {}),
    deadline: now + MUSTER_MS,
    asked: asked.filter((m) => m.id !== by.id),
    ready: [by],
    declined: [],
  };
}

/** Whether it is still waiting for answers. */
export const musterOpen = (m: Muster | null | undefined): boolean => !!m && !m.code && !m.failed;

/** Whether it is worth telling anyone about: waiting, or ended so lately that not everyone may have heard. */
export const musterShown = (m: Muster | null | undefined, now: number): boolean => !!m && (musterOpen(m) || (m.endedAt !== undefined && now - m.endedAt < MUSTER_LINGER_MS));

/** Whether everyone it waits for has said one thing or the other. */
export const musterAnswered = (m: Muster): boolean => m.asked.every((a) => m.ready.some((r) => r.id === a.id) || m.declined.includes(a.id));

/**
 * Whether it should start now (or, with too many, have the caller choose who stays behind): the time is up, everyone
 * asked has answered, or there is no room for another hero. While the caller is choosing, only once their time is up.
 */
export const musterDue = (m: Muster, now: number): boolean =>
  musterOpen(m) && (m.choosing ? now >= m.deadline : now >= m.deadline || musterAnswered(m) || musterHeroes(m) >= MUSTER_PARTY);

/**
 * It is due, or the caller has said to start (`asked`: who they leave behind, if they said). With room for everyone
 * left to go, it starts (`start`), and `left` says who stays. With too many, the caller is given time to choose: the
 * muster comes back choosing, with the pick so far. Once the time to choose is up, that pick goes.
 */
export function settleMuster(m: Muster, now: number, asked?: unknown): { muster: Muster; start?: true } {
  const going = (left: string[]): { muster: Muster; start: true } => {
    const { choosing: _choosing, left: _left, ...rest } = m;
    return { muster: { ...rest, ...(left.length > 0 ? { left } : {}) }, start: true };
  };
  if (!musterOver(m)) return going([]);
  const chosen = asked === undefined ? null : musterLeftAsked(m, asked);
  if (chosen) return going(chosen);
  const pick = (m.choosing && musterLeftAsked(m, m.left)) || musterLeftPick(m);
  if (m.choosing && now >= m.deadline) return going(pick);
  return { muster: { ...m, choosing: true, left: pick, ...(m.choosing ? {} : { deadline: now + MUSTER_CHOOSE_MS }) } };
}

/**
 * Someone answers. Returns the muster as it now stands and whether that answer starts it (`start`: settle it, which
 * may instead have the caller choose who stays behind) or calls it off (`cancel`), or why the answer was not taken
 * (`error`). The muster handed in is not changed.
 */
export function answerMuster(m: Muster, who: MusterMember, answer: MusterAnswer, now: number): { muster: Muster; start?: true; cancel?: true } | { error: string } {
  const res = answerOnly(m, who, answer, now);
  // While the caller chooses, a change in who is coming changes the pick: what was picked of those still ready stays
  // picked, as long as it still leaves room for the rest. If everyone now fits, there is nothing to choose.
  if ("error" in res || res.start || res.cancel || !res.muster.choosing) return res;
  if (!musterOver(res.muster)) return { muster: res.muster, start: true };
  return { muster: { ...res.muster, left: musterLeftAsked(res.muster, res.muster.left) ?? musterLeftPick(res.muster) } };
}

function answerOnly(m: Muster, who: MusterMember, answer: MusterAnswer, now: number): { muster: Muster; start?: true; cancel?: true } | { error: string } {
  if (!musterOpen(m)) return { error: m.code ? "They have set out already." : "That muster is over." };
  const caller = who.id === m.by.id;
  if (answer === "start" || answer === "cancel") {
    if (!caller) return { error: `Only ${m.by.name} can do that: it is their muster.` };
    return answer === "start" ? { muster: m, start: true } : { muster: m, cancel: true };
  }
  if (caller) return { error: "You called it: you are going. Call it off if you are not." };
  const others = m.ready.filter((r) => r.id !== who.id);
  if (answer === "ready") {
    // Past the most a map takes is fine: the caller chooses who stays behind.
    const next: Muster = { ...m, ready: [...others, who], declined: m.declined.filter((id) => id !== who.id) };
    return musterDue(next, now) ? { muster: next, start: true } : { muster: next };
  }
  const next: Muster = { ...m, ready: others, declined: [...m.declined.filter((id) => id !== who.id), who.id] };
  return musterDue(next, now) ? { muster: next, start: true } : { muster: next };
}
