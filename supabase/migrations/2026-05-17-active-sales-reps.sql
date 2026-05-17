-- Migration: introduce "active sales rep" as a first-class flag.
--
-- Why: until now the system used trainees.enrolled to decide who's an
-- active person to message. That conflates two different things:
--   * "in a training class" (enrolled = true) — a transient state during
--     a training week, which then either ends in graduation or no-show.
--   * "on the sales team in the field" — the durable thing you actually
--     want to broadcast company-wide messages to.
--
-- This flag decouples them. A trainee starts inactive; they become an
-- active sales rep when they submit the final test (auto-flipped by
-- TakeTest.jsx). Bulk-imported existing reps are flagged active in this
-- migration because they're already in the field. Group Messages "All"
-- scope filters on this flag — no more no-shows or never-registered
-- people getting blasts meant for working reps.
--
-- Reversible: set is_active_sales_rep = false on any trainee to take
-- them off the active list (e.g. a rep who left the company).
-- Editable from /active-reps in the UI.

alter table trainees add column if not exists is_active_sales_rep boolean not null default false;
alter table trainees add column if not exists became_active_rep_at timestamptz;

create index if not exists trainees_active_rep_idx on trainees(is_active_sales_rep) where is_active_sales_rep = true;

-- Backfill 1: every trainee who's ever submitted a final test is, by
-- definition, an active sales rep going forward. Catches every past
-- graduate the system has on record so the user doesn't have to
-- manually click through them on /active-reps.
update trainees t
set is_active_sales_rep = true,
    became_active_rep_at = coalesce(t.became_active_rep_at, ta.submitted_at, now())
from test_attempts ta
where ta.trainee_id = t.id
  and ta.submitted_at is not null
  and t.is_active_sales_rep = false;

-- Backfill 2: trainees living under an attendance_only class (the
-- bulk-import meeting class) are working reps — by definition, the
-- whole point of importing the CSV was to capture every active rep.
-- Flag them active. If any imports turn out to NOT be active reps
-- (e.g. someone listed by mistake), HR can flip them off on /active-reps.
update trainees t
set is_active_sales_rep = true,
    became_active_rep_at = coalesce(t.became_active_rep_at, now())
from classes c
where c.id = t.class_id
  and c.attendance_only = true
  and t.is_active_sales_rep = false
  and t.enrolled = true
  and t.declined_at is null;
