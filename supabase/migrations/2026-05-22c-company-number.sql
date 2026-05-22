-- Migration: company_number column on trainees.
--
-- Free-text identifier the company uses internally — employee ID,
-- badge number, assigned work phone extension, etc. Surfaced in the
-- shared /directory lookup page and editable on /active-reps by HR.

alter table trainees
  add column if not exists company_number text;
