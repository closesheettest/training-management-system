-- Add Reschedule + Holding workflow.
--
-- New trainee columns:
--   holding boolean                    -- true = waiting in a holding list,
--                                         false = in active roster
--   rescheduled_from_class_id uuid     -- where they were rescheduled FROM
--                                         (null = never rescheduled)
--
-- Trainee states under the new model:
--   • Active        — class_id set,   holding = false
--   • Class holding — class_id set,   holding = true   (target class's holding list)
--   • General pool  — class_id = null, holding = true   (unassigned, awaiting reassignment)
--
-- New classes column:
--   cancelled_at timestamptz           -- when the class itself was cancelled.
--                                         The detail page stays viewable but
--                                         displays a CANCELLED banner.

alter table trainees
  add column if not exists holding boolean not null default false;

alter table trainees
  add column if not exists rescheduled_from_class_id uuid references classes(id);

alter table classes
  add column if not exists cancelled_at timestamptz;

-- Index for the Hiring Manager "general holding pool" query —
-- WHERE class_id IS NULL AND holding = true. Small index, but it
-- runs every time the manager page loads.
create index if not exists trainees_general_holding_idx
  on trainees(holding)
  where class_id is null and holding = true;
