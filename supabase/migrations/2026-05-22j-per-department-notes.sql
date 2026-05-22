-- Migration: directory_note becomes jsonb so a person in multiple
-- departments can have a separate "how to reach me" note per
-- department (plus an optional general fallback under the special
-- "_default" key).
--
-- Example shape after this migration:
--   { "_default": "general note",
--     "Sales": "For sales questions, text my work line",
--     "HR": "For HR issues, email me" }
--
-- Existing text values become {"_default": "<old text>"} so callers
-- that only know about the default key keep working.

alter table trainees
  alter column directory_note type jsonb
  using (case
    when directory_note is null or directory_note = '' then null
    else jsonb_build_object('_default', directory_note)
  end);
