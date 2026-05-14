-- Migration: photo URLs on locations.
--
-- Photos uploaded via /locations are stored in the public 'location-photos'
-- Supabase Storage bucket; their public URLs are appended to this array.
-- Used to attach an image to auto-generated social posts.
-- Safe to re-run.

alter table locations
  add column if not exists photo_urls text[] not null default '{}';

-- The Storage bucket needs to be created once via the Supabase dashboard
-- (Storage → New bucket → name: location-photos → Public bucket: ON).
-- Photos uploaded from /locations are stored under <location_id>/<filename>.
