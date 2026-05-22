-- Migration: per-person directory note.
--
-- Free-text instructions for how to interact with this person — shown
-- on the /directory page next to their contact info. Example for Bryan
-- in production: "If this is about an install for one of your customers,
-- file it in JobNimbus instead of emailing — installs aren't tracked
-- through inbox." Saves people from guessing the right channel.
--
-- Always shown when present (no privacy toggle). To hide, leave empty.

alter table trainees
  add column if not exists directory_note text;
