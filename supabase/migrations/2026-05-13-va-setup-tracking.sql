-- Migration: per-trainee setup tracking for the three VA platforms.
--
-- Each timestamp records WHEN the VA marked that platform set up for the
-- trainee. NULL = not done yet. We use timestamps instead of booleans so
-- we have an audit trail and can compute "all done" easily.
--
-- Safe to re-run.

alter table trainees
  add column if not exists repcard_setup_at timestamptz;

alter table trainees
  add column if not exists jobnimbus_setup_at timestamptz;

alter table trainees
  add column if not exists sales_academy_setup_at timestamptz;
