-- Add jobnimbus_id to trainees so cross-system joins (with CCG claims'
-- sales_reps table) work on a stable identifier rather than fuzzy name
-- matching.
--
-- Background: TMS owns "which Zone is this rep in." CCG claims owns
-- "which reps signed a roof inspection this week." Both apps have the
-- same humans, but identify them differently:
--   TMS:   trainees.first_name + ' ' + trainees.last_name
--   CCG:   sales_reps.name (free-text) + sales_reps.jobnimbus_id
--
-- Adding jobnimbus_id here lets the new /rep-zones endpoint return a
-- payload CCG's weekly report can join robustly. Name-matching still
-- works as a fallback when a rep's JN ID hasn't been backfilled yet.
--
-- Backfill plan: backfill-jobnimbus-ids.js (next file) ingests CCG's
-- sales_reps list and matches against TMS names case-insensitively,
-- stamping jobnimbus_id on each match. One-time admin run.

ALTER TABLE trainees
  ADD COLUMN IF NOT EXISTS jobnimbus_id text;

-- Unique-when-set so two trainee records can't accidentally claim the
-- same JN identity (rare but worth guarding — happens if admin pastes
-- the same ID twice during manual entry).
CREATE UNIQUE INDEX IF NOT EXISTS trainees_jobnimbus_id_idx
  ON trainees(jobnimbus_id)
  WHERE jobnimbus_id IS NOT NULL;

COMMENT ON COLUMN trainees.jobnimbus_id IS
  'JobNimbus user ID — joins this trainee record to CCG claims sales_reps.jobnimbus_id. Populated by netlify/functions/backfill-jobnimbus-ids.js (bulk) or admin Edit Info (one-off).';
