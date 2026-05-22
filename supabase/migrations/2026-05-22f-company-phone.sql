-- Migration: separate company_phone for the directory.
--
-- The existing `phone` column is the rep's personal phone — used by
-- the system for SMS broadcasts, registration texts, etc. It's their
-- main contact number internally. company_phone is the new "work
-- line" surfaced on /directory alongside the personal one. Both can
-- be independently hidden via directory_hidden ('phone' and
-- 'company_phone' keys).

alter table trainees
  add column if not exists company_phone text;
