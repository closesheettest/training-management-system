-- Migration: support adding non-trainee staff to the directory.
--
-- Two changes:
--
-- 1. class_id is now nullable. The original design assumed every
--    trainees row belonged to a training class — true when this was
--    a training-only system. Now staff/management can be added directly
--    via /manage-directory without going through a class, so class_id
--    must allow NULL.
--
-- 2. Adds a `department` text column — open-ended ("Production", "HR",
--    "Sales", "Ops", etc.) used for directory lookup and filtering.
--    Surfaces in the /directory phone-book and the manage-directory
--    admin table. Independently hide-able via directory_hidden (key:
--    'department').

alter table trainees
  alter column class_id drop not null;

alter table trainees
  add column if not exists department text;
