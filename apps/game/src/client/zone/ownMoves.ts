// How an enemy ability with an animation of its own (render/signatureMoves.ts) is played in a fight. The figure lab
// plays every one straight; in a fight it has to be reached from the fight's events, and the usual look of the
// ability (a bolt, a ring, a lob: zone/abilityFx.ts) must not get in first. So the way is decided here, once, from
// the ability's shape, before its look is thought of (ZoneView's used and hit):
//
// - "burst": round its user, everyone near caught (an Ogre's Slam), a call to its own side (a Pack Leader's
//   Howl), a field raised round it (a Guardian's Slowing Field), or a call for more of it (a Broodmother's Brood Swarm). Played round it as it is used (WorldRenderer.burst); each hero caught just flinches as their hit is told.
// - "at": thrown at a spot, landing on the hexes round it (a Cultist's Immolate, a Broodmother's Spin Web), or swept toward one through the
//   hexes in front of its user (a Great Bear's Rending Cleave), or reached out over a cone or down a line toward it
//   (a Haunt's Grave Grasp, its Ice Spear). Played at the spot as it is used (WorldRenderer.moveAt);
//   each hero caught just flinches. A sweep whose move strikes each hero caught in turn (`sweeps`: a Brute's Great
//   Cleave) is a "blow" instead.
// - "dash": straight through a line of heroes to the far end of it (a Cave Bat's Fell Swoop). Played as its user is
//   seen to go (WorldRenderer.dashUnit, from the dash it is told by); each hero it passes just flinches.
// - "blow": at one target, by hand or from afar. Played as each blow is told (WorldRenderer.blow, attack). An enemy's
//   retort (a slime's Acid Armor, biting back at whoever struck it) is one too, at whoever struck it.

import { ENEMIES, ENEMY_ABILITIES } from "@gantt-quest/world";
import { SIGNATURE_MOVES, type SignatureMove } from "../render/signatureMoves";

export type OwnRoute = "burst" | "at" | "dash" | "blow";

const BY_NAME = new Map(Object.values(ENEMY_ABILITIES).map((a) => [a.name, a]));

/**
 * The enemy ability an event is about: the one it names by id (`ability`, told with the event), or else the one called
 * `name`, as the kind `kind` has it: several kinds have abilities of the same name that work differently (a Giant
 * Spider's Web Spit, a Spiderling's Bite), so its user's own comes first. Any other by that name, if its kind has none
 * (or none is known). A tab left open on an older build is told no id, and goes by the name.
 */
export function enemyAbilityNamed(name: string, kind?: string, ability?: string) {
  if (ability && ENEMY_ABILITIES[ability]) return ENEMY_ABILITIES[ability];
  const own = kind ? ENEMIES[kind.split("|")[0]]?.abilities.map((id) => ENEMY_ABILITIES[id]).find((a) => a?.name === name) : undefined;
  return own ?? BY_NAME.get(name);
}

/** The names enemies' retorts are told by (EnemyDef `retort`): a hurt from one of them is its bearer's doing, not a swing. */
export const RETORTS: ReadonlySet<string> = new Set(Object.values(ENEMIES).flatMap((e) => (e.retort ? [e.retort.name] : [])));

/**
 * How the enemy ability called `name`, used by a `kind`, reaches the fight's picture as a move of its own, or null if
 * there is none by that name.
 */
export function ownRoute(name: string, kind?: string, ability?: string): OwnRoute | null {
  if (RETORTS.has(name)) return "blow";
  const def = enemyAbilityNamed(name, kind, ability);
  if (!def) return null;
  if (def.shape === "burst" || def.rally || def.field || def.summon) return "burst";
  if (def.dash) return "dash";
  const shape = def.spread?.shape;
  return shape === "cluster" || shape === "blast" || shape === "cone" || shape === "line" || (shape === "sweep" && !SIGNATURE_MOVES[def.id]?.sweeps) ? "at" : "blow";
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
 * The move of its own `unit` plays for an ability, if it has one: the ability's (SIGNATURE_MOVES is keyed by ability id,
 * so renaming one loses nothing), found by its `ability` id if the event told one, else by its `name` as the unit's kind
 * has it; a retort has no ability, and is keyed by its name. Played only if it is for the unit's kind (playsFor).
 */
export function ownMove(name: string, unit: { kind: string }, ability?: string): SignatureMove | undefined {
  const id = enemyAbilityNamed(name, unit.kind, ability)?.id;
  const move = (id && SIGNATURE_MOVES[id]) || SIGNATURE_MOVES[name];
  return move && playsFor(move, unit) ? move : undefined;
}
