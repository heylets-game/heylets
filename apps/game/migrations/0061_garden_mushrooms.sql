-- What a garden bed grows (packages/world/src/garden.ts): herbs, from seeds or a herb, or mushrooms, from a
-- mushroom. Every bed planted before this grows herbs.
ALTER TABLE garden_beds ADD COLUMN crop TEXT NOT NULL DEFAULT 'herbs';
