-- Heroes start with their class ability slots filled (packages/world/src/classabilities.ts `filledLoadout`).
-- 1 once that has been done for a hero: when they are confirmed, or for heroes from before, the first time
-- they come in after this (apps/game db/characters.ts `fillAbilitySlots`). Not done again, so a slot a player
-- empties on purpose stays empty.
ALTER TABLE characters ADD COLUMN ability_loadout_filled INTEGER NOT NULL DEFAULT 0;
