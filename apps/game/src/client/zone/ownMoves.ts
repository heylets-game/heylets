// How an enemy ability with an animation of its own (render/signatureMoves.ts) is played in a fight. The figure lab
// plays every one straight; in a fight it has to be reached from the fight's events, and the usual look of the
// ability (a bolt, a ring, a lob: zone/abilityFx.ts) must not get in first. So the way is decided here, once, from
// the ability's shape, before its look is thought of (ZoneView's used and hit):
//
// - "burst": round its user, everyone near caught (an Ogre's Slam). Played round it as it is used
//   (WorldRenderer.burst); each hero caught just flinches as their hit is told.
// - "at": thrown at a spot, landing on the hexes round it (a Cultist's Immolate), or swept toward one through the
//   hexes in front of its user (a Great Bear's Rending Cleave). Played at the spot as it is used (WorldRenderer.moveAt);
//   each hero caught just flinches. A sweep whose move strikes each hero caught in turn (`sweeps`: a Brute's Great
//   Cleave) is a "blow" instead.
// - "blow": at one target, by hand or from afar. Played as each blow is told (WorldRenderer.blow, attack).

import { ENEMY_ABILITIES } from "@gantt-quest/world";
import { SIGNATURE_MOVES } from "../render/signatureMoves";

export type OwnRoute = "burst" | "at" | "blow";

const BY_NAME = new Map(Object.values(ENEMY_ABILITIES).map((a) => [a.name, a]));

/** How the enemy ability called `name` reaches the fight's picture as a move of its own, or null if there is none by that name. */
export function ownRoute(name: string): OwnRoute | null {
  const def = BY_NAME.get(name);
  if (!def) return null;
  if (def.shape === "burst") return "burst";
  return def.area || (def.sweep && !SIGNATURE_MOVES[name]?.sweeps) ? "at" : "blow";
}

/**
 * Whether a move of its own (a SignatureMove's `who`, and `only` where it is shared out) is played for this unit: only
 * for the kinds it was made for, since abilities of the same name are had by others (a bat's Bite is not a wolf's,
 * nor a hero's sea turtle's). A rendered unit's `kind` is its sprite key (spriteKey): the kind is what is before the
 * first "|".
 */
export function playsFor(move: { who: string; only?: readonly string[] }, unit: { kind: string }): boolean {
  const kind = unit.kind.split("|")[0];
  return (move.only ?? [move.who]).includes(kind);
}
