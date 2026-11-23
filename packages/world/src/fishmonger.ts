// The fishmonger: an old sailor in a yellow raincoat who keeps the fish shack on the south-west shore, by the pier.
// He stands at the shack's east end, by his drying line, all day and all night: he buys the catch at the day's
// board (fishmarket.ts), sells bait (fishing.ts, BAIT_SALE) and, asked, says where they are biting
// (fishingholes.ts, bestHole). He keeps out of the way of the shack's door, which is the one way to the water there.

import type { HexPos } from "@gantt-quest/core";
import { FISH_WANTED_BONUS, QUAY_RATE } from "./fishmarket";
import { HARBOR_GATHER } from "./harbor";

export const FISHMONGER = {
  /** His unit id in the Harbor's scene. */
  id: "keeper:fishmonger",
  name: "Bram Gullet",
  short: "Bram",
  trade: "the fishmonger",
  /** The look he is drawn with (apps/game/src/client/render/looks.ts). */
  look: "keeper_fishmonger",
  hello: "Wipe your boots. You buying or selling?",
  line: "Thirty years before the mast, and now I sell cod to landlubbers. Don't make it worse.",
} as const;

/** Where he stands: beside the shack's east end, a step up the shore from its door, off the way to it. */
export const FISHMONGER_POS: HexPos = { q: HARBOR_GATHER.fishing.q + 2, r: HARBOR_GATHER.fishing.r - 1 };
/** What he looks at while nobody is talking to him: the shack's door, and the water past it. */
export const FISHMONGER_FACES: HexPos = HARBOR_GATHER.fishing;

/** Whether `p` is where he stands. */
export const isFishmongerAt = (p: HexPos): boolean => p.q === FISHMONGER_POS.q && p.r === FISHMONGER_POS.r;

/**
 * What he tells you when asked for advice, one piece each asking, in this order: how to catch better fish first (the
 * cast, the strike, the fight), then where and with what, then selling. Every one is true of the game (fishing.ts,
 * fishfight.ts, fishmarket.ts), in his voice and plain words.
 */
export const FISHMONGER_ADVICE: readonly string[] = [
  // The cast.
  "Cast long. The tiddlers hang about by the pier. The rare ones are further out, and so are the big ones.",
  "A short cast catches small fry. Hold the cast till it's near full and you'll be weighing what comes up, not throwing it back.",
  // The strike.
  "Strike when the float goes under. Not when it twitches. A nibble's a fish making up its mind.",
  "Strike too late and it's spat the hook. The float stays down a moment, no more. Quick hands give you longer.",
  // The fight.
  "When a fish runs, tap. Don't hold. Tapping tires it out without putting too much on the line.",
  "Don't let a running fish have it all its own way, either. Leave the line slack too long and it throws the hook.",
  "When it stops and rests, hold and reel. Leave a resting fish alone and it gets its strength back.",
  "Watch your line. If it goes red, ease off. Hold it there a second too long and it snaps.",
  "Watch how much line's out, too. A fish that takes the lot is gone, line and all. Tap quicker to slow a long run.",
  "Head-shaking means let go. All that thrashing on a tight line, something gives, and it won't be the fish.",
  "When one jumps, the line goes slack, then it lands on it hard. Ease off as it comes down.",
  "Wear it out and it gives up. Then it comes in on its own, quick as you like.",
  "Boots and crates don't fight. They're just heavy. Hold and wind.",
  "Strong arms tire a fish quicker and carry a fuller basket. Quick hands keep a straining line from snapping.",
  // Where, when and with what.
  "See them dark shapes on the water? Fish. They move through the day, so the spot that was good this morning isn't now.",
  "A full cast from the shore reaches the shapes off it. Ask me where they're biting and I'll tell you the best of them.",
  "Some fish only come up at night, lights on their noses and all. One or two only show in a storm. Mad, the lot of them.",
  "Worms for a shoal, shrimp for a deep hole, a glow lure for the night feeders. Wrong bait, you're feeding the tiddlers.",
  "A lure comes back to you, cast after cast. Till something snaps your line or takes it all. Then it's gone with the fish.",
  "Get yourself a rowboat and row out to the open sea. There's fish out there this pier's never seen.",
  // Selling.
  `My board changes four times a day. What's chalked up as wanted pays ${FISH_WANTED_BONUS === 2 ? "double" : `${FISH_WANTED_BONUS} times`}. Read it before you sell.`,
  "A big one for its kind is a specimen. I pay a quarter more for those, and they'll keep for good in your trophy chest.",
  `Fill your basket and keep fishing if you like, but what won't fit gets sold on the quay for ${QUAY_RATE === 0.5 ? "half" : "less"}. Your choice.`,
  "Fill the Catch Book, every page, and they'll gild your rod. Took me thirty years. Don't rush it.",
];

/** What he says asked again once he has given every piece of advice, before he starts again from the first. */
export const FISHMONGER_ADVICE_DONE = "That's everything I know. Thirty years of it. Now go and fish, and stop asking me.";

/**
 * His advice on the `n`th asking, counting from 0: every piece once, in order, then that he has told you everything,
 * then round again. Nothing is said twice before the rest have been.
 */
export const fishmongerAdvice = (n: number): string => {
  const i = Math.abs(Math.floor(n)) % (FISHMONGER_ADVICE.length + 1);
  return i < FISHMONGER_ADVICE.length ? FISHMONGER_ADVICE[i] : FISHMONGER_ADVICE_DONE;
};
