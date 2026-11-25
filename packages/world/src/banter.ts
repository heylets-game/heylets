// The townsfolk talking among themselves: now and then two of them standing near each other (two regulars, or a
// regular and Old Tam at his bar or Hollis by his pillar) have a few words, each line hung over the speaker's head.
//
// Like where the regulars are (wander.ts), who talks when and what is said follows from the crew and the clock
// alone, so everyone in a crew hears the same exchange at the same moment, and nothing is stored or sent. Two kinds
// of talk:
//
//   small talk  written here. Each day (UTC) about half of it is in play, so one day's talk is not the next's.
//   gossip      about the crew itself: a hero's garden, their last trip out, the weapon they carry, a record catch,
//               what is new on the notice board. The server says what there is (routes/gossip.ts, as `Gossip`),
//               and the lines for it are written here with a gap for the name.
//
// Within a day the topics that fit who is standing near whom come up in a shuffled order, each once before any comes
// round again, so the same words are not heard twice in a few minutes.

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
/** How much of the small talk is in play on a day. */
export const BANTER_DAILY_SHARE = 0.5;
const DAY_MS = 86_400_000;
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

/** Something the crew has been up to, for the townsfolk to talk about. `who` is a hero's name. */
export type Gossip =
  /** A hero's garden: how many beds, of what, and whether any is ready to pick. */
  | { kind: "garden"; who: string; crop: "herbs" | "mushrooms"; beds: number; ready: boolean }
  /** The last place a hero set out for on the atlas, and whether it is cleared. */
  | { kind: "voyage"; who: string; place: string; cleared: boolean }
  /** The weapon a hero carries, when it is worth remarking on. */
  | { kind: "gear"; who: string; item: string }
  /** A crew record catch: the fish's name and its weight, written out. */
  | { kind: "fish"; who: string; fish: string; weight: string }
  /** A line from the notice board, as it would be read out. */
  | { kind: "news"; text: string };

/** What a piece of gossip is about, for telling one from another. */
export function gossipKey(g: Gossip): string {
  switch (g.kind) {
    case "garden":
      return `garden|${g.who}|${g.crop}|${g.ready}`;
    case "voyage":
      return `voyage|${g.who}|${g.place}|${g.cleared}`;
    case "gear":
      return `gear|${g.who}|${g.item}`;
    case "fish":
      return `fish|${g.who}|${g.fish}`;
    case "news":
      return `news|${g.text}`;
  }
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
  { a: R, b: R, lines: [["a", "Tide's turning."], ["b", "It does that."], ["a", "Twice a day, regular as you like."]] },
  { a: R, b: R, lines: [["a", "Ever wonder what's past the last landfall on the chart?"], ["b", "No."], ["a", "Me neither, really."]] },
  { a: R, b: R, lines: [["a", "My back's telling me rain."], ["b", "Your back's been wrong since spring."]] },
  { a: R, b: R, lines: [["a", "Gulls are loud today."], ["b", "Somebody's been feeding them."], ["a", "Wasn't me."]] },
  { a: R, b: R, lines: [["a", "You still owe me two coppers."], ["b", "I owe the whole Harbor two coppers."]] },
  { a: R, b: R, lines: [["a", "Quiet today."], ["b", "Don't say that. It hears you."]] },
  { a: R, b: R, lines: [["a", "What's the news?"], ["b", "Same as yesterday, but louder."]] },
  { a: R, b: R, lines: [["a", "Had the strangest dream about a whale."], ["b", "The one in the hat?"], ["a", "How did you know?"]] },
  // At night in the pub.
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "One more?"], ["b", "One more. Then home."], ["a", "Then one more."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "Tam's stew is fish again."], ["b", "Tam's stew is always fish."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "Who's winning at the dice?"], ["b", "The house, same as ever."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "This stool's warm."], ["b", "It was mine till you sat on it."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "Tam's watering the stew again."], ["b", "Keeps it from running off."]] },
  { a: R, b: R, when: { place: "pub" }, lines: [["a", "Sing something."], ["b", "Absolutely not."]] },
  // By day in the Harbor.
  { a: R, b: R, when: { place: "harbor", night: false }, lines: [["a", "Fine day for it."], ["b", "For what?"], ["a", "Standing about, mostly."]] },
  { a: R, b: R, when: { place: "harbor" }, lines: [["a", "Fish are biting off the point, they say."], ["b", "They always say."]] },
  { a: R, b: R, when: { place: "harbor" }, lines: [["a", "Those huts are going up fast."], ["b", "So's the price of wood."]] },
  { a: R, b: R, when: { place: "harbor" }, lines: [["a", "Smells like tar and fish."], ["b", "Smells like home, you mean."]] },
  { a: R, b: R, when: { place: "harbor", night: false }, lines: [["a", "Busy at the well this morning."], ["b", "Everyone's got a garden now."]] },
  { a: R, b: R, when: { place: "harbor" }, lines: [["a", "Look at the mud on this pier."], ["b", "Look at the boots that brought it."]] },
  // In a storm.
  { a: R, b: R, when: { storm: true }, lines: [["a", "Hear that thunder?"], ["b", "Hard not to."], ["a", "Somebody's boat will be in pieces by morning."]] },
  { a: R, b: R, when: { storm: true, place: "harbor" }, lines: [["a", "Should we be out in this?"], ["b", "Probably not."], ["a", "Right then."]] },
  { a: R, b: R, when: { storm: true }, lines: [["a", "Tie down anything you love."], ["b", "Even you?"], ["a", "Especially me."]] },
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
  { a: "barkeep", b: R, lines: [["a", "You paying for that?"], ["b", "Put it on the slate."], ["a", "The slate's full."]] },
  { a: "barkeep", b: R, lines: [["a", "Wipe your boots next time."], ["b", "I did."], ["a", "Wipe them harder."]] },
  // Hollis, to a regular near his pillar.
  { a: "dealer", b: R, lines: [["a", "Got any iron going spare?"], ["b", "Only my nerves."], ["a", "Prices on those are down."]] },
  { a: "dealer", b: R, lines: [["b", "What's copper fetching today?"], ["a", "More than you'd think. Less than you'd hope."]] },
  { a: "dealer", b: R, lines: [["a", "Bring me wood by Friday and I'll make it worth your while."], ["b", "What's Friday?"], ["a", "Soon."]] },
  { a: "dealer", b: R, lines: [["a", "Copper's up."], ["b", "Is that good?"], ["a", "For me."]] },
  { a: "dealer", b: R, lines: [["b", "Buy my old nails?"], ["a", "Bent ones go for half."], ["b", "They're all bent."]] },
];

/**
 * What is said about each kind of gossip, a few ways each (one is picked for the day): `{who}` and the rest are
 * filled in from it. Anyone near enough may say it, to anyone.
 */
type GossipLines = ["a" | "b", string][];
const fill = (lines: GossipLines, gaps: Record<string, string | number>): GossipLines =>
  lines.map(([w, t]) => [w, t.replace(/\{(\w+)\}/g, (m, k: string) => (k in gaps ? String(gaps[k]) : m))]);
const sayGossip: { [K in Gossip["kind"]]: (g: Extract<Gossip, { kind: K }>) => GossipLines[] } = {
  garden: (g) => {
    const crop = g.crop === "mushrooms" ? "mushroom" : "herb";
    const gaps = { who: g.who, crop, crops: g.crop, beds: g.beds };
    return (
      g.ready
        ? [
            [["a", "Have you seen {who}'s {crop} garden?!"], ["b", "Seen it? I can smell it from the pier."]],
            [["a", "{who}'s {crops} are ready for picking."], ["b", "Before the gulls get them, I hope."]],
          ]
        : [
            [["a", "{who}'s got {crop} beds coming up by the hut."], ["b", "Green fingers, that one."]],
            [["a", "Saw {who} out with the {crops} again."], ["b", "Talks to them, I hear."], ["a", "Do they talk back?"]],
          ]
    ).map((l) => fill(l as GossipLines, gaps));
  },
  voyage: (g) =>
    (g.cleared
      ? [
          [["a", "Did you hear about that last trip {who} went on?"], ["b", "{place}? Cleared it, I heard."], ["a", "Drinks are on {who}, then."]],
          [["a", "{who} came back from {place} grinning."], ["b", "Grinning's better than limping."]],
        ]
      : [
          [["a", "Did you hear 'bout that last excursion {who} went on?"], ["b", "{place}? Not cleared yet, I heard."], ["a", "It never goes right the first time."]],
          [["a", "{who}'s set on {place}."], ["b", "Brave or daft."], ["a", "Hard to tell from here."]],
        ]
    ).map((l) => fill(l as GossipLines, { who: g.who, place: g.place })),
  gear: (g) =>
    (
      [
        [["a", "{who} just went by waving that {item}."], ["a", "Kinda weird if you ask me."], ["b", "Yeah, I agree."]],
        [["a", "Did you see what {who} is carrying now?"], ["b", "That {item}? Hard to miss."]],
      ] as GossipLines[]
    ).map((l) => fill(l, { who: g.who, item: g.item })),
  fish: (g) =>
    (
      [
        [["a", "{who} landed a {weight} {fish}!"], ["b", "I'll believe it when it's on the wall."]],
        [["a", "Seen the size of {who}'s {fish}?"], ["b", "Everyone has. Twice."]],
      ] as GossipLines[]
    ).map((l) => fill(l, { who: g.who, fish: g.fish, weight: g.weight })),
  news: (g) =>
    (
      [
        [["a", "Read the board lately?"], ["b", "{news}"], ["a", "Huh. Fancy that."]],
        [["a", "New notice up on the board."], ["b", "What's it say?"], ["a", "{news}"], ["b", "About time."]],
      ] as GossipLines[]
    ).map((l) => fill(l, { news: g.text })),
};

/** Every way a piece of gossip may be said. */
export const gossipLines = (g: Gossip): GossipLines[] => (sayGossip[g.kind] as (g: Gossip) => GossipLines[])(g);

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

/** A number in [0, 1) that follows from `key` alone. */
const hash01 = (key: string) => makeRng(seedFromString(key)).next();

/** Whether a piece of small talk (by its place in EXCHANGES) is in play on a day, for a crew. */
export const smallTalkToday = (crewId: string, day: number, index: number): boolean => hash01(`banter-day|${crewId}|${day}|${index}`) < BANTER_DAILY_SHARE;

/** Something that may be talked about: who may say it to whom, and how it goes for a given two. */
interface Topic {
  key: string;
  fits(a: Who, b: Who): boolean;
  lines: ["a" | "b", string][];
}

/** Slots back within which a topic is not taken up again (three minutes). */
export const BANTER_NO_REPEAT = 9;

/** Who could talk in a slot and what about, in the day's order: null when it passes quietly or nobody is near. */
function slotTalk(crewId: string, place: "pub" | "harbor", slot: number, gossip: readonly Gossip[]) {
  const start = slot * BANTER_SLOT_MS;
  const rng = makeRng(seedFromString(`banter|${crewId}|${place}|${slot}`));
  if (rng.next() >= BANTER_CHANCE[place]) return null;
  const people = folk(crewId, place, start).filter((p) => p.standing);
  const sky = harborSky(start);
  const day = Math.floor(start / DAY_MS);

  // Every pair near enough, either way round (never Tam and Hollis alone together).
  const pairs: [Person, Person][] = [];
  for (const a of people) {
    for (const b of people) {
      if (a === b || (!isRegular(a.who) && !isRegular(b.who))) continue;
      const reach = place === "harbor" ? NEAR_OUT : a.who === "barkeep" || b.who === "barkeep" ? NEAR_BAR : NEAR;
      if (hexDistance(a.pos, b.pos) <= reach) pairs.push([a, b]);
    }
  }
  if (pairs.length === 0) return null;

  // The small talk that suits here and now, and of that, today's.
  const suits = EXCHANGES.map((x, i) => ({ x, i })).filter(({ x }) => {
    const w = x.when ?? {};
    return (!w.place || w.place === place) && (w.night === undefined || w.night === sky.night) && (!w.storm || sky.storm);
  });
  const small = (all: boolean): Topic[] =>
    suits
      .filter(({ i }) => all || smallTalkToday(crewId, day, i))
      .map(({ x, i }) => ({ key: `x${i}`, lines: x.lines, fits: (a: Who, b: Who) => (x.pair ? x.pair[0] === a && x.pair[1] === b : fits(x.a, a) && fits(x.b, b)) }));
  // The gossip, each piece said one of its ways for the day.
  const talk: Topic[] = gossip.map((g) => {
    const key = gossipKey(g);
    const ways = gossipLines(g);
    return { key: `g|${key}`, lines: ways[Math.floor(hash01(`gossip-way|${crewId}|${day}|${key}`) * ways.length)], fits: () => true };
  });
  const open = (ts: Topic[]) => ts.filter((t) => pairs.some(([a, b]) => t.fits(a.who, b.who)));
  let topics = open([...small(false), ...talk]);
  // (Nothing of today's fits whoever is near: any of the small talk will do.)
  if (topics.length === 0) topics = open(small(true));
  if (topics.length === 0) return null;
  const order = (t: Topic) => hash01(`banter-order|${crewId}|${place}|${day}|${t.key}`);
  topics.sort((p, q) => order(p) - order(q) || (p.key < q.key ? -1 : 1));
  return { start, rng, pairs, topics };
}

/**
 * The exchange in the slot `now` falls in, in a place, if there is one: its lines and when each is said. The same
 * for everyone in the crew who has the same `gossip`. Null when nobody is near enough to talk, or the slot passes
 * quietly.
 */
export function banterAt(crewId: string, place: "pub" | "harbor", now: number, gossip: readonly Gossip[] = []): BanterLine[] | null {
  const slot = Math.floor(now / BANTER_SLOT_MS);
  const here = slotTalk(crewId, place, slot, gossip);
  if (!here) return null;
  const { start, rng, pairs, topics } = here;
  // Round the topics in the day's order, a slot at a time, passing over any taken up in the last few minutes.
  const recent = new Set<string>();
  for (let k = 1; k <= BANTER_NO_REPEAT; k++) {
    const then = slotTalk(crewId, place, slot - k, gossip);
    if (then) recent.add(then.topics[(slot - k) % then.topics.length].key);
  }
  const from = slot % topics.length;
  const topic = topics.map((_, j) => topics[(from + j) % topics.length]).find((t) => !recent.has(t.key)) ?? topics[from];
  const can = pairs.filter(([a, b]) => topic.fits(a.who, b.who));
  const [a, b] = can[Math.floor(rng.next() * can.length)];
  const lines = topic.lines.map(([who, text], i) => ({ unit: unitOf(who === "a" ? a.who : b.who), text, at: start + BANTER_LEAD_MS + i * BANTER_GAP_MS }));
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
