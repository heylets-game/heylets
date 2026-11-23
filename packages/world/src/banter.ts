// The townsfolk talking among themselves: now and then two of them standing near each other (two regulars, or a
// regular and Old Tam at his bar or Hollis by his pillar) have a few words, each line hung over the speaker's head.
//
// Like where the regulars are (wander.ts), who talks when and what is said follows from the crew and the clock
// alone, so everyone in a crew hears the same exchange at the same moment, and nothing is stored or sent.

import { hexDistance, type HexPos } from "@gantt-quest/core";
import { harborSky } from "./gameclock";
import { PUB_BARKEEP, PUB_BARKEEP_POS, PUB_DEALER, PUB_DEALER_POS } from "./pub";
import type { RegularId } from "./regulars";
import { makeRng, seedFromString } from "./rng";
import { regularAbout, regularsAbout } from "./wander";

/**
 * A chance for a word every this long, and how likely one is when two are near: in the pub, where they are close all
 * night, now and then; out in the Harbor, where they meet less often, nearly always.
 */
export const BANTER_SLOT_MS = 20_000;
export const BANTER_CHANCE = { pub: 0.45, harbor: 0.85 } as const;
/** The time between one line and the next, and how long the first waits into its slot. */
export const BANTER_GAP_MS = 3_600;
const BANTER_LEAD_MS = 1_200;
/**
 * How near two must stand to talk: in the pub, next to each other or a step apart (a little further over Tam's bar);
 * out in the Harbor, within calling distance, as they pass the time of day across a lane.
 */
const NEAR = 2;
const NEAR_BAR = 3;
const NEAR_OUT = 4;

/** Who can talk: a regular by id, Old Tam or Hollis. */
type Who = RegularId | "barkeep" | "dealer";
const unitOf = (who: Who) => (who === "barkeep" ? PUB_BARKEEP.id : who === "dealer" ? PUB_DEALER.id : `regular:${who}`);

/** A line said in an exchange, and when (epoch ms), by the speaker's unit id in the scene. */
export interface BanterLine {
  unit: string;
  text: string;
  at: number;
}

/**
 * An exchange: its lines in turn, the first speaker's ("a") and the other's ("b"). For two given people (`pair`, in
 * that order a then b), or anyone who fits `a` and `b`. `when` keeps it to night or day, a storm, or one place.
 */
interface Exchange {
  lines: ["a" | "b", string][];
  pair?: [Who, Who];
  a?: "regular" | "barkeep" | "dealer";
  b?: "regular";
  when?: { night?: boolean; storm?: boolean; place?: "pub" | "harbor" };
}

const R = "regular" as const;
const EXCHANGES: Exchange[] = [
  // Any two regulars, anywhere.
  { a: R, b: R, lines: [["a", "Smell that? Rain by supper."], ["b", "You say that every day."], ["a", "And one day I'll be right."]] },
  { a: R, b: R, lines: [["a", "Heard the crew went out through the gate again."], ["b", "Brave or daft. Hard to tell from here."]] },
  { a: R, b: R, lines: [["a", "Busy day?"], ["b", "Busy enough. Ask me after a drink."]] },
  { a: R, b: R, lines: [["a", "Who's buying?"], ["b", "Not me."], ["a", "Never you."]] },
  { a: R, b: R, lines: [["a", "You look tired."], ["b", "I look like this."]] },
  { a: R, b: R, lines: [["a", "Did you hear what they found in the caverns?"], ["b", "Nothing good ever comes out of the caverns."], ["a", "Gold came out of the caverns."], ["b", "Nothing good."]] },
  // At night in the pub.
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "One more?"], ["b", "One more. Then home."], ["a", "Then one more."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "Tam's stew is fish again."], ["b", "Tam's stew is always fish."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "Who's winning at the dice?"], ["b", "The house, same as ever."]] },
  // By day in the Harbor.
  { a: R, b: R, when: { place: "harbor", night: false }, lines: [["a", "Fine day for it."], ["b", "For what?"], ["a", "Standing about, mostly."]] },
  { a: R, b: R, when: { place: "harbor" }, lines: [["a", "Fish are biting off the point, they say."], ["b", "They always say."]] },
  { a: R, b: R, when: { place: "harbor" }, lines: [["a", "Those huts are going up fast."], ["b", "So's the price of wood."]] },
  // In a storm.
  { a: R, b: R, when: { storm: true }, lines: [["a", "Hear that thunder?"], ["b", "Hard not to."], ["a", "Somebody's boat will be in pieces by morning."]] },
  { a: R, b: R, when: { storm: true, place: "harbor" }, lines: [["a", "Should we be out in this?"], ["b", "Probably not."], ["a", "Right then."]] },
  // Two who know each other.
  { pair: ["pike", "gretta"], lines: [["a", "Your nets hold up in that last blow?"], ["b", "Better than your knees, love."]] },
  { pair: ["moss", "wen"], lines: [["a", "The old light wants a new door."], ["b", "I'll measure it twice."], ["a", "And drink once?"], ["b", "We'll see."]] },
  { pair: ["pike", "dacey"], lines: [["a", "Saw a boat come in last night without a light."], ["b", "Did you now. Must have been a dream."]] },
  { pair: ["gretta", "dacey"], lines: [["a", "Where'd you get that rope, Dacey?"], ["b", "Found it."], ["a", "Tied to a ship?"]] },
  { pair: ["gretta", "wen"], lines: [["a", "Your stool's wobbling again."], ["b", "So's your hand."]] },
  { pair: ["moss", "pike"], lines: [["a", "Thirty years I kept that light."], ["b", "Forty I sailed by it."], ["a", "Then you owe me."]] },
  { pair: ["wen", "dacey"], lines: [["a", "That crate of yours. Who built it?"], ["b", "Why?"], ["a", "Professional interest. It has a false bottom."]] },
  { pair: ["dacey", "moss"], lines: [["a", "Your old light still work, Moss?"], ["b", "Why do you ask?"], ["a", "No reason. Just like to know where it's dark."]] },
  // Old Tam, to a regular near his bar.
  { a: "barkeep", b: R, lines: [["a", "Feet off the rail."], ["b", "They're not on the rail."], ["a", "They were thinking about it."]] },
  { a: "barkeep", b: R, lines: [["a", "Last orders soon."], ["b", "You said that an hour ago."], ["a", "And I meant it then, too."]] },
  { a: "barkeep", b: R, lines: [["a", "Stew's on."], ["b", "What's in it?"], ["a", "Don't ask."]] },
  // Hollis, to a regular near his pillar.
  { a: "dealer", b: R, lines: [["a", "Got any iron going spare?"], ["b", "Only my nerves."], ["a", "Prices on those are down."]] },
  { a: "dealer", b: R, lines: [["b", "What's copper fetching today?"], ["a", "More than you'd think. Less than you'd hope."]] },
  { a: "dealer", b: R, lines: [["a", "Bring me wood by Friday and I'll make it worth your while."], ["b", "What's Friday?"], ["a", "Soon."]] },
];

interface Person {
  who: Who;
  pos: HexPos;
  standing: boolean;
}

/** Who is about in a place at `t`: the day's regulars there, and in the pub Old Tam and Hollis, who never leave it. */
function folk(crewId: string, place: "pub" | "harbor", t: number): Person[] {
  const regs: Person[] = regularsAbout(crewId, t)
    .filter((r) => r.place === place)
    .map((r) => ({ who: r.id, pos: r.pos, standing: !r.walking }));
  if (place === "harbor") return regs;
  return [{ who: "barkeep", pos: PUB_BARKEEP_POS, standing: true }, { who: "dealer", pos: PUB_DEALER_POS, standing: true }, ...regs];
}

const isRegular = (who: Who): who is RegularId => who !== "barkeep" && who !== "dealer";
const fits = (role: Exchange["a"], who: Who) => (role === "regular" ? isRegular(who) : role === who);

/** Whether `p` will stand where it does now through to `until` (a regular might set off mid-sentence). */
function staysPut(crewId: string, p: Person, place: "pub" | "harbor", until: number): boolean {
  if (!isRegular(p.who)) return true;
  const later = regularAbout(crewId, p.who, until);
  return later.place === place && !later.walking && later.pos.q === p.pos.q && later.pos.r === p.pos.r;
}

/**
 * The exchange in the slot `now` falls in, in a place, if there is one: its lines and when each is said. The same
 * for everyone in the crew. Null when nobody is near enough to talk, or the slot passes quietly.
 */
export function banterAt(crewId: string, place: "pub" | "harbor", now: number): BanterLine[] | null {
  const slot = Math.floor(now / BANTER_SLOT_MS);
  const start = slot * BANTER_SLOT_MS;
  const rng = makeRng(seedFromString(`banter|${crewId}|${place}|${slot}`));
  if (rng.next() >= BANTER_CHANCE[place]) return null;
  const people = folk(crewId, place, start).filter((p) => p.standing);
  const sky = harborSky(start);
  // Every pair near enough, either way round, with the exchanges that suit them here and now.
  const options: { a: Person; b: Person; x: Exchange }[] = [];
  for (const a of people) {
    for (const b of people) {
      if (a === b || (!isRegular(a.who) && !isRegular(b.who))) continue;
      const reach = place === "harbor" ? NEAR_OUT : a.who === "barkeep" || b.who === "barkeep" ? NEAR_BAR : NEAR;
      if (hexDistance(a.pos, b.pos) > reach) continue;
      for (const x of EXCHANGES) {
        const w = x.when ?? {};
        if (w.place && w.place !== place) continue;
        if (w.night !== undefined && w.night !== sky.night) continue;
        if (w.storm && !sky.storm) continue;
        if (x.pair ? x.pair[0] !== a.who || x.pair[1] !== b.who : !fits(x.a, a.who) || !fits(x.b, b.who)) continue;
        options.push({ a, b, x });
      }
    }
  }
  if (options.length === 0) return null;
  // A pair's own exchange, where there is one, comes up more often than talk anyone might have.
  const weighted = options.flatMap((o) => (o.x.pair ? [o, o, o] : [o]));
  const { a, b, x } = weighted[Math.floor(rng.next() * weighted.length)];
  const lines = x.lines.map(([who, text], i) => ({ unit: unitOf(who === "a" ? a.who : b.who), text, at: start + BANTER_LEAD_MS + i * BANTER_GAP_MS }));
  const end = lines[lines.length - 1].at + BANTER_GAP_MS;
  if (!staysPut(crewId, a, place, end) || !staysPut(crewId, b, place, end)) return null;
  return lines;
}

/** The pair talking in an exchange (the units of its first two speakers), for turning them to each other. */
export function banterPair(lines: BanterLine[]): [string, string] | null {
  const a = lines[0]?.unit;
  const b = lines.find((l) => l.unit !== a)?.unit;
  return a && b ? [a, b] : null;
}

/** Every line anyone might say, and who it is between where an exchange is for two in particular: for tests. */
export const BANTER_LINES: readonly { pair?: readonly [string, string]; lines: readonly string[] }[] = EXCHANGES.map((x) => ({ pair: x.pair, lines: x.lines.map(([, t]) => t) }));
