-- Migration: attendance-only class type for one-off meetings.
--
-- Some classes aren't real training weeks — they're company-wide
-- meetings where Neal just wants headcount tracking via the kiosk.
-- No registration texts, no provisioning, no final test, no
-- graduation report, no welcome drip, no hotels — just attendance.
--
-- When attendance_only=true:
--   - The Class detail page hides every workflow card except the
--     attendance roster + kiosk link
--   - The Calendar (Schedule) page tags the class with an
--     "Attendance only" pill
--   - All automated crons that filter on class state explicitly skip
--     these classes (defensive — most crons would self-gate anyway
--     since they require provisioning / tests / etc. that never
--     happen on an attendance-only class)

alter table classes add column if not exists attendance_only boolean not null default false;

-- Index helps the crons that filter by attendance_only=false.
create index if not exists classes_attendance_only_idx
  on classes(attendance_only)
  where attendance_only = true;
