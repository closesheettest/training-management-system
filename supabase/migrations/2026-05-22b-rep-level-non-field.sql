-- Migration: extend rep_level to support 'non_field'.
--
-- New third value alongside 'junior' / 'senior':
--   'non_field' — still on the company team, but NOT a field sales rep
--                 (admin staff, ops, etc.). Excluded from the /active-reps
--                 list and from "All active sales reps" group blasts so
--                 these people don't get field-only messages.
--
-- The CHECK constraint on rep_level was created by the previous
-- migration (2026-05-22-rep-level.sql) with values ('junior', 'senior').
-- Drop and re-create to add 'non_field'. Safe to re-run.

alter table trainees drop constraint if exists trainees_rep_level_check;

alter table trainees
  add constraint trainees_rep_level_check
  check (rep_level in ('junior', 'senior', 'non_field'));
