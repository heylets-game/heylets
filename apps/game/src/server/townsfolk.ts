// The townsfolk, as the model is told to be them when a player asks one of them something (ai.ts makes the call;
// routes/talk.ts takes the question): who each is and how they talk, where what they deal in is done instead, a line
// of their own for when there is no model, and what they know for certain right now. Everything they know follows
// from the crew and the clock, as what they deal in does, so nothing here is read from the database.
//
// Their names, trades and greetings are the ones the game already has (packages/world). Only their manner is here.

import {
  BAITS,
  BAIT_IDS,
  BAIT_SALE,
  DEALER_KINDS,
  DECORATOR,
  FISHMONGER,
  KEEPER_PLACES,
  PUB_BARKEEP,
  PUB_DEALER,
  PUB_MENU,
  RESOURCE_LABEL,
  SHELF_PRICES,
  bestHole,
  dealerBoard,
  decoratorOpen,
  dueIn,
  errandFor,
  finishById,
  finishDay,
  finishStock,
  fishmongerTip,
  gatherDay,
  harborSky,
  nextSalesmanVisit,
  regular,
  regularAbout,
  regularsAt,
  salesman,
  salesmanVisitAt,
  type KeeperHouse,
  type RegularId,
  type SalesmanId,
  type Townsperson,
} from "@gantt-quest/world";
import { RELEASES } from "../releases";
import type { Persona, TalkInput } from "./ai";

/** What a question is asked in: whose crew, and when. */
export interface TalkScene {
  crewId: string;
  now: number;
}

export interface Townsfolk extends Persona {
  /** What they know for certain right now, besides what everyone does (commonFacts). */
  facts(scene: TalkScene): string[];
  /** Their unit id in the pub's scene, if they are in it now: what they say is hung over their head there for everyone. */
  inPub(scene: TalkScene): string | null;
}

const said = (input: TalkInput) => input.text.toLowerCase();
/** What anyone says when asked for something for nothing. */
const FREE = /\b(free|discount|give me|cheaper|lend)\b/;
const lower = (s: string) => s.toLowerCase();

// ---------- what everyone knows ----------

/** The time of day and the weather, who of the regulars is about, and the news on the notice board. */
export function commonFacts({ crewId, now }: TalkScene): string[] {
  const sky = harborSky(now);
  const regs = regularsAt(crewId, now);
  const news = RELEASES.find((r) => !r.unreleased && r.notes.length > 0);
  return [
    `It is ${sky.night ? "night" : "day"} in the Harbor${sky.storm ? ", and a storm is blowing" : ""}.`,
    `The regulars about today: ${regs.map((r) => `${r.name}, ${r.trade}`).join("; ")}. They drink in the pub at night and are out about the Harbor by day, and each has a small job going.`,
    "Old Tam keeps the crew's pub. Hollis Crane, the dealer in materials, leans on the pillar at the end of its bar. Bram Gullet sells bait and buys fish at the shack by the fishing spot. Nell Ashby sells wallpaper, floors and roofs at her stall by the market. The smithy, the apothecary, the galley and the lapidary each have a keeper.",
    ...(news ? news.notes.slice(0, 4).map((n) => `News pinned on the Harbor's notice board: ${n.area ? `${n.area}: ` : ""}${n.text}.`) : []),
  ];
}

/** Who is in the pub's corner, or who is due there next. */
function salesmanFact(crewId: string, at: number): string {
  const here = salesmanVisitAt(crewId, at);
  const who = (id: string) => salesman(id)!;
  if (here) return `A traveling salesman is in the pub now, in the corner by the far wall: ${who(here.salesmanId).name}, ${who(here.salesmanId).trade}. Gone ${dueIn(here.endsAt - at)}.`;
  const next = nextSalesmanVisit(crewId, at);
  return next
    ? `No traveling salesman is in. Word is ${who(next.salesmanId).name}, ${who(next.salesmanId).trade}, is due ${dueIn(next.startsAt - at)}.`
    : "No traveling salesman is in, and none is due that you know of.";
}

// ---------- Old Tam ----------

function mockBarkeep(input: TalkInput): string {
  const s = said(input);
  if (/\b(menu|drink|ale|rum|food|stew|pie|eat|hungry|thirsty)\b/.test(s)) return "It is all on the board. The stew is mostly fish, and the pie comes with stories whether you want them or not.";
  if (/\b(dice|game|bet|gamble)\b/.test(s)) return "Table is by the hearth side. Bid what you can see, call what you cannot believe, and do not blame me after.";
  if (/\b(voyage|island|sea|ship|sail)\b/.test(s)) return "I only hear the stories after. Eat first; the sea is easier on a full stomach.";
  if (/\b(salesman|salesmen|trader|peddler|visitor|stranger|corner)\b/.test(s)) {
    const fact = input.facts.find((f) => f.includes("traveling salesman"));
    if (fact) return fact.replace(/^Word is /, "").replace(/^No traveling salesman is in\. Word is /, "Nobody in the corner tonight. I hear ");
  }
  if (/\b(free|discount|give|gold)\b/.test(s)) return "Prices are on the board, and the board does not haggle. Neither do I.";
  return `Evening, ${input.hero}. Something off the board, or just the warm?`;
}

const BARKEEP: Townsfolk = {
  name: PUB_BARKEEP.name,
  role: "the barkeep of the crew's pub",
  manner: ["You are dry, friendly and brief. You have kept this bar for thirty years and have opinions about the sea."],
  trade: "meals are ordered from the board beside you, at the prices shown",
  approach: "leans on the bar and says",
  mock: mockBarkeep,
  facts: ({ crewId, now }) => [
    ...PUB_MENU.map((i) => `On the board: ${i.name}, ${i.price} gold. ${i.blurb}`),
    "The board is meals only: no drink is sold. A meal gives a hero back one gathering outing, once a day.",
    "There is a dice table in the pub where crewmates bluff each other for a small stake.",
    salesmanFact(crewId, now),
    `${PUB_DEALER.name}, ${PUB_DEALER.trade}, leans on the pillar at the end of the bar: he buys wood, stone, iron and the rest, sells what people are short of at prices that move through the day, and offers supply contracts that run a few days. The regulars hand out their own small jobs; find them in here at night or about the Harbor by day. The Harbor's notice board outside is for news of the Harbor itself.`,
  ],
  inPub: () => PUB_BARKEEP.id,
};

// ---------- Hollis ----------

const DEALER: Townsfolk = {
  name: PUB_DEALER.name,
  role: `${PUB_DEALER.trade}, leaning on the pillar at the end of the bar in the crew's pub`,
  manner: ["You are sharp, quick and always weighing a deal. You talk about prices the way other people talk about the weather.", `You like to say: ${PUB_DEALER.line}`],
  trade: "buying, selling and supply contracts are done on your board, at the prices it shows",
  approach: "comes up to the pillar and says",
  mock: (input) => {
    if (FREE.test(said(input))) return "Nothing's free, friend. Even this advice is costing you time.";
    const wanted = input.facts.find((f) => f.startsWith("You are paying more"));
    return wanted ? wanted.replace(/^You are paying/, "I'm paying").replace(/; you have/, ". I've got").replace(/ and are selling/, ", selling") : PUB_DEALER.line;
  },
  facts: ({ crewId, now }) => {
    const board = dealerBoard(crewId, now);
    const name = (k: (typeof DEALER_KINDS)[number]) => lower(RESOURCE_LABEL[k]);
    return [
      `You are paying more than usual for ${board.wanted.map(name).join(" and ")}; you have too much ${name(board.glut)} and are selling it cheap.`,
      `Your prices for one of each, until they move ${dueIn(board.endsAt - now)}: ${DEALER_KINDS.map((k) => `${name(k)}, you pay ${board.buys[k]} gold and ask ${board.sells[k]}`).join("; ")}.`,
      "You also offer supply contracts that run a few days: deliver the materials asked for by the day and be paid in gold, and a little more for being early.",
    ];
  },
  inPub: () => PUB_DEALER.id,
};

// ---------- the regulars ----------

const REGULAR_MANNER: Record<RegularId, { manner: string; shrug: string }> = {
  gretta: { manner: "You are warm and nosy, call everyone love, and hear every bit of gossip while you mend the crew's nets.", shrug: "Oh, love, you'd have to ask someone with fewer holes in their memory." },
  pike: { manner: "You are gruff and blunt, all orders and sea sense, and kinder underneath than you let on.", shrug: "Ask me something useful, sailor. Then ask it louder." },
  wen: { manner: "You are practical and cheerful, always building something or about to, and you judge everything by how well it is made.", shrug: "No idea. But if it's wood, I can fix it." },
  moss: { manner: "You are slow, a little deaf, and fond of long memories of the old light and the ships it saw home.", shrug: "Eh? Speak up. Thirty years by a foghorn does that." },
  dacey: { manner: "You are sly and evasive. You never quite admit to anything, and you answer questions with questions.", shrug: "Who wants to know? And why do they want to know?" },
};

function regularFolk(id: RegularId): Townsfolk {
  const r = regular(id)!;
  const { manner, shrug } = REGULAR_MANNER[id];
  return {
    name: r.name,
    role: `${r.trade}, one of the regulars at the crew's pub`,
    manner: [manner, `You like to say: ${r.line}`],
    trade: "your jobs are taken on and handed in from your own list of them, not by talk",
    approach: "says",
    mock: (input) => {
      if (/\b(job|work|errand|help)\b/.test(said(input))) {
        const job = input.facts.find((f) => f.startsWith("The job you have going today"));
        if (job) return job.replace(/^The job you have going today: /, "");
      }
      return shrug;
    },
    facts: ({ crewId, now }) => {
      const about = regularAbout(crewId, id, now);
      const today = regularsAt(crewId, now).some((x) => x.id === id);
      return [
        `You are ${about.place === "pub" ? "in the pub" : "out about the Harbor"} just now.`,
        today ? `The job you have going today: ${errandFor(crewId, gatherDay(now), r).text}` : "You have no job going today.",
      ];
    },
    inPub: ({ crewId, now }) => (regularAbout(crewId, id, now).place === "pub" ? `regular:${id}` : null),
  };
}

// ---------- the traveling salesmen ----------

const SALESMAN_MANNER: Record<SalesmanId, { manner: string; sells: string; shrug: string }> = {
  curio: {
    manner: "You are smooth and theatrical, and every piece you sell comes with a story you embroider.",
    sells: "furniture and curios for a hut, and a few pieces of gear, dearer than the market stall",
    shrug: "Ah, now that is a story. And stories, I'm afraid, cost extra.",
  },
  plans: {
    manner: "You are fussy and precise, and you think anyone who builds without a plan deserves what they get.",
    sells: "plans for things to build, the kind otherwise only found in caves",
    shrug: "I deal in plans, not guesses. Come back when you want something drawn up proper.",
  },
  far: {
    manner: "You are bright and well travelled, full of talk of places further out than the crew's boats go.",
    sells: "far goods: a globe, a ship in a bottle, shell chimes",
    shrug: "Out where I've been, nobody asks that. They're too busy staying afloat.",
  },
  herbs: {
    manner: "You are an old herbalist, kind but firm, and you have no patience for haggling.",
    sells: "what grows in the damp, bought from whoever brings it, for more than the stall pays",
    shrug: "Herbs I know. That, I don't. Bring me something green and we'll talk.",
  },
};

function salesmanFolk(id: SalesmanId): Townsfolk {
  const s = salesman(id)!;
  const { manner, sells, shrug } = SALESMAN_MANNER[id];
  return {
    name: s.name,
    role: `${s.trade} off a passing boat, at the corner table of the crew's pub for a few hours`,
    manner: [manner, `You like to say: ${s.greeting}`],
    trade: "what you deal in is bought and sold at your table, at the prices marked",
    approach: "comes over to the corner table and says",
    mock: (input) => (FREE.test(said(input)) ? "The prices are marked. I'd be a poor trader if I talked them down for anyone who asked." : shrug),
    facts: ({ crewId, now }) => {
      const here = salesmanVisitAt(crewId, now);
      return [`You deal in ${sells}.`, here?.salesmanId === id ? `Your boat leaves ${dueIn(here.endsAt - now)}, and you with it.` : "You are only passing through."];
    },
    inPub: ({ crewId, now }) => (salesmanVisitAt(crewId, now)?.salesmanId === id ? "salesman" : null),
  };
}

// ---------- the keepers ----------

const KEEPER_MANNER: Record<KeeperHouse, { manner: string; trade: string; knows: string[]; shrug: string }> = {
  smithy: {
    manner: "You are proud of your iron, short of patience and loud from years at the anvil.",
    trade: "your gear is bought at your counter, and any haggling is done there too",
    knows: ["You sell weapons and armour you have forged, a few pieces at a time, suited to whoever is buying. A buyer may haggle; it does not always go their way."],
    shrug: "I hit things with hammers. Ask me about that.",
  },
  apothecary: {
    manner: "You are nervous and precise, and fond of warnings, especially about the green bottles.",
    trade: "your flasks are bought from your shelf, and any haggling is done there too",
    knows: [
      `You sell flasks made up and ready to throw in a fight, a few of each a day: ${Object.entries(SHELF_PRICES).map(([k, p]) => `${k} for ${p} gold`).join(", ")}. Making them yourself from what you gather is cheaper, which you think is the point of gathering. A buyer may haggle.`,
    ],
    shrug: "I wouldn't know. I'd want to test it first. Carefully.",
  },
  galley: {
    manner: "You are gruff and territorial about your kitchen, and you think everyone is in your way.",
    trade: "you sell nothing to anyone: what you cook is sold over the bar at the pub",
    knows: ["You cook the meals Old Tam sells over the bar at the pub. The pub pays for the pot, not the customer."],
    shrug: "Out of my kitchen with questions like that.",
  },
  lapidary: {
    manner: "You are careful and exact, and a little vain about your eye for a stone.",
    trade: "your work is bought and done at your bench, at the prices it shows",
    knows: ["You cut lodestones from stone and iron and work them at your bench: fused, attuned, tempered and rerolled. Nobody goes out on the atlas without a lodestone. You buy gems from whoever brings them, for gold, and use them for tempering and attuning. Nothing here is haggled over."],
    shrug: "Hold that question up to the lamp. No, I can't see anything in it either.",
  },
};

function keeperFolk(house: KeeperHouse): Townsfolk {
  const { keeper, title } = KEEPER_PLACES[house];
  const { manner, trade, knows, shrug } = KEEPER_MANNER[house];
  return {
    name: keeper.name,
    role: `${keeper.trade}, at work in ${lower(title)} in the Harbor`,
    manner: [manner, `You like to say: ${keeper.line}`],
    trade,
    approach: "comes up to the counter and says",
    mock: (input) => (FREE.test(said(input)) ? keeper.line : shrug),
    facts: () => knows,
    inPub: () => null,
  };
}

// ---------- Bram and Nell, in the Harbor ----------

const FISHMONGER_FOLK: Townsfolk = {
  name: FISHMONGER.name,
  role: `${FISHMONGER.trade}, at the shack by the Harbor's fishing spot`,
  manner: ["You spent thirty years before the mast and now sell fish. You are gruff and salty, and secretly glad of anyone who wants to talk fishing.", `You like to say: ${FISHMONGER.line}`],
  trade: "fish are sold to you and bait bought from you at your shack, at the prices shown",
  approach: "comes up to the shack and says",
  mock: (input) => {
    if (/\b(bite|biting|where|spot|hole|fish)\b/.test(said(input))) return input.facts.find((f) => f.startsWith("Where they are biting: "))?.replace(/^Where they are biting: /, "") ?? FISHMONGER.line;
    return "I sell bait and buy fish. Anything else, ask the barkeep. He talks enough for both of us.";
  },
  facts: ({ crewId, now }) => [
    `Where they are biting: ${fishmongerTip(bestHole(crewId, now, true))}`,
    `Your bait: ${BAIT_IDS.map((b) => `${BAITS[b].name}, ${BAIT_SALE[b].lot} for ${BAIT_SALE[b].price} gold. ${BAITS[b].blurb}`).join(" ")}`,
    "You buy whatever fish anyone brings, the better and rarer the more you pay.",
  ],
  inPub: () => null,
};

const DECORATOR_FOLK: Townsfolk = {
  name: DECORATOR.name,
  role: `a seller of ${DECORATOR.trade}, at your stall beside the Harbor's market`,
  manner: ["You are cheerful and chatty, with paste on your sleeves and opinions about colour."],
  trade: "patterns are bought from your stall, at the prices shown",
  approach: "comes up to the stall and says",
  mock: () => DECORATOR.line,
  facts: ({ now }) => {
    const out = finishStock(finishDay(now)).map((id) => finishById(id)).filter((f) => !!f);
    return [
      DECORATOR.line,
      decoratorOpen(now) ? "Your stall is open." : "Your stall is covered for the night.",
      `Out on your stall today: ${out.map((f) => `${f.name} (a ${f.kind}, ${f.price} gold)`).join(", ")}.`,
      "What a hero buys is theirs for good; they choose what goes on their hut with Decorate, at home.",
    ];
  },
  inPub: () => null,
};

// ---------- all of them ----------

export const TOWNSFOLK_MINDS: Record<Townsperson, Townsfolk> = {
  barkeep: BARKEEP,
  dealer: DEALER,
  "regular:gretta": regularFolk("gretta"),
  "regular:pike": regularFolk("pike"),
  "regular:wen": regularFolk("wen"),
  "regular:moss": regularFolk("moss"),
  "regular:dacey": regularFolk("dacey"),
  "salesman:curio": salesmanFolk("curio"),
  "salesman:plans": salesmanFolk("plans"),
  "salesman:far": salesmanFolk("far"),
  "salesman:herbs": salesmanFolk("herbs"),
  "keeper:smithy": keeperFolk("smithy"),
  "keeper:apothecary": keeperFolk("apothecary"),
  "keeper:galley": keeperFolk("galley"),
  "keeper:lapidary": keeperFolk("lapidary"),
  "keeper:fishmonger": FISHMONGER_FOLK,
  "keeper:decor": DECORATOR_FOLK,
};

/** Everything one of them knows for certain right now: their own facts first, then what everyone knows. */
export const factsFor = (who: Townsperson, scene: TalkScene): string[] => [...TOWNSFOLK_MINDS[who].facts(scene), ...commonFacts(scene)];
