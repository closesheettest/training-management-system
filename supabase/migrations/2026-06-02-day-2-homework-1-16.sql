-- Day 2 homework: change directive from "memorize 6-16, incorporate
-- 1-5" to "memorize 1-16" so trainees keep drilling the same slides
-- night after night. Repetition is the point — by Day 3 they should
-- have the full top-of-pitch flow committed.
--
-- The homework page (/day-2-homework/) is updated in the same commit;
-- this migration just keeps the SMS body in sync.

update training_day_lessons
set
  label = 'Day 2 — Memorize Slides 1-16 (full top of in-home pitch)',
  homework_sms_body =
    E'Hi {firstName}, great Day 2! 🎯\n\n' ||
    E'Tonight: memorize Slides 1-16 — the full top of the in-home pitch. ' ||
    E'Yes, that includes the four talking points you started last night. ' ||
    E'Repetition is what gets the script out of your head and into the homeowner''s living room.\n\n' ||
    E'Tap the link for the verbatim Slide 1-5 quotes, the Products PDF, and the full training manual.',
  homework_link_url = '/day-2-homework/',
  enabled = true,
  updated_at = now()
where day_number = 2;
