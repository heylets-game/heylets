// How an enemy ability with an animation of its own (render/signatureMoves.ts) is played in a fight. The figure lab
// plays every one straight; in a fight it has to be reached from the fight's events, and the usual look of the
// ability (a bolt, a ring, a lob: zone/abilityFx.ts) must not get in first. So the way is decided here, once, from
// the ability's shape, before its look is thought of (ZoneView's used and hit):
//
// - "burst": round its user, everyone near caught (an Ogre's Slam), a call to its own side (a Pack Leader's
//   Howl), or a field raised round it (a Guardian's Slowing Field). Played round it as it is used (WorldRenderer.burst); each hero caught just flinches as their hit is told.
// - "at": thrown at a spot, landing on the hexes round it (a Cultist's Immolate), or swept toward one through the
//   hexes in front of its user (a Great Bear's Rending Cleave), or reached out over a cone or down a line toward it
//   (a Haunt's Grave Grasp, its Ice Spear). Played at the spot as it is used (WorldRenderer.moveAt);
//   each hero caught just flinches. A sweep whose move strikes each hero caught in turn (`sweeps`: a Brute's Great
//   Cleave) is a "blow" instead.
// - "dash": straight through a line of heroes to the far end of it (a Cave Bat's Fell Swoop). Played as its user is
//   seen to go (WorldRenderer.dashUnit, from the dash it is told by); each hero it passes just flinches.
// - "blow": at one target, by hand or from afar. Played as each blow is told (WorldRenderer.blow, attack).

import { ENEMY_ABILITIES } from "@gantt-quest/world";
import { SIGNATURE_MOVES, type SignatureMove } from "../render/signatureMoves";

export type OwnRoute = "burst" | "at" | "dash" | "blow";

const BY_NAME = new Map(Object.values(ENEMY_ABILITIES).map((a) => [a.name, a]));

/** How the enemy ability called `name` reaches the fight's picture as a move of its own, or null if there is none by that name. */
export function ownRoute(name: string): OwnRoute | null {
  const def = BY_NAME.get(name);
  if (!def) return null;
  if (def.shape === "burst" || def.rally || def.field) return "burst";
  if (def.dash) return "dash";
  return def.area || def.cone || def.line || (def.sweep && !SIGNATURE_MOVES[name]?.sweeps) ? "at" : "blow";
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

/**
 * The move of its own `unit` plays for the ability called `name`, if it has one: its kind's own (keyed `Name@kind`),
 * else the one by that name, if that is played for its kind (playsFor).
 */
export function ownMove(name: string, unit: { kind: string }): SignatureMove | undefined {
  const mine = SIGNATURE_MOVES[`${name}@${unit.kind.split("|")[0]}`];
  if (mine) return mine;
  const move = SIGNATURE_MOVES[name];
  return move && playsFor(move, unit) ? move : undefined;
}
