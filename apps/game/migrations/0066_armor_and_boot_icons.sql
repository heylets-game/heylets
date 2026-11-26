-- The Oilskin Greatcoat, Diver's Plate, Sailcloth Trousers, Riveted Leggings, Gangplank Treads and Lead Boots get
-- icons of their own. Until now they were saved with the icon of another piece of their slot (packages/world/src/
-- gear.ts, BASES), so a yellow oilskin coat showed in the bag as a steel cuirass, canvas trousers as iron greaves,
-- and all three boots as the same tall leather sea boots.
UPDATE inventory SET icon = CASE ref
  WHEN 'greatcoat' THEN 'oilskin-coat'
  WHEN 'diving_plate' THEN 'diving-plate'
  WHEN 'trousers' THEN 'sailcloth-trousers'
  WHEN 'diving_legs' THEN 'riveted-leggings'
  WHEN 'treads' THEN 'treads'
  WHEN 'lead_boots' THEN 'lead-boots'
END
WHERE (slot = 'body' AND ref IN ('greatcoat', 'diving_plate'))
   OR (slot = 'legs' AND ref IN ('trousers', 'diving_legs'))
   OR (slot = 'boots' AND ref IN ('treads', 'lead_boots'));

UPDATE town_gear SET icon = CASE ref
  WHEN 'greatcoat' THEN 'oilskin-coat'
  WHEN 'diving_plate' THEN 'diving-plate'
  WHEN 'trousers' THEN 'sailcloth-trousers'
  WHEN 'diving_legs' THEN 'riveted-leggings'
  WHEN 'treads' THEN 'treads'
  WHEN 'lead_boots' THEN 'lead-boots'
END
WHERE (slot = 'body' AND ref IN ('greatcoat', 'diving_plate'))
   OR (slot = 'legs' AND ref IN ('trousers', 'diving_legs'))
   OR (slot = 'boots' AND ref IN ('treads', 'lead_boots'));
