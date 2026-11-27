-- The meal a hero ate at the pub (an id from PUB_MENU in packages/world/src/pub.ts) and the UTC day they ate it.
-- A hero eats one meal a day, and its perks (a few stat points, gathering outings back) last until the day turns.
-- gathering.meal_day (0009) was the old once-a-day mark for the outing a meal gave back; nothing reads it now.
ALTER TABLE characters ADD COLUMN meal TEXT;
ALTER TABLE characters ADD COLUMN meal_day TEXT;
