// The fishmonger: an old sailor in a yellow raincoat who keeps the fish shack on the south-west shore, by the pier.
// He stands at the shack's east end, by his drying line, all day and all night: he buys the catch at the day's
// board (fishmarket.ts), sells bait (fishing.ts, BAIT_SALE) and, asked, says where they are biting
// (fishingholes.ts, bestHole). He keeps out of the way of the shack's door, which is the one way to the water there.

import type { HexPos } from "@gantt-quest/core";
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
