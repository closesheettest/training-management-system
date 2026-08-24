-- "Held back from Week B" — a fourth state, and it is NOT dropping someone.
--
-- Bret Dethlefsen and Noah Mamane finished Week A and were due into Week B, but
-- showed no effort across the rest of Week A. Neal told their manager: when he
-- sees a week's worth of effort, they come in for Week B. Until then they stay
-- on the team and keep working, and it is the MANAGER'S call whether they stay
-- at all (Neal, 2026-08-24).
--
-- None of the existing states says that:
--   dropped_out_at  they are gone. These two are not.
--   declined_at     they turned us down. They did not.
--   enrolled=false  never started.
--   holding         the PRE-TRAINING admissions pool the hiring manager admits
--                   from — a different thing entirely, and reusing it would
--                   tangle two unrelated flows.
--
-- So: they finished Week A, they are still ours, and they are simply not going
-- into Week B yet. Clearing the flag is what lets them in.
alter table trainees add column if not exists week_b_hold        boolean not null default false;
alter table trainees add column if not exists week_b_hold_reason text;
alter table trainees add column if not exists week_b_hold_at     timestamptz;
alter table trainees add column if not exists week_b_hold_by     text;

comment on column trainees.week_b_hold is
  'Finished Week A but held out of Week B pending effort. NOT dropped, NOT declined — still on the team and still working. Clear it to let them into the next Week B.';

-- Bret and Noah.
update trainees
   set week_b_hold        = true,
       week_b_hold_reason = 'No effort shown across the rest of Week A. Back in for Week B once a full week of effort is seen — manager decides whether to keep them.',
       week_b_hold_at     = now(),
       week_b_hold_by     = 'Neal'
 where is_field_trainee = true
   and (
     (first_name = 'Bret' and last_name = 'Dethlefsen')
     or (first_name = 'Noah' and last_name = 'Mamane')
   );

select first_name, last_name, region, week_b_hold, week_b_hold_reason
  from trainees
 where week_b_hold = true;

-- Stamped when the trainee has actually been told they're held, so a second run
-- of notify-week-b-hold is a no-op rather than a second text.
alter table trainees add column if not exists week_b_hold_notified_at timestamptz;
