// Passives (called traits in the code and the save): what a hero picks as
// they level, one of the class's choices at each of TRAIT_LEVELS, for keeps.
// The logbook offers them and the server saves the pick. Each is data here
// (name, blurb, class, tier); what it does in a hex fight is its hooks in
// zone/passives.ts, under the same id.

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

/** Every class's passives. A class with none at a tier asks for no pick there. */
export const TRAITS: TraitDef[] = [
  // Lighthouse Paladin
  { id: "inspiring_strikes", classId: "qa_paladin", tier: 1, name: "Inspiring Strikes", blurb: "When an attack of yours hits, the nearest hurt ally within 2 hexes heals half your level, rounded up." },
  { id: "beaming_fervor", classId: "qa_paladin", tier: 1, name: "Beaming Fervor", blurb: "When you set an enemy Burning, your next attack does extra damage equal to half your level, rounded up. Does not stack." },
  { id: "brighter_beacon", classId: "qa_paladin", tier: 2, name: "Brighter Beacon", blurb: "Your auras reach 1 hex further." },
  { id: "stay_near", classId: "qa_paladin", tier: 2, name: "Stay Near", blurb: "You and every ally within 2 hexes of you have +1 Defence." },
  // Stormcall Mage
  { id: "evening_mist", classId: "devops_mage", tier: 1, name: "Evening Mist", blurb: "While you are Wet, you have +1 Defence." },
  { id: "greater_conductivity", classId: "devops_mage", tier: 1, name: "Greater Conductivity", blurb: "Your lightning (Shock, Lightning Strike, Chain Lightning) has +1 to hit Wet enemies." },
  { id: "potent_shocks", classId: "devops_mage", tier: 2, name: "Potent Shocks", blurb: "Your lightning leaves what it hits Shocked for 2 turns: 2 less Defence." },
  { id: "osmosis", classId: "devops_mage", tier: 2, name: "Osmosis", blurb: "In a fight, you and every ally, however far, heal 2 at the start of each turn while Wet." },
  // Smuggler Rogue
  { id: "cruel_cuts", classId: "refactor_rogue", tier: 1, name: "Cruel Cuts", blurb: "Your critical hits set the target Bleeding for 2 turns, or add a stack to its Bleeding if it already is." },
  { id: "opportunist", classId: "refactor_rogue", tier: 1, name: "Opportunist", blurb: "Your attacks with advantage do 2 more damage." },
  { id: "flanking", classId: "refactor_rogue", tier: 2, name: "Flanking", blurb: "You have advantage on attacks on any enemy beside one of your allies." },
  { id: "quick_fingers", classId: "refactor_rogue", tier: 2, name: "Quick Fingers", blurb: "Throwing an item costs you only 1 AP." },
];

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
