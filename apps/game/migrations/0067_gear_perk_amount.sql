-- How strong a piece of gear's power is (packages/world/src/gear.ts, ItemDef.perkAmount): Springheel Boots that jump
-- two hexes farther, Phase Treads that blink seven. Rolled when the piece is made and kept with it, in the pack and in
-- the crew's chest. Null for every piece without a power, which is every piece saved before this.
ALTER TABLE inventory ADD COLUMN perk_amount INTEGER;
ALTER TABLE town_gear ADD COLUMN perk_amount INTEGER;
