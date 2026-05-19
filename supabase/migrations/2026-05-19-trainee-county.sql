-- Add `county` text column to trainees.
--
-- Captured during geocoding (Google's address_components include
-- `administrative_area_level_2` which is the US county). Surfaces on the
-- /regions admin page next to each rep so HR can see "this rep lives in
-- Hillsborough County" while deciding which region to assign them to.
--
-- Existing reps already geocoded will not have county until the admin
-- runs the "🔄 Look up counties for N reps" backfill button on /regions
-- (which force-re-geocodes via the same geocode-trainee function).

alter table trainees
  add column if not exists county text;

comment on column trainees.county is
  'US county name (e.g. "Hillsborough"). Populated by geocode-trainee.js from Google address_components administrative_area_level_2.';
