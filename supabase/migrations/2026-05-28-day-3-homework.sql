-- Day 3 homework — enables the training_day_lessons row for Day 3
-- and seeds the SMS body + link so the nightly cron-training-homework
-- function (fires 23:00 UTC = 7 PM EDT) sends it to every trainee
-- who attended today.
--
-- The link points at /day-3-homework/ which has the full breakdown
-- (apps setup, Job Nimbus practice deal, estimate specs, Edit Job
-- field checklist).
--
-- This is an UPDATE not an INSERT — the row already exists from
-- 2026-05-27-training-week.sql with enabled=false and null body.

update training_day_lessons
set
  label = 'Day 3 — Apps setup + practice deal in Job Nimbus',
  homework_sms_body = 'Hi {firstName} — tonight''s homework: get all 3 apps set up (email/JN/RepCard), then run a full practice deal in Job Nimbus with these numbers. Step-by-step + every field here:',
  homework_link_url = '/day-3-homework/',
  enabled = true
where day_number = 3;
