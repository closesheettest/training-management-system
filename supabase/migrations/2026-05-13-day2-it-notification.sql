-- Migration: day-2 IT notification + IT completion timestamp on classes.
--
-- Adds two timestamp columns:
--   day_2_it_notified_at   — when the day-2 reminder text was sent to IT
--                            (used to deduplicate the cron + first-checkin trigger)
--   it_completed_at        — when IT clicked "Mark provisioning complete" on the
--                            Provision page (used to track workflow state)
--
-- Safe to re-run.

alter table classes
  add column if not exists day_2_it_notified_at timestamptz;

alter table classes
  add column if not exists it_completed_at timestamptz;
