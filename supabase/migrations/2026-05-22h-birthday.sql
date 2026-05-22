-- Migration: birthday on trainees, surfaced in the /directory page.
--
-- Stored as a date so admin can record the full birthday for HR
-- records (e.g. age verification). The public /directory page shows
-- only month + day (no year) when present. Independently hide-able
-- via directory_hidden (key: 'birthday').

alter table trainees
  add column if not exists birthday date;
