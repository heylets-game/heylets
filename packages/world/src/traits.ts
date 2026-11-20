// Passives (called traits in the code and the save): what a hero picks as
// they level, one of the class's choices at each of TRAIT_LEVELS, for keeps.
// The logbook offers them and the server saves the pick. Each is data here
// (name, blurb, class, tier); what it does in a hex fight is its hooks in
// zone/passives.ts, under the same id. None are written yet.

/** The levels a hero picks a passive at; tier 1 is the first, tier 2 the second. */
export const TRAIT_LEVELS = [3, 6] as const;

export interface TraitDef {
  id: string;
  classId: string;
  /** 1: picked at TRAIT_LEVELS[0]; 2: at TRAIT_LEVELS[1]. */
  tier: 1 | 2;
  name: string;
  blurb: string;
}

/** Every class's passives. Empty for now: a level with nothing to pick from asks for nothing. */
export const TRAITS: TraitDef[] = [];

export const TRAIT_BY_ID: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((d) => [d.id, d]));

/** A class's traits, tier by tier. */
export function traitsFor(classId: string): TraitDef[] {
  return TRAITS.filter((d) => d.classId === classId);
}

/** Tiers the hero has reached, that their class has passives for, but has not picked one at yet. */
export function pendingTraitTiers(classId: string, level: number, picked: readonly string[]): (1 | 2)[] {
  const out: (1 | 2)[] = [];
  TRAIT_LEVELS.forEach((at, i) => {
    const tier = (i + 1) as 1 | 2;
    if (level < at) return;
    if (!TRAITS.some((d) => d.classId === classId && d.tier === tier)) return;
    if (!picked.some((id) => TRAIT_BY_ID[id]?.classId === classId && TRAIT_BY_ID[id]?.tier === tier)) out.push(tier);
  });
  return out;
}

/** Why a hero can't pick `id` now, or null if they can. Picks are for keeps: one per tier. */
export function traitPickError(classId: string, level: number, picked: readonly string[], id: string): string | null {
  const def = TRAIT_BY_ID[id];
  if (!def || def.classId !== classId) return "That isn't one of your class's traits.";
  if (level < TRAIT_LEVELS[def.tier - 1]) return `That opens at level ${TRAIT_LEVELS[def.tier - 1]}.`;
  if (!pendingTraitTiers(classId, level, picked).includes(def.tier)) return "You've already picked that tier's trait.";
  return null;
}

/** Parse a stored traits list, dropping anything malformed. */
export function parseTraits(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!TRAIT_BY_ID[x]) : [];
  } catch {
    return [];
  }
}
