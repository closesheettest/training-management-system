-- Migration: add geocoding columns to trainees so the Sales Team Map
-- can place each rep at their actual home location instead of a
-- region-jittered approximation.
--
-- latitude/longitude — the geocoded coordinates (Nominatim / OpenStreetMap)
-- geocoded_at       — when we last successfully geocoded (for cache freshness)
-- geocoded_address  — the address string we sent to Nominatim (used to
--                     skip re-geocoding when the rep re-submits the same
--                     address — saves API calls)
--
-- The geocode-trainee function fills these in:
--   * Automatically when a rep submits /update-info (fire-and-forget)
--   * Via the "🔄 Geocode N unmapped reps" button on /rep-map (manual
--     bulk backfill)
--
-- Reps without lat/lng still show on the map — they just fall back to
-- the region-jitter placement (St Pete metro center + small scatter).

alter table trainees add column if not exists latitude double precision;
alter table trainees add column if not exists longitude double precision;
alter table trainees add column if not exists geocoded_at timestamptz;
alter table trainees add column if not exists geocoded_address text;

-- Partial index for the "needs geocoding" query — reps with an address
-- on file but no coords yet. Cheap to query, used by the bulk-backfill
-- button on /rep-map.
create index if not exists trainees_needs_geocode_idx
  on trainees(id)
  where latitude is null
    and street_address is not null
    and street_address != '';
