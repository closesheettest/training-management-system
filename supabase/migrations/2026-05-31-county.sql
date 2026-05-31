-- Add home_county to trainees so the system can auto-suggest the
-- correct Zone (1-4) from the rep's county.
--
-- Why: the new Zones (added 2026-05-31-zones.sql) are defined by
-- Florida county. Rather than admin cross-referencing the territory
-- screenshot for every rep, store the county and let the system
-- suggest the matching Zone in the Edit Info modal.
--
-- Free-text column (not a FK to a counties table) for simplicity —
-- the lookup happens client-side in src/lib/zones.js where the
-- canonical zone→counties mapping lives.

ALTER TABLE trainees ADD COLUMN IF NOT EXISTS home_county text;

COMMENT ON COLUMN trainees.home_county IS
  'Florida county the rep lives/works in. Used to auto-suggest the matching Zone in /active-reps Edit Info. Free-text; canonical list in src/lib/zones.js KNOWN_COUNTIES.';
