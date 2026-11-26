# TODO

Work that still needs doing on the game. Agents: read this before you start, and add to it whenever you notice
something that should be done but is not part of your task (one line each, under the area it belongs to). Take a
line off once it is done.

## Enemies

- Adjust scaling for enemy abilities: how each one's numbers grow with level (`scales` in
  `packages/world/src/zone/enemyabilities.ts`, rates in `rules.ts` SCALE_RATES).
- The Villain boss never spawns: nothing on the atlas or in delves places it (lairs pick theirs from LAIR_BEAST /
  CLIME_BEAST in `packages/world/src/atlas.ts`). Give it a home.
- Fumbling's blurb in `EFFECT_INFO` (`packages/world/src/content.ts`) says "One roll of its next attack fails", but
  the rules (and `CONDITION_INFO` in `zone/kit.ts`) give disadvantage on its next attack: make them agree.
