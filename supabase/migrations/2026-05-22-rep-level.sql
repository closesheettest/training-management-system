-- Migration: introduce Junior vs Senior rep level.
--
-- "Junior" = graduated through this training system (a real training week,
-- not the bulk-import meeting). The system can prove they went through
-- the full onboarding here.
--
-- "Senior" = pre-existing reps that were bulk-imported via the
-- attendance_only "meeting" class so the system would have them on file
-- to message. They were already on the sales team before this system
-- existed (or before they had any reason to register through it).
--
-- Auto-assigned on the backfill below + going forward by TakeTest when
-- a trainee submits their final test (becomes Junior). Either way the
-- assignment stays UNCONFIRMED (rep_level_confirmed_at IS NULL) until
-- admin clicks Confirm on /active-reps — gives them a chance to flip
-- the auto-guess (e.g. a Senior who came back through training, or a
-- "Junior" import that should actually be Senior).

alter table trainees
  add column if not exists rep_level text
    check (rep_level in ('junior', 'senior')),
  add column if not exists rep_level_confirmed_at timestamptz;

create index if not exists trainees_rep_level_unconfirmed_idx
  on trainees(id)
  where rep_level is not null and rep_level_confirmed_at is null;

-- Backfill 1: anyone whose class is attendance_only (the bulk-import
-- meeting class) → Senior. They were on the team before this system
-- captured them.
update trainees t
set rep_level = 'senior'
from classes c
where c.id = t.class_id
  and c.attendance_only = true
  and t.rep_level is null;

-- Backfill 2: anyone who's submitted a final test, OR is on an active
-- training class (not attendance_only) → Junior. They went through (or
-- are going through) the full onboarding here.
update trainees t
set rep_level = 'junior'
where t.rep_level is null
  and (
    exists (
      select 1 from test_attempts ta
      where ta.trainee_id = t.id
        and ta.submitted_at is not null
    )
    or exists (
      select 1 from classes c
      where c.id = t.class_id
        and (c.attendance_only is null or c.attendance_only = false)
    )
  );

-- Backfill 3: any remaining active reps with no class / no test record
-- — default to Senior (safer: don't claim someone graduated here when
-- there's no evidence). Admin will see them in the "to confirm" list
-- and can flip to Junior if needed.
update trainees t
set rep_level = 'senior'
where t.rep_level is null
  and t.is_active_sales_rep = true;
