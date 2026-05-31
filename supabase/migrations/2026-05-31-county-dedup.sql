-- Drop the redundant home_county column added in 2026-05-31-county.sql.
--
-- Background: trainees.county already exists (added 2026-05-19) and is
-- auto-populated by netlify/functions/geocode-trainee.js from Google
-- Maps' administrative_area_level_2 component. The /regions page also
-- has a "🔄 Look up counties" backfill button that re-runs geocoding
-- for any rep without a county.
--
-- This morning's home_county migration was duplicative — written before
-- I knew the existing column existed. Drop it and reuse the canonical
-- `county` column for the Zone-suggestion feature.
--
-- If any data was written to home_county before this dropped, it would
-- be lost — but no UI wrote to it (the Edit Info modal change went out
-- in the same batch as this fix). Safe to drop.

ALTER TABLE trainees DROP COLUMN IF EXISTS home_county;
