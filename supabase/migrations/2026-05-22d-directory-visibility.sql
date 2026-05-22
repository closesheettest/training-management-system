-- Migration: per-person privacy for the /directory page.
--
-- Adds directory_hidden JSONB to trainees: keys are field names that
-- should be HIDDEN in the shared phone-book lookup. Empty object (the
-- default) means everything is visible. Example for Jenn from HR who
-- only wants her email shown:
--   { "phone": true, "region": true, "level": true, "company_number": true }
--
-- The /directory Netlify function reads this and nulls out the hidden
-- columns before returning rows to the browser. Admins on /active-reps
-- still see every field — the privacy applies only to the public list.
--
-- Defaults are empty for ALL existing reps, so the directory keeps
-- showing everything until admin explicitly hides something.

alter table trainees
  add column if not exists directory_hidden jsonb not null default '{}'::jsonb;
