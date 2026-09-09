-- sql/week_b_force.sql
--
-- Putting someone INTO Week B who did not clear the attendance gate. Run once in
-- the TMS SQL editor.
--
-- Week B eligibility is "attended the LAST day of Week A". Michael Carraggi-Willan
-- made Aug 31 and Sep 1 but not Sep 2, so the rule excluded him, and Neal wanted
-- him back in (2026-09-09).
--
-- WHY A COLUMN AND NOT AN ATTENDANCE ROW. The obvious fix is to mark him present
-- on Sep 2. That would be a false record: it says he was in a room he was not in,
-- and those same rows drive no-show detection, dropout alerts and the hotel list.
-- This records what actually happened -- somebody decided to include him -- and
-- keeps who and why alongside it.
--
-- Mirrors week_b_hold, which is the same idea pointing the other way.

alter table trainees add column if not exists week_b_force        boolean not null default false;
alter table trainees add column if not exists week_b_force_reason text;
alter table trainees add column if not exists week_b_force_at     timestamptz;
alter table trainees add column if not exists week_b_force_by     text;

create index if not exists trainees_week_b_force_idx
  on trainees (week_b_force) where week_b_force = true;
