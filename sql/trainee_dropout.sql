-- Manual "Dropout" action (ClassDetail row button).
--
-- A dropout is DISTINCT from an unenroll: it's a trainee who washed out of
-- training (the Week A / Week B weed-out). We track it with its own columns so
-- we can report on dropouts later ("how many washed out of this cohort") instead
-- of string-matching an unenrolled_reason. Dropping someone out also flips
-- enrolled=false + is_active_sales_rep=false + is_field_trainee=false so they
-- immediately fall off the active roster, the manager team dashboard, and the
-- harvest map.
--
-- Safe to run more than once.
alter table trainees add column if not exists dropped_out_at    timestamptz;
alter table trainees add column if not exists dropped_out_reason text;

create index if not exists trainees_dropped_out_at_idx on trainees (dropped_out_at);
