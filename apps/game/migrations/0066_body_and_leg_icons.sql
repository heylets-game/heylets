-- The Oilskin Greatcoat, Diver's Plate, Sailcloth Trousers and Riveted Leggings get icons of their own. Until now
-- they were saved with the icon of the iron piece of their slot (packages/world/src/gear.ts, BASES), so a yellow
-- oilskin coat showed in the bag as a steel cuirass and canvas trousers as iron greaves.
UPDATE inventory SET icon = CASE ref
  WHEN 'greatcoat' THEN 'oilskin-coat'
  WHEN 'diving_plate' THEN 'diving-plate'
  WHEN 'trousers' THEN 'sailcloth-trousers'
  WHEN 'diving_legs' THEN 'riveted-leggings'
END
WHERE kind = 'armor' AND ref IN ('greatcoat', 'diving_plate', 'trousers', 'diving_legs');

UPDATE town_gear SET icon = CASE ref
  WHEN 'greatcoat' THEN 'oilskin-coat'
  WHEN 'diving_plate' THEN 'diving-plate'
  WHEN 'trousers' THEN 'sailcloth-trousers'
  WHEN 'diving_legs' THEN 'riveted-leggings'
END
WHERE kind = 'armor' AND ref IN ('greatcoat', 'diving_plate', 'trousers', 'diving_legs');
