// Talking to the townsfolk: what each of them says as you walk up, and the replies you can give. The view
// (apps/game/src/client/Dialogue.tsx) moves the camera in close and types their lines out in a box along the
// bottom; a reply either opens what they deal in (their panel), has them say something written here, lets you
// ask them anything (answered by the server, a few times a day), or says goodbye.
//
// Their words are the ones they already had: a regular's or a keeper's hello and line, a salesman's greeting, the
// dealer's hello. Old Tam had none written, so his are here.

import { FISH } from "./fishcatalog";
import { BAITS, BAIT_IDS } from "./fishing";
import { HOLE_NAMES, type FishingHole } from "./fishingholes";
import { FISHMONGER } from "./fishmonger";
import { DECORATOR } from "./finishes";
import { KEEPER_PLACES, type KeeperHouse } from "./keepers";
import { PUB_BARKEEP, PUB_DEALER } from "./pub";
import type { Regular } from "./regulars";
import type { Salesman } from "./salesman";

export interface TalkChoice {
  /** Unique within its conversation. */
  id: string;
  /** What you say: the button's words. */
  label: string;
  /** Opens this panel of theirs (the view knows what each is): the conversation ends as it opens. */
  opens?: string;
  /** They answer with this, and the replies come back. A function is asked each time the reply is chosen: the next of several things they say, never the same twice running. */
  says?: string | (() => string);
  /** Lets you type a question for them to answer. */
  ask?: true;
  /** Ends the conversation. */
  bye?: true;
}

export interface Conversation {
  /** Who is speaking: their unit id in the scene. */
  unit: string;
  name: string;
  /** How their voice sounds as their words are typed out: semitones up or down from the usual blip. */
  voice: number;
  /** What they say as you walk up, a page at a time. */
  greeting: string[];
  choices: TalkChoice[];
  /** What they say when you have asked them all you may today. */
  tired?: string;
}

/** Questions a player may ask the townsfolk each day, all of them together. */
export const TALK_PER_DAY = 20;
/** How long a page of the box holds, in characters. */
export const TALK_PAGE = 150;

/** Why another question may not be asked today, or null if it may. */
export function talkProblem(asked: number): string | null {
  return asked >= TALK_PER_DAY ? `That is all the talk for today: ${TALK_PER_DAY} questions a day.` : null;
}

/**
 * Lines broken into pages that fit the box, `max` characters at most each: at the end of a sentence where one
 * fits, else at a space, else (one very long word) wherever it has to. Nothing is lost or added but the spaces between.
 */
export function pagesOf(lines: string | string[], max = TALK_PAGE): string[] {
  const pages: string[] = [];
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    let rest = line.replace(/\s+/g, " ").trim();
    while (rest.length > max) {
      const head = rest.slice(0, max + 1);
      const sentence = Math.max(...[". ", "! ", "? ", "… "].map((end) => head.lastIndexOf(end)));
      const cut = sentence > max / 3 ? sentence + 1 : head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : max;
      pages.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pages.push(rest);
  }
  return pages;
}

/** Each speaker's pitch, distinct from everyone they share a room with. */
export const TALK_VOICES: Record<string, number> = {
  [PUB_BARKEEP.id]: -6,
  [PUB_DEALER.id]: -2,
  "regular:gretta": 5,
  "regular:pike": -4,
  "regular:wen": 7,
  "regular:moss": -8,
  "regular:dacey": 3,
  "salesman:curio": 1,
  "salesman:plans": -1,
  "salesman:far": 4,
  "salesman:herbs": 8,
  "keeper:smithy": -3,
  "keeper:apothecary": 2,
  "keeper:galley": -7,
  "keeper:lapidary": 6,
  [FISHMONGER.id]: -5,
  [DECORATOR.id]: 4,
};

const BYE: TalkChoice = { id: "bye", label: "Goodbye", bye: true };

/**
 * The one thing a townsperson offers, when there is only one besides goodbye (a regular's job, a keeper's shop): it
 * is not put behind a choice, but taken as soon as they have said their piece. Null when there are several.
 */
export function loneChoice(c: Pick<Conversation, "choices">): TalkChoice | null {
  const real = c.choices.filter((ch) => !ch.bye);
  return real.length === 1 ? real[0] : null;
}

/** Old Tam, behind his bar. `word` is his news of the corner: who is in it, or who is due. */
export function barkeepTalk(word?: string): Conversation {
  return {
    unit: PUB_BARKEEP.id,
    name: PUB_BARKEEP.name,
    voice: TALK_VOICES[PUB_BARKEEP.id],
    greeting: pagesOf(["Mind the step, it bites. What'll it be?", ...(word ? [word] : [])]),
    choices: [
      { id: "board", label: "What's on the board?", opens: "board" },
      { id: "fish", label: "I've fish to sell", opens: "fish" },
      { id: "records", label: "The crew's records", opens: "records" },
      { id: "ask", label: "Ask him something…", ask: true },
      BYE,
    ],
    tired: "My throat's done for the day. Come back tomorrow and I'll talk your ear off.",
  };
}

/** Hollis, by the pillar: the dealer in materials, and his supply contracts. */
export function dealerTalk(): Conversation {
  return {
    unit: PUB_DEALER.id,
    name: PUB_DEALER.name,
    voice: TALK_VOICES[PUB_DEALER.id],
    greeting: pagesOf([PUB_DEALER.hello, PUB_DEALER.line]),
    choices: [
      { id: "trade", label: "Let's trade", opens: "trade" },
      { id: "contracts", label: "Any contracts going?", opens: "contracts" },
      BYE,
    ],
  };
}

/** One of the day's regulars. `unit` is their id in the scene. */
export function regularTalk(r: Pick<Regular, "id" | "name" | "hello" | "line">, unit = `regular:${r.id}`): Conversation {
  return {
    unit,
    name: r.name,
    voice: TALK_VOICES[`regular:${r.id}`] ?? 0,
    greeting: pagesOf([r.hello, r.line]),
    choices: [{ id: "errand", label: "Got a job for me?", opens: "errand" }, BYE],
  };
}

/** A traveling salesman, in the corner. `unit` is their id in the scene. */
export function salesmanTalk(s: Pick<Salesman, "id" | "name" | "greeting">, unit = "salesman"): Conversation {
  return {
    unit,
    name: s.name,
    voice: TALK_VOICES[`salesman:${s.id}`] ?? 0,
    greeting: pagesOf(s.greeting),
    choices: [{ id: "trade", label: "Show me what you have", opens: "trade" }, BYE],
  };
}

/** What each keeper is asked to see their trade, and what the cook says, having none. */
const KEEPER_ASKS: Record<KeeperHouse, TalkChoice> = {
  smithy: { id: "shop", label: "Show me your iron", opens: "shop" },
  apothecary: { id: "shop", label: "What have you brewing?", opens: "shop" },
  lapidary: { id: "shop", label: "Let's talk stones", opens: "shop" },
  galley: { id: "cook", label: "What's in the pot?", says: "Nothing for you. The pot's for the pub, and the pub pays. Eat at the bar like everyone else." },
};

/** A shop's keeper, at their work. */
export function keeperTalk(shop: KeeperHouse): Conversation {
  const { keeper } = KEEPER_PLACES[shop];
  return {
    unit: keeper.id,
    name: keeper.name,
    voice: TALK_VOICES[keeper.id] ?? 0,
    greeting: pagesOf([keeper.hello, keeper.line]),
    choices: [KEEPER_ASKS[shop], BYE],
  };
}

/**
 * What the fishmonger says when asked where they are biting: the best hole there is (`hole`, from bestHole), and the
 * bait that suits it, or a grunt if there is none. The kinds of fish are named plainly, two at most.
 */
export function fishmongerTip(hole: FishingHole | null): string {
  if (!hole) return "Nowhere worth the walk. Try the pier and keep your mouth shut, the fish can hear you.";
  const fish = hole.featured.slice(0, 2).map((id) => FISH[id].name.toLowerCase());
  const what = fish.length === 2 ? `${fish[0]} and ${fish[1]}` : fish[0] ?? "something";
  const bait = BAIT_IDS.find((b) => BAITS[b].suits === hole.kind);
  const hook = bait === "worms" ? " Put a worm on." : bait === "shrimp" ? " Shrimp, if you want the big ones." : bait === "glow_lure" ? " Take a glow lure out after dark." : "";
  return `${HOLE_NAMES[hole.kind]} ${hole.where}. ${what[0].toUpperCase()}${what.slice(1)}, last I saw.${hook} Don't go telling the whole Harbor.`;
}

/**
 * The fishmonger, at his shack. `tip` is where he says they are biting (fishmongerTip); `advice` gives the next
 * piece of advice each time he is asked for one (fishmongerAdvice).
 */
export function fishmongerTalk(tip: string, advice: () => string): Conversation {
  return {
    unit: FISHMONGER.id,
    name: FISHMONGER.name,
    voice: TALK_VOICES[FISHMONGER.id],
    greeting: pagesOf([FISHMONGER.hello, FISHMONGER.line]),
    choices: [
      { id: "fish", label: "I've fish to sell", opens: "fish" },
      { id: "bait", label: "What have you got for bait?", opens: "bait" },
      { id: "tip", label: "Where are they biting?", says: tip },
      { id: "advice", label: "Got any advice?", says: advice },
      BYE,
    ],
  };
}

/** Nell Ashby, at her stall beside the market stall: wallpaper, floors and roofs for your hut. */
export function decoratorTalk(): Conversation {
  return {
    unit: DECORATOR.id,
    name: DECORATOR.name,
    voice: TALK_VOICES[DECORATOR.id],
    greeting: pagesOf([DECORATOR.hello]),
    choices: [
      { id: "finishes", label: "Show me your patterns", opens: "finishes" },
      { id: "how", label: "How does it work?", says: DECORATOR.line + " Open Decorate at home and pick from what you've bought." },
      BYE,
    ],
  };
}
