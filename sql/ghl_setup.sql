-- GoHighLevel set-up checkbox on the /setup/<class> checklist (Neal, 2026-10-05: day-2 set-up =
-- company email, JobNimbus and GoHighLevel). Run once in Supabase → SQL Editor.
alter table trainees add column if not exists ghl_setup_at timestamptz;
